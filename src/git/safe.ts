import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { devNull } from 'node:os';

/**
 * The ONLY module allowed to spawn git. A scanned repo's own config is treated
 * as hostile: its fsmonitor, external diff, textconv, pager, hooks and gpg
 * settings must never run.
 */
const HARDEN = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'core.pager=cat',
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.external=',
  '-c',
  'core.sshCommand=false',
  '-c',
  'protocol.allow=never',
  '-c',
  `core.excludesFile=${devNull}`, // repo-only ignore semantics (C4)
  '-c',
  'gpg.program=false',
  '--no-pager',
];

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull, // ignore system/global config entirely
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0', // never write index/locks while scanning
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  LC_ALL: 'C',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  GIT_EXTERNAL_DIFF: '',
};
// Never let the caller's environment redirect git at another repository.
delete ENV.GIT_DIR;
delete ENV.GIT_WORK_TREE;
delete ENV.GIT_INDEX_FILE;

const ALLOWED_SUBCOMMANDS = new Set([
  'rev-parse',
  'ls-files',
  'check-ignore',
  'log',
  'cat-file',
  'for-each-ref',
]);

const FORBIDDEN_ARGS = new Set([
  '-p',
  '--patch',
  '--show-signature',
  '--textconv',
  '--filters',
  '--ext-diff',
]);

/** Arguments recorded for tests; contains no secret values. */
export const gitCallLog: string[][] = [];

function assertAllowed(args: string[]): void {
  const sub = args[0];
  if (!sub || !ALLOWED_SUBCOMMANDS.has(sub)) {
    throw new Error(`agent-spill: refusing disallowed git subcommand: ${String(sub)}`);
  }
  for (const a of args) {
    if (FORBIDDEN_ARGS.has(a)) {
      throw new Error(`agent-spill: refusing disallowed git argument: ${a}`);
    }
  }
}

export interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export function git(
  repo: string,
  args: string[],
  opts: { input?: string } = {},
): Promise<GitResult> {
  assertAllowed(args);
  gitCallLog.push([...args]);
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('git', ['-C', repo, ...HARDEN, ...args], {
        env: ENV,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    // A command that exits before reading stdin (rev-parse, ls-files, log) can
    // make our write fail with EPIPE. That is not an error for the scan.
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Same hardening, but returns the child so callers can stream stdin/stdout. */
export function gitStream(
  repo: string,
  args: string[],
): ChildProcessWithoutNullStreams {
  assertAllowed(args);
  gitCallLog.push([...args]);
  const child = spawn('git', ['-C', repo, ...HARDEN, ...args], {
    env: ENV,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {});
  return child;
}

export function isDubiousOwnership(stderr: string): boolean {
  return /dubious ownership|safe\.directory/i.test(stderr);
}
