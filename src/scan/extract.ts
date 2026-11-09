import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface Unit {
  text: string;
  line: number;
  column: number;
  /** True when the unit came from decoded JSON/JSONL (column is the unit start). */
  json?: boolean;
}
export type Format = 'json' | 'jsonl' | 'text';

export function formatFor(path: string): Format {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';
  return 'text';
}

interface Yielded {
  /** Text handed to the detection rules (includes key context when known). */
  text: string;
  /** The decoded JSON value, used to recover a position in the raw file. */
  needle: string;
}

function* walkStrings(v: unknown): Generator<Yielded> {
  if (typeof v === 'string') {
    yield { text: v, needle: v };
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) yield* walkStrings(x);
    return;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      // Keep key=value context so "PASSWORD": "abc" is visible to the
      // assignment rule.
      if (typeof x === 'string') yield { text: `${k}=${x}`, needle: x };
      else yield* walkStrings(x);
    }
  }
}

/** Locate a decoded string in the raw JSON text to recover a line/column. */
function locate(
  raw: string,
  needle: string,
  from: number,
): { line: number; column: number; at: number } {
  const encoded = JSON.stringify(needle).slice(1, -1);
  let at = encoded.length > 0 ? raw.indexOf(encoded, from) : -1;
  if (at < 0 && encoded.length > 0) at = raw.indexOf(encoded);
  if (at < 0) at = raw.indexOf(needle, from);
  if (at < 0) at = raw.indexOf(needle);
  if (at < 0) at = 0;
  const before = raw.slice(0, at);
  const line = before.split('\n').length;
  return { line, column: at - before.lastIndexOf('\n'), at };
}

export interface ExtractOptions {
  /** Strip zsh extended-history `: <ts>:<dur>;` prefixes. */
  stripZsh?: boolean;
}

export function* extractString(
  raw: string,
  format: Exclude<Format, 'jsonl'>,
  opts: ExtractOptions = {},
): Generator<Unit> {
  if (format === 'json') {
    try {
      const parsed = JSON.parse(raw);
      let cursor = 0;
      for (const { text, needle } of walkStrings(parsed)) {
        const p = locate(raw, needle, cursor);
        cursor = p.at + Math.max(needle.length, 1);
        yield { text, line: p.line, column: p.column, json: true };
      }
      return;
    } catch {
      /* fall through to text */
    }
  }
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i]!;
    if (opts.stripZsh) text = text.replace(/^: \d+:\d+;/, '');
    yield { text, line: i + 1, column: 1, json: false };
  }
}

/** Stream JSONL line by line (transcripts can be hundreds of MB). */
export async function* extractJsonlFile(
  path: string,
  opts: ExtractOptions = {},
): AsyncGenerator<Unit> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of rl) {
    n++;
    if (!line.trim()) continue;
    try {
      for (const { text } of walkStrings(JSON.parse(line))) {
        yield { text, line: n, column: 1, json: true };
      }
    } catch {
      let text = line;
      if (opts.stripZsh) text = text.replace(/^: \d+:\d+;/, '');
      yield { text, line: n, column: 1, json: false };
    }
  }
}
