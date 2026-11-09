const PLACEHOLDER_RES: RegExp[] = [
  /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/, // $VAR ${VAR}
  /^\$\(.*\)$/s,
  /^`.*`$/s, // $(cmd) `cmd`
  /^%[A-Za-z_][A-Za-z0-9_]*%$/, // %VAR% (Windows)
  /^<[^>]*>$/,
  /^\{\{.*\}\}$/,
  /^\[[^\]]*\]$/, // <tok> {{tok}} [tok]
  /^[*xX•.…#-]{3,}$/, // *** xxxx ...
  /^(?:your|my|example|dummy|fake|sample|placeholder|redacted|changeme|change_me|replace_?me|todo|none|null|undefined|password|passwd|secret|token|apikey|api_key)(?:[-_]?[a-z0-9]*)?$/i,
];

export function isPlaceholder(v: string): boolean {
  const s = v.trim();
  if (s.length < 4) return true;
  if (s.includes('$') && /\$[{(A-Za-z_]/.test(s)) return true; // contains a var ref
  return PLACEHOLDER_RES.some((re) => re.test(s));
}

export function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export const GENERIC_MIN_ENTROPY = 3.0;
export const GENERIC_MIN_LEN = 8;

const SECRET_KEY_SEGMENTS = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'apikey',
  'api_key',
  'access_key',
  'private_key',
  'client_secret',
  'authorization',
]);

// Token *counts* and pagination cursors are not credentials. Without this,
// case-insensitive matching reports `maximumTokens`, `PageToken`, etc.
const PAGINATION_KEY_RE =
  /^(?:next|prev|previous|page|pagination|continuation|cursor|offset|sync|delta|change)(?:[_-][a-z0-9]+)*[_-]token$/;
const TOKEN_COUNT_KEY_RE =
  /^(?:(?:max|maximum|min|minimum|total|num|number|count|budget|input|output)(?:[_-][a-z0-9]+)*[_-]tokens?|token[_-]?count)$/;

// Keys whose final segment names a container/metadata about a secret rather
// than the secret itself: TOKEN_FILE, SECRET_FIELDS, token_type, …_HEADER_NAME.
const NON_VALUE_KEY_SUFFIXES = new Set([
  'file',
  'filename',
  'url',
  'uri',
  'path',
  'dir',
  'directory',
  'endpoint',
  'name',
  'names',
  'header',
  'headers',
  'header_name',
  'field',
  'fields',
  'field_name',
  'type',
  'version',
  'count',
  'length',
  'len',
  'bytes',
  'ctx',
  'context',
  'prefix',
  'suffix',
  'env',
  'id',
  'index',
  'list',
  'set',
  'array',
  'vars',
  'var',
  // File extensions: `password.mjs` is a filename, not a key.
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'json',
  'jsonl',
  'md',
  'txt',
  'yml',
  'yaml',
  'toml',
  'ini',
  'sh',
  'zsh',
  'bash',
  'ps1',
  'sql',
  'lock',
  'log',
  'csv',
  'xml',
  'html',
  'css',
]);

/**
 * True when the key contains TOKEN/SECRET/PASSWORD/… as a real segment,
 * not as a substring of a word like `author` or `maximumTokens`.
 */
export function isSecretKeyName(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (PAGINATION_KEY_RE.test(normalized) || TOKEN_COUNT_KEY_RE.test(normalized)) return false;
  const segments = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && NON_VALUE_KEY_SUFFIXES.has(last)) return false;
  const lastTwo = segments.slice(-2).join('_');
  if (NON_VALUE_KEY_SUFFIXES.has(lastTwo)) return false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (SECRET_KEY_SEGMENTS.has(seg)) return true;
    const next = segments[i + 1];
    if (next && SECRET_KEY_SEGMENTS.has(`${seg}_${next}`)) return true;
  }
  return false;
}

/** Values that are configuration, code fragments, or names, not credentials. */
export function isStructuredValue(v: string): boolean {
  if (/^(?:true|false|null|none|undefined|yes|no)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return true;
  if (/[{[]/.test(v[0] ?? '')) return true;
  if (/[(){}[\]]/.test(v)) return true; // code/JSON fragment
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  // Dotted identifier / property path, e.g. h.accessToken.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v)) return true;
  // The value names a credential field instead of being one.
  if (/^(?:[a-z0-9]+[_-])*(?:token|secret|key|password|passwd|pwd)$/i.test(v)) return true;
  return false;
}
