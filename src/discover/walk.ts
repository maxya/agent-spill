import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { matchesInRepo } from './targets.js';
import { formatFor, type Format } from '../scan/extract.js';

/** B3 walk skips. `.git` is special-cased because it is used for discovery. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.venv',
  'target',
  '.next',
  '.cache',
]);

export const MAX_JSON_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_JSONL_BYTES = 200 * 1024 * 1024;

export interface WalkFile {
  abs: string;
  /** Nearest repo root, or null when the file is outside any repo. */
  repoRoot: string | null;
  /** Repo-relative when repoRoot is set, otherwise scan-root-relative. */
  rel: string;
  format: Format;
  size: number;
}

export interface WalkResult {
  files: WalkFile[];
  repos: string[];
  warnings: string[];
}

export interface WalkOptions {
  maxDepth?: number;
}

function sizeCap(format: Format): number {
  return format === 'jsonl' ? MAX_JSONL_BYTES : MAX_JSON_TEXT_BYTES;
}

function relPosix(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

/** Bounded, symlink-safe DFS that finds repos and in-repo agent target files. */
export async function walkRoot(
  root: string,
  opts: WalkOptions = {},
): Promise<WalkResult> {
  const maxDepth = opts.maxDepth ?? 8;
  const files: WalkFile[] = [];
  const repos: string[] = [];
  const warnings: string[] = [];
  const stack: { dir: string; depth: number; repoRoot: string | null }[] = [
    { dir: path.resolve(root), depth: 0, repoRoot: null },
  ];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    let dir;
    try {
      dir = await opendir(cur.dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        warnings.push(`cannot read directory ${cur.dir}; skipped`);
        continue;
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw err;
    }

    const entries = [];
    try {
      for await (const e of dir) entries.push(e);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        warnings.push(`cannot read directory ${cur.dir}; skipped`);
        continue;
      }
      throw err;
    }

    let repoRoot = cur.repoRoot;
    if (entries.some((e) => e.name === '.git' && (e.isDirectory() || e.isFile()))) {
      repoRoot = cur.dir;
      if (!repos.includes(repoRoot)) repos.push(repoRoot);
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow symlinks
      const abs = path.join(cur.dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (cur.depth + 1 > maxDepth) continue;
        stack.push({ dir: abs, depth: cur.depth + 1, repoRoot });
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relPosix(repoRoot ?? path.resolve(root), abs);
      if (!matchesInRepo(rel)) continue;
      const format = formatFor(abs);
      let size = 0;
      try {
        size = (await stat(abs)).size;
      } catch {
        continue;
      }
      if (size > sizeCap(format)) continue;
      files.push({ abs, repoRoot, rel, format, size });
    }
  }

  return { files, repos, warnings };
}

export interface PlainFile {
  abs: string;
  size: number;
}

export interface PlainWalkResult {
  files: PlainFile[];
  warnings: string[];
}

/**
 * Generic bounded walk used by home-store expansion. Follows no symlinks and
 * applies the same skip directories as the repo walk.
 */
export async function walkFiles(
  root: string,
  accept: (abs: string, relPosix: string, size: number) => boolean,
  opts: WalkOptions = {},
): Promise<PlainWalkResult> {
  const maxDepth = opts.maxDepth ?? 12;
  const files: PlainFile[] = [];
  const warnings: string[] = [];
  const stack: { dir: string; depth: number }[] = [
    { dir: path.resolve(root), depth: 0 },
  ];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    let dir;
    try {
      dir = await opendir(cur.dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        warnings.push(`cannot read directory ${cur.dir}; skipped`);
        continue;
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw err;
    }

    const entries = [];
    try {
      for await (const e of dir) entries.push(e);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        warnings.push(`cannot read directory ${cur.dir}; skipped`);
        continue;
      }
      throw err;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(cur.dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (cur.depth + 1 > maxDepth) continue;
        stack.push({ dir: abs, depth: cur.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relPosix(root, abs);
      let size = 0;
      try {
        size = (await stat(abs)).size;
      } catch {
        continue;
      }
      if (accept(abs, rel, size)) files.push({ abs, size });
    }
  }

  return { files, warnings };
}
