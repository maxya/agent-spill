import os from 'node:os';
import { VERSION } from '../version.js';
import type { CliOptions } from '../args.js';
import type { RunResult } from '../run.js';
import type { Finding, Grade, Location } from '../types.js';
import { adviceText } from '../advice.js';

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const color = (code: string, s: string): string =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

const BOLD = '1';
const DIM = '2';
const RED = '31';
const YELLOW = '33';

const HOME = os.homedir();

function tilde(p: string): string {
  if (p === HOME) return '~';
  if (p.startsWith(HOME + '/') || p.startsWith(HOME + '\\')) return '~' + p.slice(HOME.length);
  return p;
}

function locationLine(loc: Location): string {
  let file: string;
  if (loc.kind === 'home' || !loc.repo) {
    file = tilde(loc.path);
  } else {
    file = `${tilde(loc.repo)}  ${loc.path}`;
  }
  let s = `${file}:${loc.line}:${loc.column}`;
  if (loc.kind === 'history') {
    const day = (loc.committedAt ?? '').slice(0, 10);
    s += `  @${loc.commit ?? 'unknown'}${day ? ` ${day}` : ''}`;
  }
  return s;
}

const SECTION: { grade: Grade; blurb: string; color: string }[] = [
  {
    grade: 'PUSHED',
    blurb: 'in a commit on a remote-tracking branch (as of last fetch)',
    color: RED,
  },
  {
    grade: 'COMMITTED',
    blurb: 'in local git history, not on a remote-tracking ref',
    color: RED,
  },
  {
    grade: 'AT-RISK',
    blurb: "untracked in a repo and not ignored by the repo's own rules",
    color: YELLOW,
  },
  {
    grade: 'LOCAL',
    blurb: 'plaintext on this machine only (shell history, agent transcripts, ignored files)',
    color: DIM,
  },
];

function renderFinding(f: Finding, opts: CliOptions): string[] {
  const out: string[] = [];
  const masked = color(DIM, f.masked);
  out.push(
    `  ${color(BOLD, f.rule)}  [${f.confidence}]  ${masked}  ${color(DIM, `fp ${f.fingerprint}`)}`,
  );

  const shown = opts.verbose ? f.locations : f.locations.slice(0, 1);
  for (const loc of shown) {
    const suffix =
      f.historyOnly && loc.kind === 'history'
        ? color(DIM, '  (file since deleted — still in history)')
        : '';
    out.push(`    ${locationLine(loc)}${suffix}`);
  }
  if (!opts.verbose && f.locations.length > 1) {
    out.push(
      color(
        DIM,
        `    + ${f.locations.length - 1} more locations (--verbose)`,
      ),
    );
  }

  const advice = adviceText(f.advice);
  out.push(`    → ${advice[0]}`);
  for (const line of advice.slice(1)) out.push(`      ${line}`);
  return out;
}

export function renderText(
  result: RunResult,
  opts: CliOptions,
  exitCode: number,
): string {
  const lines: string[] = [];
  const seconds = (result.runtimeMs / 1000).toFixed(1);
  lines.push(
    `${color(BOLD, `agent-spill ${VERSION}`)} · ${result.stats.repos} repos · ${result.stats.files} files · ${result.stats.historyBlobs} history blobs · ${seconds}s`,
  );
  lines.push('');

  for (const section of SECTION) {
    const findings = result.findings.filter((f) => f.grade === section.grade);
    lines.push(
      `${color(section.color, `${section.grade} (${findings.length})`)}  — ${section.blurb}`,
    );
    if (findings.length === 0) continue;
    if (section.grade === 'LOCAL' && !opts.verbose) {
      lines.push(color(DIM, '  plaintext on this machine only; --verbose to list.'));
      continue;
    }
    for (const f of findings) {
      lines.push(...renderFinding(f, opts));
    }
  }

  lines.push('');
  if (exitCode === 2) {
    lines.push(
      color(RED, `Exit 2: findings at or above ${opts.failOn}.`),
    );
  } else {
    lines.push(`Exit 0: nothing at or above ${opts.failOn}.`);
  }

  const hasHighStakes = result.findings.some(
    (f) => f.grade === 'COMMITTED' || f.grade === 'PUSHED',
  );
  if (hasHighStakes) {
    lines.push(
      'Found a real leak? Tell us (no secret values): https://github.com/maxya/agent-spill/issues/new?template=found-a-leak.yml',
    );
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(color(DIM, 'Warnings:'));
    for (const w of result.warnings) lines.push(color(DIM, `  - ${w}`));
  }

  return lines.join('\n') + '\n';
}
