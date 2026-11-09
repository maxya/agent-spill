import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  cleanup,
  fake,
  gitRun,
  makeRepo,
  tempDir,
  writeTree,
} from './helpers/fake.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_DIR = path.join(REPO_ROOT, 'src');
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function cli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

interface SecretEntry {
  value: string;
  prefix?: string;
}

function pass(suffix: string): string {
  return fake.password() + suffix;
}

async function buildLeakUniverse(
  dir: string,
): Promise<{ secrets: SecretEntry[]; home: string }> {
  const secrets: SecretEntry[] = [];
  const add = (value: string, prefix?: string): void => {
    secrets.push({ value, prefix });
  };

  const repo = path.join(dir, 'repo');
  const histPw = pass('H');
  add(histPw);
  const histGh = fake.github();
  add(histGh, 'gh');
  const histAnth = fake.anthropic();
  add(histAnth, 'sk-ant-');
  const histBearer = fake.bearer();
  add(histBearer);

  await makeRepo(
    repo,
    {
      'README.md': 'hello\n',
      '.claude/settings.local.json': JSON.stringify({
        permissions: {
          allow: [
            `Bash(PGPASSWORD=${histPw} psql -h db)`,
            `Bash(curl -H "Authorization: Bearer ${histBearer}" https://example.invalid)`,
          ],
        },
        env: { GITHUB_TOKEN: histGh, ANTHROPIC_API_KEY: histAnth },
      }),
    },
    { push: true },
  );
  await unlink(path.join(repo, '.claude', 'settings.local.json'));
  gitRun(repo, ['-c', 'core.excludesFile=/dev/null', 'add', '-A']);
  gitRun(repo, ['commit', '-qm', 'remove settings']);

  // COMMITTED: in local history only, never pushed.
  const committedPw = pass('C');
  add(committedPw);
  await writeTree(repo, {
    '.cursor/mcp.json': JSON.stringify({ env: { DB_PASSWORD: committedPw } }),
  });
  gitRun(repo, ['-c', 'core.excludesFile=/dev/null', 'add', '-A']);
  gitRun(repo, ['commit', '-qm', 'local only']);

  // AT-RISK: untracked MCP config with known formats.
  const openai = fake.openai();
  add(openai, 'sk-');
  const ghFine = fake.githubFineGrained();
  add(ghFine, 'github_pat_');
  const aws = fake.aws();
  add(aws, 'AKIA');
  const awsSecret = fake.awsSecret();
  add(awsSecret);
  const stripe = fake.stripe();
  add(stripe, 'sk_');
  const slackTok = fake.slack();
  add(slackTok, 'xox');
  const webhook = fake.slackWebhook();
  add(webhook, 'https://hooks.slack.com/services/');
  const google = fake.google();
  add(google, 'AIza');
  const gitlab = fake.gitlab();
  add(gitlab, 'glpat-');
  const npmTok = fake.npm();
  add(npmTok, 'npm_');
  const hf = fake.huggingface();
  add(hf, 'hf_');
  const jwt = fake.jwt('service_role');
  add(jwt, 'eyJ');

  await writeTree(repo, {
    '.mcp.json': JSON.stringify({
      mcpServers: {
        x: {
          env: {
            OPENAI_API_KEY: openai,
            GITHUB_TOKEN: ghFine,
            AWS_ACCESS_KEY_ID: aws,
            aws_secret_access_key: awsSecret,
            STRIPE_SECRET_KEY: stripe,
            SLACK_BOT_TOKEN: slackTok,
            SLACK_WEBHOOK_URL: webhook,
            GOOGLE_API_KEY: google,
            GITLAB_TOKEN: gitlab,
            NPM_TOKEN: npmTok,
            HF_TOKEN: hf,
            AUTH_JWT: jwt,
          },
        },
      },
    }),
  });

  // AT-RISK: command-embedded password classes in an agent transcript file.
  const mysqlPwd = pass('M');
  add(mysqlPwd);
  const mysqlP = pass('Q');
  add(mysqlP);
  const sshpass = pass('S');
  add(sshpass);
  const redis = pass('R');
  add(redis);
  const passFlag = pass('F');
  add(passFlag);
  const curlPass = pass('U');
  add(curlPass);
  const apiKey = fake.bearer() + 'K';
  add(apiKey);
  const authText = fake.bearer() + 'Z';
  add(authText);
  const urlCred = pass('L');
  add(urlCred);

  await writeTree(repo, {
    '.aider.input.history': [
      `MYSQL_PWD=${mysqlPwd} mysql`,
      `mysql -uroot -p${mysqlP} db`,
      `sshpass -p ${sshpass} ssh host`,
      `redis-cli -a ${redis} ping`,
      `tool --password=${passFlag}`,
      `curl -u admin:${curlPass} https://example.invalid`,
      `x-api-key: ${apiKey}`,
      `Authorization: Bearer ${authText}`,
      `postgres://user:${urlCred}@db.example.invalid/app`,
    ].join('\n'),
  });

  // LOCAL: ignored by the repo's own rules.
  const generic = fake.generic();
  add(generic);
  await writeFile(path.join(repo, '.gitignore'), '.claude/settings.json\n');
  await writeTree(repo, {
    '.claude/settings.json': JSON.stringify({ env: { GENERIC_API_TOKEN: generic } }),
  });

  // LOCAL: outside any repo.
  const plainPw = pass('P');
  add(plainPw);
  await writeTree(path.join(dir, 'plain'), {
    '.aider.chat.history.md': `mysql -h db -u root -p${plainPw} app\n`,
  });

  // LOCAL: home stores.
  const home = path.join(dir, 'home');
  const homeRedis = pass('D');
  add(homeRedis);
  const homeJwt = fake.jwt('authenticated');
  add(homeJwt, 'eyJ');
  const privateKey = fake.privateKey();
  add(privateKey);
  await writeTree(home, {
    '.zsh_history': `: 1700000000:0;redis-cli -a ${homeRedis} ping\n`,
    '.claude/projects/p/s.jsonl': [
      JSON.stringify({ m: privateKey }),
      JSON.stringify({ token: homeJwt }),
      '',
    ].join('\n'),
  });

  return { secrets, home };
}

