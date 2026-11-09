import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Deterministic, non-repeating-ish filler. Tokens are assembled at runtime so
// no realistic token literal is ever stored in this repository (C13).
const r = (
  n: number,
  al = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789',
): string => Array.from({ length: n }, (_, i) => al[(i * 7 + 3) % al.length]).join('');

export const fake = {
  github: () => 'gh' + 'p_' + r(36),
  githubFineGrained: () => 'github' + '_pat_' + r(70, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_'),
  anthropic: () => 'sk-' + 'ant-' + 'api03-' + r(93),
  openai: () => 'sk-' + 'proj-' + r(48),
  aws: () => 'AK' + 'IA' + r(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
  awsSecret: () => r(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'),
  stripe: () => 'sk' + '_live_' + r(24),
  slack: () => 'xo' + 'xb-' + r(30),
  slackWebhook: () =>
    'https://hooks.slack.com/services/T' + r(9, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') +
    '/B' + r(9, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') + '/' + r(24),
  google: () => 'AIza' + r(35),
  gitlab: () => 'glpat-' + r(20),
  npm: () => 'npm_' + r(36),
  huggingface: () => 'hf_' + r(34),
  privateKey: () => '-----BEGIN ' + 'RSA ' + 'PRIVATE KEY-----',
  jwt: (role: string) =>
    [
      'eyJhbGciOiJIUzI1NiJ9',
      Buffer.from(JSON.stringify({ role })).toString('base64url'),
      r(43),
    ].join('.'),
  password: () => 'Qz' + r(10) + '!7',
  bearer: () => r(36),
  generic: () => 'Qz' + r(12) + '9',
};

export function gitRun(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): string {
  // Test-helper git calls may use child_process directly; the AS-16 rule 3
  // confinement check applies to src/ only.
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

export async function writeTree(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

export interface MakeRepoOptions {
  commit?: boolean;
  push?: boolean;
  message?: string;
}

export async function makeRepo(
  dir: string,
  files: Record<string, string>,
  opts: MakeRepoOptions = {},
): Promise<void> {
  await mkdir(dir, { recursive: true });
  gitRun(dir, ['init', '-q', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 'test@example.invalid']);
  gitRun(dir, ['config', 'user.name', 'Test']);
  await writeTree(dir, files);
  if (opts.commit !== false) {
    gitRun(dir, ['-c', 'core.excludesFile=/dev/null', 'add', '-A']);
    gitRun(dir, ['commit', '-qm', opts.message ?? 'fixture']);
  }
  if (opts.push) {
    const remote = dir + '-remote.git';
    await mkdir(remote, { recursive: true });
    gitRun(remote, ['init', '-q', '--bare']);
    gitRun(dir, ['remote', 'add', 'origin', remote]);
    gitRun(dir, ['push', '-q', '-u', 'origin', 'main']);
  }
}

export async function tempDir(prefix = 'agent-spill-test-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
