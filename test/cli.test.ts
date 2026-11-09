import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  cleanup,
  fake,
  makeRepo,
  tempDir,
  writeTree,
} from './helpers/fake.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): CliResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

async function atRiskRepo(dir: string): Promise<{ repo: string; secret: string }> {
  const repo = path.join(dir, 'repo');
  await makeRepo(repo, { 'README.md': 'hello\n' });
  const secret = fake.password();
  await writeTree(repo, {
    '.claude/settings.local.json': JSON.stringify({
      permissions: { allow: [`Bash(PGPASSWORD=${secret} psql -h db)`] },
    }),
  });
  return { repo, secret };
}

test('--version prints the package version', () => {
  const r = runCli(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '0.1.0');
});

test('unknown flag prints usage to stderr and exits 1', () => {
  const r = runCli(['--bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agent-spill:/);
  assert.match(r.stderr, /--fail-on/);
});

test('--json parses and reports an AT-RISK finding with exit 2', async () => {
  const dir = await tempDir();
  try {
    const home = path.join(dir, 'home');
    const { repo, secret } = await atRiskRepo(dir);
    const r = runCli(['--root', repo, '--no-home', '--json'], { HOME: home });
    assert.equal(r.status, 2);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tool, 'agent-spill');
    assert.equal(report.schema, 1);
    assert.equal(report.summary.failOn, 'AT-RISK');
    assert.equal(report.summary.exitCode, 2);
    assert.ok(report.summary.byGrade['AT-RISK'] >= 1);
    assert.equal(report.summary.worstGrade, 'AT-RISK');
    assert.ok(report.findings.length >= 1);
    assert.ok(report.findings.every((f: Record<string, unknown>) => !('secret' in f)));
    assert.ok(!r.stdout.includes(secret));

    const text = runCli(['--root', repo, '--no-home'], { HOME: home });
    assert.equal(text.status, 2);
    assert.match(text.stdout, /AT-RISK \(1\)/);
    assert.match(text.stdout, /…\(\d+ chars\)/);
    assert.ok(!text.stdout.includes(secret));
  } finally {
    await cleanup(dir);
  }
});

test('LOCAL-only exits 0 by default and 2 with --fail-on local', async () => {
  const dir = await tempDir();
  try {
    const home = path.join(dir, 'home');
    const plain = path.join(dir, 'plain');
    await writeTree(plain, {
      '.aider.input.history': `mysql -uroot -p${fake.password()} db\n`,
    });
    const clean = runCli(['--root', plain, '--no-home', '--json'], { HOME: home });
    assert.equal(clean.status, 0);
    const report = JSON.parse(clean.stdout);
    assert.equal(report.summary.worstGrade, 'LOCAL');
    assert.equal(report.summary.exitCode, 0);

    const strict = runCli(['--root', plain, '--no-home', '--fail-on', 'local'], { HOME: home });
    assert.equal(strict.status, 2);
  } finally {
    await cleanup(dir);
  }
});

test('--ci skips home stores and fails on COMMITTED', async () => {
  const dir = await tempDir();
  try {
    const home = path.join(dir, 'home');
    await writeTree(home, { '.zsh_history': `mysql -uroot -p${fake.password()} db\n` });
    const empty = path.join(dir, 'empty');
    await writeTree(empty, {});

    const withoutCi = runCli(['--root', empty, '--json'], { HOME: home });
    assert.ok(JSON.parse(withoutCi.stdout).findings.length >= 1);

    const ci = runCli(['--root', empty, '--ci', '--json'], { HOME: home });
    assert.equal(ci.status, 0);
    const report = JSON.parse(ci.stdout);
    assert.equal(report.findings.length, 0);
    assert.equal(report.summary.failOn, 'COMMITTED');

    const repo = path.join(dir, 'repo');
    await makeRepo(repo, {
      '.claude/settings.local.json': JSON.stringify({
        permissions: { allow: [`Bash(PGPASSWORD=${fake.password()} psql)`] },
      }),
    });
    const committed = runCli(['--root', repo, '--ci', '--json'], { HOME: home });
    assert.equal(committed.status, 2);
    assert.equal(JSON.parse(committed.stdout).summary.worstGrade, 'COMMITTED');
  } finally {
    await cleanup(dir);
  }
});

test('--verbose expands LOCAL findings', async () => {
  const dir = await tempDir();
  try {
    const home = path.join(dir, 'home');
    const plain = path.join(dir, 'plain');
    await writeTree(plain, {
      '.aider.input.history': `mysql -uroot -p${fake.password()} db\n`,
    });
    const quiet = runCli(['--root', plain, '--no-home'], { HOME: home });
    assert.ok(!quiet.stdout.includes('mysql-p-flag'));
    assert.match(quiet.stdout, /--verbose to list/);

    const verbose = runCli(['--root', plain, '--no-home', '--verbose'], { HOME: home });
    assert.ok(verbose.stdout.includes('mysql-p-flag'));
  } finally {
    await cleanup(dir);
  }
});