test('AS-16.1 no-leak: no secret or 6-char fragment reaches stdout/stderr', async () => {
  const dir = await tempDir('agent-spill-universe-');
  try {
    const { secrets, home } = await buildLeakUniverse(dir);
    const env = { HOME: home, HISTFILE: path.join(home, '.zsh_history') };
    const outputs = [
      cli(['--root', dir, '--min-confidence', 'low'], env),
      cli(['--root', dir, '--min-confidence', 'low', '--verbose'], env),
      cli(['--root', dir, '--min-confidence', 'low', '--json'], env),
    ];

    for (const out of outputs) {
      const text = out.stdout + '\n' + out.stderr;
      for (const s of secrets) {
        assert.ok(!text.includes(s.value), 'leaked a full secret value');
        const rest =
          s.prefix && s.value.startsWith(s.prefix) ? s.value.slice(s.prefix.length) : s.value;
        for (let i = 0; i + 6 <= rest.length; i++) {
          const frag = rest.slice(i, i + 6);
          assert.ok(
            !text.includes(frag),
            `leaked a 6-char fragment (secret prefix ${s.prefix ?? 'none'}, fragment ${frag})`,
          );
        }
      }
    }

    const report = JSON.parse(outputs[2]!.stdout);
    assert.ok(report.summary.findings >= 15, 'universe should exercise many rules');
    const grades = new Set(report.findings.map((f: { grade: string }) => f.grade));
    for (const g of ['PUSHED', 'COMMITTED', 'AT-RISK', 'LOCAL']) {
      assert.ok(grades.has(g), `universe should include a ${g} finding`);
    }
  } finally {
    await cleanup(dir);
  }
});

