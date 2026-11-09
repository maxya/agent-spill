import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../src/run.js';
import { repoStatus } from '../src/git/status.js';
import {
  historyForRepo,
  parseLogRaw,
  readBlobs,
} from '../src/git/history.js';
import { git, gitCallLog } from '../src/git/safe.js';
import {
  cleanup,
  fake,
  gitRun,
  makeRepo,
  tempDir,
  writeTree,
} from './helpers/fake.js';

const baseRun = {
  home: false,
  minConfidence: 'low' as const,
  maxDepth: 8,
};

test('AS-11: hostile git config does not execute (with positive control)', async () => {
  const dir = await tempDir();
  try {
    const repo = path.join(dir, 'repo');
    // A target file forces ls-files/check-ignore, which are the commands a
    // hostile core.fsmonitor would run through.
    await makeRepo(repo, {
      'README.md': 'hello\n',
      '.claude/settings.json': '{}',
    });
    const sentinel = path.join(dir, 'sentinel');
    const hook = path.join(dir, 'hook.sh');
    await writeFile(hook, `#!/bin/sh\ntouch '${sentinel}'\nexit 1\n`);
    await chmod(hook, 0o755);

    for (const [key, value] of [
      ['core.fsmonitor', hook],
      ['diff.external', hook],
      ['core.pager', hook],
      ['gpg.program', hook],
      ['filter.x.smudge', hook],
    ] as const) {
      gitRun(repo, ['config', key, value]);
    }

    // Positive control: unhardened git must actually run the trap.
    await rm(sentinel, { force: true });
    spawnSync('git', ['status'], { cwd: repo, encoding: 'utf8' });
    assert.equal(existsSync(sentinel), true, 'positive control did not trigger');

    await rm(sentinel, { force: true });
    await run({ ...baseRun, roots: [repo], history: true });
    assert.equal(existsSync(sentinel), false, 'hardened git executed hostile config');
  } finally {
    await cleanup(dir);
  }
});

test('AS-11: git() refuses non-allowlisted subcommands', async () => {
  const dir = await tempDir();
  try {
    const repo = path.join(dir, 'repo');
    await makeRepo(repo, { 'README.md': 'hello\n' });
    assert.throws(() => git(repo, ['status']), /disallowed git subcommand/);
    assert.throws(() => git(repo, ['log', '-p']), /disallowed git argument/);
  } finally {
    await cleanup(dir);
  }
});

test('AS-12: global excludes do not make an untracked file look safe', async () => {
  const dir = await tempDir();
  try {
    const repo = path.join(dir, 'repo');
    await makeRepo(repo, { 'README.md': 'hello\n' });
    const rel = '.claude/settings.local.json';
    await writeTree(repo, { [rel]: JSON.stringify({ permissions: { allow: [`Bash(PGPASSWORD=${fake.password()} psql)`] } }) });

    const xdg = path.join(dir, 'xdg');
    await mkdir(path.join(xdg, 'git'), { recursive: true });
    await writeFile(path.join(xdg, 'git', 'ignore'), '**/.claude/settings.local.json\n');
    const home = path.join(dir, 'home');
    await mkdir(home, { recursive: true });

    // Positive control: plain git honours the global excludes.
    const control = spawnSync('git', ['-C', repo, 'check-ignore', rel], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg, GIT_CONFIG_NOSYSTEM: '1' },
    });
    assert.equal(control.stdout.trim(), rel, 'positive control: global excludes should ignore it');

    const warnings: string[] = [];
    const st = await repoStatus(repo, [rel], warnings);
    assert.equal(st.ignored.has(rel), false, 'repo-only rules must not include global excludes');

    const first = await run({ ...baseRun, roots: [repo], history: false });
    const f1 = first.findings.find((f) => f.rule === 'pg-password-env');
    assert.equal(f1?.grade, 'AT-RISK');

    await writeFile(path.join(repo, '.gitignore'), `${rel}\n`);
    const second = await run({ ...baseRun, roots: [repo], history: false });
    const f2 = second.findings.find((f) => f.rule === 'pg-password-env');
    assert.equal(f2?.grade, 'LOCAL');
  } finally {
    await cleanup(dir);
  }
});

