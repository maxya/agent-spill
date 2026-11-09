import { git, gitStream } from './safe.js';
import { pathspecs } from '../discover/targets.js';
import { MAX_JSON_TEXT_BYTES } from '../discover/walk.js';

export interface HistoryEntry {
  commit: string;
  date: string;
  path: string;
  blob: string;
}

/**
 * Parse `git log --format=%x01%H%x00%cI --raw -z`.
 * Records look like: \x01<sha>\0<iso>\0\n:<mode> <mode> <old> <new> <status>\0<path>\0…
 */
export function parseLogRaw(buf: Buffer): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const s = buf.toString('utf8');
  for (const rec of s.split('\x01').slice(1)) {
    const parts = rec.split('\0');
    const commit = parts[0] ?? '';
    if (!commit) continue;
    const date = normalizeDate(parts[1] ?? '');
    for (let i = 2; i + 1 < parts.length; i += 2) {
      const meta = (parts[i] ?? '').replace(/^\n/, '');
      const p = parts[i + 1]!;
      if (!meta.startsWith(':')) continue;
      const fields = meta.split(' ');
      const blob = fields[3];
      if (!blob) continue;
      out.push({ commit, date, path: p, blob });
    }
  }
  return out;
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function runLog(
  repo: string,
  refs: string[],
  warnings: string[],
): Promise<HistoryEntry[]> {
  const res = await git(repo, [
    'log',
    ...refs,
    '--full-history',
    '--no-renames',
    '--diff-filter=AM',
    '--no-abbrev',
    '--no-show-signature',
    '--no-textconv',
    '--no-ext-diff',
    '--format=%x01%H%x00%cI',
    '--raw',
    '-z',
    '--',
    ...pathspecs(),
  ]);
  if (res.code !== 0) {
    warnings.push(`git log failed in ${repo}: ${res.stderr.trim().split('\n')[0] ?? 'unknown error'}`);
    return [];
  }
  return parseLogRaw(res.stdout);
}

export interface RepoHistory {
  /** Earliest entry per unique blob. */
  earliest: Map<string, HistoryEntry>;
  pushedBlobs: Set<string>;
  uniqueBlobs: string[];
  skipped: boolean;
}

export async function historyForRepo(
  repo: string,
  warnings: string[],
): Promise<RepoHistory> {
  const all = await runLog(repo, ['--all'], warnings);
  const remotes = await runLog(repo, ['--remotes'], warnings);
  const pushedBlobs = new Set(remotes.map((e) => e.blob));

  const seen = new Set<string>();
  const byBlob = new Map<string, HistoryEntry[]>();
  for (const e of all) {
    const key = `${e.commit}\0${e.path}\0${e.blob}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byBlob.get(e.blob);
    if (list) list.push(e);
    else byBlob.set(e.blob, [e]);
  }

  const earliest = new Map<string, HistoryEntry>();
  for (const [blob, list] of byBlob) {
    let best = list[0]!;
    for (const e of list) {
      if (new Date(e.date).getTime() < new Date(best.date).getTime()) best = e;
    }
    earliest.set(blob, best);
  }

  return {
    earliest,
    pushedBlobs,
    uniqueBlobs: [...byBlob.keys()],
    skipped: false,
  };
}

export interface BlobContent {
  blob: string;
  content: Buffer;
}

/**
 * Stream unique blob contents through a single `git cat-file --batch` process.
 * Blobs over the size cap are skipped after a `--batch-check` pass.
 */
export async function* readBlobs(
  repo: string,
  blobIds: string[],
  maxBytes = MAX_JSON_TEXT_BYTES,
): AsyncGenerator<BlobContent> {
  const unique = [...new Set(blobIds)];
  if (unique.length === 0) return;

  const check = await git(repo, ['cat-file', '--batch-check'], {
    input: unique.join('\n') + '\n',
  });
  if (check.code !== 0) {
    throw new Error(`git cat-file --batch-check failed in ${repo}`);
  }
  const wanted: string[] = [];
  for (const line of check.stdout.toString('utf8').split('\n')) {
    if (!line) continue;
    const m = /^([0-9a-f]{4,64}) (\w+) (\d+)$/.exec(line);
    if (!m || m[2] !== 'blob') continue;
    const size = Number(m[3]);
    if (Number.isFinite(size) && size <= maxBytes) wanted.push(m[1]!);
  }
  if (wanted.length === 0) return;

  const child = gitStream(repo, ['cat-file', '--batch']);
  child.stderr.resume();
  child.stdin.end(wanted.join('\n') + '\n');

  let buf: Buffer = Buffer.alloc(0);
  const it = child.stdout[Symbol.asyncIterator]();
  const pull = async (): Promise<boolean> => {
    const r = await it.next();
    if (r.done) return false;
    const chunk = r.value as Buffer;
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    return true;
  };

  try {
    for (;;) {
      let nl = buf.indexOf(0x0a);
      while (nl < 0) {
        if (!(await pull())) return;
        nl = buf.indexOf(0x0a);
      }
      const header = buf.subarray(0, nl).toString('utf8');
      buf = buf.subarray(nl + 1);
      const m = /^([0-9a-f]{4,64}) (\w+) (\d+)$/.exec(header);
      if (!m) continue; // "<sha> missing" or anything unexpected
      const blob = m[1]!;
      if (m[2] !== 'blob') continue;
      const size = Number(m[3]);
      while (buf.length < size + 1) {
        if (!(await pull())) break;
      }
      if (buf.length < size) return;
      const content = buf.subarray(0, size);
      buf = buf.subarray(size + 1);
      yield { blob, content };
    }
  } finally {
    child.stdout.destroy();
    child.kill();
  }
}
