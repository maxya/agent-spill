import os from 'node:os';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { walkFiles, MAX_JSON_TEXT_BYTES, MAX_JSONL_BYTES } from './walk.js';
import { isExcluded } from './targets.js';
import { formatFor, type Format } from '../scan/extract.js';

export interface HomeFile {
  abs: string;
  format: Format;
  size: number;
  stripZsh?: boolean;
}

export interface HomeResult {
  files: HomeFile[];
  warnings: string[];
}

interface Candidate {
  abs: string;
  format: Format;
  stripZsh?: boolean;
}

/**
 * Resolve B3's home-store table. Always graded LOCAL. Honors CLAUDE_CONFIG_DIR,
 * CODEX_HOME, HISTFILE and the Windows PSReadLine location.
 */
export async function discoverHome(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HomeResult> {
  const home = os.homedir();
  const candidates: Candidate[] = [];
  const warnings: string[] = [];

  const add = (abs: string, format?: Format, stripZsh = false): void => {
    candidates.push({ abs, format: format ?? formatFor(abs), stripZsh });
  };

  const expand = async (
    dir: string,
    accept: (abs: string, rel: string, size: number) => boolean,
  ): Promise<void> => {
    const res = await walkFiles(dir, accept);
    warnings.push(...res.warnings);
    for (const f of res.files) add(f.abs);
  };

  // ── Claude Code ────────────────────────────────────────────────────
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude');
  add(path.join(claudeDir, 'settings.json'), 'json');
  add(path.join(claudeDir, 'settings.local.json'), 'json');
  add(path.join(home, '.claude.json'), 'json');
  add(path.join(claudeDir, 'history.jsonl'), 'jsonl');
  await expand(path.join(claudeDir, 'projects'), (_a, rel, size) => {
    if (!rel.endsWith('.jsonl')) return false;
    return size <= MAX_JSONL_BYTES;
  });

  // ── Codex ──────────────────────────────────────────────────────────
  const codexDir = env.CODEX_HOME ?? path.join(home, '.codex');
  await expand(path.join(codexDir, 'rules'), (_a, rel, size) => {
    if (!rel.endsWith('.rules')) return false;
    return size <= MAX_JSON_TEXT_BYTES;
  });
  add(path.join(codexDir, 'config.toml'), 'text');
  add(path.join(codexDir, 'history.jsonl'), 'jsonl');
  await expand(path.join(codexDir, 'sessions'), (_a, rel, size) => {
    if (!rel.endsWith('.jsonl')) return false;
    return size <= MAX_JSONL_BYTES;
  });

  // ── Gemini CLI ─────────────────────────────────────────────────────
  const geminiDir = path.join(home, '.gemini');
  add(path.join(geminiDir, 'settings.json'), 'json');
  await expand(path.join(geminiDir, 'policies'), (_a, rel, size) => {
    if (!rel.endsWith('.toml')) return false;
    return size <= MAX_JSON_TEXT_BYTES;
  });
  // The exact auto-saved.toml location is unverified, so scan all chats broadly.
  await expand(path.join(geminiDir, 'tmp'), (abs, rel, size) => {
    if (!rel.includes('/chats/')) return false;
    const fmt = formatFor(abs);
    if (fmt === 'text') return false;
    return size <= (fmt === 'jsonl' ? MAX_JSONL_BYTES : MAX_JSON_TEXT_BYTES);
  });

  // ── Shell history ──────────────────────────────────────────────────
  if (env.HISTFILE) {
    add(env.HISTFILE, 'text', /zsh/i.test(path.basename(env.HISTFILE)));
  }
  add(path.join(home, '.bash_history'), 'text');
  add(path.join(home, '.zsh_history'), 'text', true);
  add(path.join(home, '.local', 'share', 'fish', 'fish_history'), 'text');
  if (process.platform === 'win32') {
    const appData = env.APPDATA;
    if (appData) {
      add(
        path.join(
          appData,
          'Microsoft',
          'Windows',
          'PowerShell',
          'PSReadLine',
          'ConsoleHost_history.txt',
        ),
        'text',
      );
    }
  }

  // ── De-duplicate by realpath, drop missing files and intended stores ──
  const files: HomeFile[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (isExcluded(c.abs)) continue;
    const cap = c.format === 'jsonl' ? MAX_JSONL_BYTES : MAX_JSON_TEXT_BYTES;
    let real = c.abs;
    let size = 0;
    try {
      real = await realpath(c.abs);
      size = (await stat(real)).size;
    } catch {
      continue;
    }
    if (size > cap) continue;
    if (seen.has(real)) continue;
    seen.add(real);
    files.push({ abs: real, format: c.format, size, stripZsh: c.stripZsh });
  }

  return { files, warnings };
}
