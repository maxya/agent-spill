import { readFile } from 'node:fs/promises';
import { walkRoot, type WalkFile } from './discover/walk.js';
import { discoverHome, type HomeFile } from './discover/home.js';
import { repoStatus } from './git/status.js';
import { historyForRepo, readBlobs, type RepoHistory } from './git/history.js';
import {
  extractJsonlFile,
  extractString,
  formatFor,
  type Format,
  type Unit,
} from './scan/extract.js';
import { detect, type Hit } from './scan/detect.js';
import { aggregate } from './aggregate.js';
import type {
  Confidence,
  Finding,
  Grade,
  Location,
  RawHit,
  ScanStats,
} from './types.js';

export interface RunOptions {
  roots: string[];
  home: boolean;
  history: boolean;
  minConfidence: Confidence;
  maxDepth: number;
}

export interface RunResult {
  findings: Finding[];
  warnings: string[];
  stats: ScanStats;
  runtimeMs: number;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function hitColumn(unit: Unit, hit: Hit): number {
  return unit.json ? unit.column : unit.column + hit.index;
}

/** Split a history blob by path format; JSONL blobs are parsed per line. */
function* blobUnits(raw: string, format: Format): Generator<Unit> {
  if (format === 'jsonl') {
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      for (const u of extractString(line, 'json')) {
        yield { ...u, line: i + 1, column: 1 };
      }
    }
    return;
  }
  yield* extractString(raw, format);
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const start = performance.now();
  const warnings: string[] = [];
  const hits: RawHit[] = [];

  // ── discovery ──────────────────────────────────────────────────────
  const worktreeFiles = new Map<string, WalkFile>();
  const repos = new Set<string>();
  for (const root of opts.roots) {
    const walked = await walkRoot(root, { maxDepth: opts.maxDepth });
    warnings.push(...walked.warnings);
    for (const repo of walked.repos) repos.add(repo);
    for (const f of walked.files) {
      if (!worktreeFiles.has(f.abs)) worktreeFiles.set(f.abs, f);
    }
  }

  let homeFiles: HomeFile[] = [];
  if (opts.home) {
    const home = await discoverHome();
    warnings.push(...home.warnings);
    homeFiles = home.files;
  }

  const byRepo = new Map<string, WalkFile[]>();
  const nonRepo: WalkFile[] = [];
  for (const f of worktreeFiles.values()) {
    if (f.repoRoot) {
      const list = byRepo.get(f.repoRoot);
      if (list) list.push(f);
      else byRepo.set(f.repoRoot, [f]);
    } else {
      nonRepo.push(f);
    }
  }
  for (const repo of repos) if (!byRepo.has(repo)) byRepo.set(repo, []);

  let filesScanned = 0;
  let historyBlobs = 0;

  const emitUnits = (
    units: Iterable<Unit>,
    base: Omit<Location, 'line' | 'column'>,
  ): void => {
    for (const unit of units) {
      for (const hit of detect(unit.text, opts.minConfidence)) {
        hits.push({
          rule: hit.rule,
          secret: hit.secret,
          confidence: hit.confidence,
          loc: { ...base, line: unit.line, column: hitColumn(unit, hit) },
        });
      }
    }
  };

  const scanWorktreeFile = async (f: WalkFile, grade: Grade): Promise<void> => {
    filesScanned++;
    const base: Omit<Location, 'line' | 'column'> = {
      kind: 'worktree',
      repo: f.repoRoot ?? undefined,
      path: f.repoRoot ? f.rel : f.abs,
      grade,
    };
    try {
      if (f.format === 'jsonl') {
        for await (const u of extractJsonlFile(f.abs)) emitUnits([u], base);
      } else {
        const raw = await readFile(f.abs, 'utf8');
        emitUnits(extractString(raw, f.format), base);
      }
    } catch (err) {
      warnings.push(`cannot read ${f.abs}; skipped (${(err as Error).message})`);
    }
  };

  // ── per-repo work-tree + history ───────────────────────────────────
  for (const [repo, files] of byRepo) {
    const status = await repoStatus(
      repo,
      files.map((f) => f.rel),
      warnings,
    );

    if (status.skipped) {
      await mapLimit(files, 8, (f) => scanWorktreeFile(f, 'AT-RISK'));
      continue;
    }

    let hist: RepoHistory | null = null;
    if (opts.history) {
      hist = await historyForRepo(repo, warnings);
    }

    const gradeFor = (f: WalkFile): Grade => {
      if (status.tracked.has(f.rel)) {
        if (hist) {
          const blob = status.indexBlobs.get(f.rel);
          return blob && hist.pushedBlobs.has(blob) ? 'PUSHED' : 'COMMITTED';
        }
        return 'COMMITTED';
      }
      if (status.ignored.has(f.rel)) return 'LOCAL';
      return 'AT-RISK';
    };

    await mapLimit(files, 8, (f) => scanWorktreeFile(f, gradeFor(f)));

    if (hist && hist.uniqueBlobs.length > 0) {
      for await (const blob of readBlobs(repo, hist.uniqueBlobs)) {
        historyBlobs++;
        const entry = hist.earliest.get(blob.blob);
        if (!entry) continue;
        const grade: Grade = hist.pushedBlobs.has(blob.blob) ? 'PUSHED' : 'COMMITTED';
        const base: Omit<Location, 'line' | 'column'> = {
          kind: 'history',
          repo,
          path: entry.path,
          commit: entry.commit.slice(0, 12),
          committedAt: entry.date,
          grade,
        };
        emitUnits(blobUnits(blob.content.toString('utf8'), formatFor(entry.path)), base);
      }
    }
  }

  // ── non-repo agent files and home stores: always LOCAL ─────────────
  await mapLimit(nonRepo, 8, (f) => scanWorktreeFile(f, 'LOCAL'));

  await mapLimit(homeFiles, 8, async (h) => {
    filesScanned++;
    const base: Omit<Location, 'line' | 'column'> = {
      kind: 'home',
      path: h.abs,
      grade: 'LOCAL',
    };
    try {
      if (h.format === 'jsonl') {
        for await (const u of extractJsonlFile(h.abs, { stripZsh: h.stripZsh })) {
          emitUnits([u], base);
        }
      } else {
        const raw = await readFile(h.abs, 'utf8');
        emitUnits(extractString(raw, h.format, { stripZsh: h.stripZsh }), base);
      }
    } catch (err) {
      warnings.push(`cannot read ${h.abs}; skipped (${(err as Error).message})`);
    }
  });

  const findings = aggregate(hits);
  const runtimeMs = Math.round(performance.now() - start);
  const stats: ScanStats = {
    repos: repos.size,
    files: filesScanned,
    historyBlobs,
  };

  return { findings, warnings: [...new Set(warnings)], stats, runtimeMs };
}
