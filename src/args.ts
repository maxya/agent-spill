import { parseArgs } from 'node:util';
import type { Confidence, Grade } from './types.js';

export class UsageError extends Error {}

export interface CliOptions {
  roots: string[];
  home: boolean;
  history: boolean;
  failOn: Grade;
  minConfidence: Confidence;
  json: boolean;
  verbose: boolean;
  maxDepth: number;
  ci: boolean;
  version: boolean;
  help: boolean;
}

export const USAGE = `agent-spill [options]

  --root <dir>          Directory to search for repos/agent files (repeatable). Default: cwd.
  --no-home             Skip home-directory agent stores and shell history.
  --no-history          Skip git history (working tree only).
  --ci                  Preset: --no-home --fail-on committed; warn if shallow clone.
  --fail-on <grade>     local | at-risk | committed | pushed. Default: at-risk.
  --min-confidence <c>  high | medium | low. Default: medium.
  --json                Machine-readable report on stdout (schema 1).
  --verbose             Expand LOCAL findings and list every location.
  --max-depth <n>       Directory walk depth under each root. Default: 8.
  --version, --help
`;

const GRADES: Record<string, Grade> = {
  local: 'LOCAL',
  'at-risk': 'AT-RISK',
  at_risk: 'AT-RISK',
  committed: 'COMMITTED',
  pushed: 'PUSHED',
};

function parseGrade(raw: string | undefined, fallback: Grade): Grade {
  if (raw === undefined) return fallback;
  const g = GRADES[raw.toLowerCase()];
  if (!g) throw new UsageError(`invalid --fail-on value: ${raw}`);
  return g;
}

function parseConfidence(raw: string | undefined, fallback: Confidence): Confidence {
  if (raw === undefined) return fallback;
  const c = raw.toLowerCase();
  if (c === 'high' || c === 'medium' || c === 'low') return c;
  throw new UsageError(`invalid --min-confidence value: ${raw}`);
}

function parseDepth(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`invalid --max-depth value: ${raw}`);
  return n;
}

export function parseCli(argv: string[]): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: 'string', multiple: true },
        'no-home': { type: 'boolean' },
        'no-history': { type: 'boolean' },
        ci: { type: 'boolean' },
        'fail-on': { type: 'string' },
        'min-confidence': { type: 'string' },
        json: { type: 'boolean' },
        verbose: { type: 'boolean' },
        'max-depth': { type: 'string' },
        version: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }

  const ci = values.ci === true;
  const roots = values.root && values.root.length > 0 ? values.root : [process.cwd()];
  const failOn = parseGrade(values['fail-on'], ci ? 'COMMITTED' : 'AT-RISK');

  return {
    roots,
    // --ci preset, overridden by an explicit --no-home (same outcome) or left off otherwise.
    home: ci ? false : values['no-home'] !== true,
    history: values['no-history'] !== true,
    failOn,
    minConfidence: parseConfidence(values['min-confidence'], 'medium'),
    json: values.json === true,
    verbose: values.verbose === true,
    maxDepth: parseDepth(values['max-depth'], 8),
    ci,
    version: values.version === true,
    help: values.help === true,
  };
}