test('AS-16.2 no-network: src/ imports no network modules and calls no fetch', async () => {
  const files = (await listFiles(SRC_DIR)).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 10);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    assert.doesNotMatch(text, /from\s+['"]node:(?:http|https|net|tls|dgram|http2)['"]/, rel);
    assert.doesNotMatch(text, /require\(\s*['"](?:http|https|net|tls|dgram|http2)['"]\s*\)/, rel);
    assert.doesNotMatch(text, /\bfetch\s*\(/, rel);
  }
});

test('AS-16.3 git confinement: only src/git/safe.ts touches child_process', async () => {
  const files = (await listFiles(SRC_DIR)).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    if (file === path.join(SRC_DIR, 'git', 'safe.ts')) continue;
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes('child_process'), path.relative(REPO_ROOT, file));
  }
});

test('AS-16.4 hostile config: the hardened run leaves the sentinel absent', async () => {
  const dir = await tempDir();
  try {
    const repo = path.join(dir, 'repo');
    // A target file forces ls-files/check-ignore, which a hostile
    // core.fsmonitor hooks into.
    await makeRepo(repo, {
      'README.md': 'hello\n',
      '.claude/settings.json': '{}',
    });
    const sentinel = path.join(dir, 'sentinel');
    const hook = path.join(dir, 'hook.sh');
    await writeFile(hook, `#!/bin/sh\ntouch '${sentinel}'\nexit 1\n`);
    await chmod(hook, 0o755);
    gitRun(repo, ['config', 'core.fsmonitor', hook]);
    gitRun(repo, ['config', 'diff.external', hook]);
    gitRun(repo, ['config', 'core.pager', hook]);
    gitRun(repo, ['config', 'gpg.program', hook]);
    gitRun(repo, ['config', 'filter.x.smudge', hook]);

    await rm(sentinel, { force: true });
    spawnSync('git', ['status'], { cwd: repo, encoding: 'utf8' });
    assert.equal(existsSync(sentinel), true, 'positive control did not trigger');

    await rm(sentinel, { force: true });
    const home = path.join(dir, 'home');
    await mkdir(home, { recursive: true });
    cli(['--root', repo, '--no-home', '--min-confidence', 'low'], { HOME: home });
    assert.equal(existsSync(sentinel), false);
  } finally {
    await cleanup(dir);
  }
});

test('AS-16.5 self-scan: this repo has no committed agent-target secret', async () => {
  const home = await tempDir('agent-spill-selfhome-');
  try {
    const r = cli(
      [
        '--root',
        REPO_ROOT,
        '--no-home',
        '--fail-on',
        'local',
        '--min-confidence',
        'low',
        '--json',
      ],
      { HOME: home },
    );
    assert.equal(r.status, 0, r.stdout.slice(0, 500) + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.summary.findings, 0);
  } finally {
    await cleanup(home);
  }
});

test('AS-16.6 no disk writes: a run creates no files and changes no mtimes', async () => {
  const dir = await tempDir();
  try {
    const repo = path.join(dir, 'repo');
    await makeRepo(repo, {
      '.claude/settings.local.json': JSON.stringify({
        permissions: { allow: [`Bash(PGPASSWORD=${fake.password()} psql)`] },
      }),
    });
    const freshTmp = path.join(dir, 'tmp');
    const freshHome = path.join(dir, 'fresh-home');
    await mkdir(freshTmp, { recursive: true });
    await mkdir(freshHome, { recursive: true });

    const before = await snapshot(repo);
    const r = cli(['--root', repo, '--no-home', '--fail-on', 'pushed'], {
      HOME: freshHome,
      TMPDIR: freshTmp,
    });
    const after = await snapshot(repo);

    assert.equal(r.status, 0);
    assert.deepEqual(after, before);
    assert.deepEqual(await readdir(freshTmp), []);
  } finally {
    await cleanup(dir);
  }
});

async function snapshot(dir: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const file of await listFiles(dir)) {
    const s = await stat(file);
    map[path.relative(dir, file)] = `${s.size}:${s.mtimeMs}`;
  }
  return map;
}