test('AS-13: parseLogRaw reads the raw -z format', () => {
  const commit = 'a'.repeat(40);
  const buf = Buffer.from(
    '\x01' + commit + '\0' + '2026-01-02T03:04:05Z' + '\0' +
      '\n:100644 100644 ' + '1'.repeat(40) + ' ' + '2'.repeat(40) + ' M\0.claude/settings.local.json\0',
    'utf8',
  );
  assert.deepEqual(parseLogRaw(buf), [
    {
      commit,
      date: '2026-01-02T03:04:05Z',
      path: '.claude/settings.local.json',
      blob: '2'.repeat(40),
    },
  ]);
});

test('AS-13: deleted pushed file is PUSHED + historyOnly; unpushed is COMMITTED', async () => {
  const dir = await tempDir();
  try {
    const pushed = path.join(dir, 'pushed');
    const pw = fake.password();
    await makeRepo(
      pushed,
      { '.claude/settings.local.json': JSON.stringify({ permissions: { allow: [`Bash(PGPASSWORD=${pw} psql)`] } }) },
      { push: true },
    );
    await unlink(path.join(pushed, '.claude', 'settings.local.json'));
    gitRun(pushed, ['-c', 'core.excludesFile=/dev/null', 'add', '-A']);
    gitRun(pushed, ['commit', '-qm', 'remove']);

    const r1 = await run({ ...baseRun, roots: [pushed], history: true });
    const f1 = r1.findings.find((f) => f.rule === 'pg-password-env');
    assert.ok(f1);
    assert.equal(f1.grade, 'PUSHED');
    assert.equal(f1.historyOnly, true);
    const histLoc = f1.locations.find((l) => l.kind === 'history')!;
    assert.equal(histLoc.commit?.length, 12);
    assert.ok(histLoc.committedAt);

    const local = path.join(dir, 'local');
    await makeRepo(local, {
      '.claude/settings.local.json': JSON.stringify({ permissions: { allow: [`Bash(PGPASSWORD=${fake.password()} psql)`] } }),
    });
    await unlink(path.join(local, '.claude', 'settings.local.json'));
    gitRun(local, ['-c', 'core.excludesFile=/dev/null', 'add', '-A']);
    gitRun(local, ['commit', '-qm', 'remove']);
    const r2 = await run({ ...baseRun, roots: [local], history: true });
    const f2 = r2.findings.find((f) => f.rule === 'pg-password-env');
    assert.ok(f2);
    assert.equal(f2.grade, 'COMMITTED');
    assert.equal(f2.historyOnly, true);
  } finally {
    await cleanup(dir);
  }
});

test('AS-13: an identical blob in several commits is read once', async () => {
  const dir = await tempDir();
  try {
    const repo = path.join(dir, 'repo');
    const content = JSON.stringify({
      permissions: { allow: [`Bash(PGPASSWORD=${fake.password()} psql)`] },
    });
    await makeRepo(repo, {
      '.claude/settings.json': content,
      '.claude/settings.local.json': content,
      '.mcp.json': content,
    });
    // Re-add the same content at a fourth path in another commit.
    await writeTree(repo, { '.cursor/mcp.json': content });
    gitRun(repo, ['-c', 'core.excludesFile=/dev/null', 'add', '-A']);
    gitRun(repo, ['commit', '-qm', 'second']);

    const warnings: string[] = [];
    const hist = await historyForRepo(repo, warnings);
    assert.equal(hist.uniqueBlobs.length, 1);

    gitCallLog.length = 0;
    const blobs = [];
    for await (const b of readBlobs(repo, hist.uniqueBlobs)) blobs.push(b);
    assert.equal(blobs.length, 1);
    const batchCalls = gitCallLog.filter((a) => a[0] === 'cat-file' && a[1] === '--batch');
    assert.equal(batchCalls.length, 1);
  } finally {
    await cleanup(dir);
  }
});
