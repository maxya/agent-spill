/**
 * B3 target tables as data. In-repo globs are used for both the filesystem
 * walk (suffix match) and git pathspecs (`:(glob)` form).
 */
export const IN_REPO_GLOBS = [
  '**/.claude/settings.json',
  '**/.claude/settings.local.json',
  '**/.mcp.json',
  '**/.cursor/*.json',
  '**/.vscode/mcp.json',
  '**/.gemini/settings.json',
  '**/.gemini/policies/*.toml',
  '**/.codex/config.toml',
  '**/.codex/rules/*.rules',
  '**/.specstory/history/**',
  '**/.continue/**',
  '**/.aider.chat.history.md',
  '**/.aider.input.history',
] as const;

export const pathspecs = (): string[] => IN_REPO_GLOBS.map((g) => `:(glob)${g}`);

/** Intended credential stores: flagging where a secret is meant to live is noise. */
export const EXCLUDED_BASENAMES = new Set([
  'auth.json',
  '.credentials.json',
  'oauth_creds.json',
]);
export const EXCLUDE_RE = /(^|\/)\.env(\..*)?$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Minimal glob → RegExp: `**` = anything, `*` = anything but a slash. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRe(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

const IN_REPO_RES = IN_REPO_GLOBS.map((g) => globToRegExp(g));

export function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function isExcluded(relPosix: string): boolean {
  const rel = normalizeRel(relPosix);
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (EXCLUDED_BASENAMES.has(base)) return true;
  return EXCLUDE_RE.test(rel);
}

export function matchesInRepo(relPosix: string): boolean {
  const rel = normalizeRel(relPosix);
  if (isExcluded(rel)) return false;
  return IN_REPO_RES.some((re) => re.test(rel));
}
