import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverHome } from '../src/discover/home.js';
import { cleanup, tempDir } from './helpers/fake.js';

async function touch(root: string, rel: string): Promise<void> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, '{}');
}

test('AS-10: every B3 home row is found; intended stores are excluded', async () => {
  const home = await tempDir('agent-spill-home-');
  const oldHome = process.env.HOME;
  try {
    await touch(home, '.claude/settings.json');
    await touch(home, '.claude/settings.local.json');
    await touch(home, '.claude.json');
    await touch(home, '.claude/history.jsonl');
    await touch(home, '.claude/projects/p/x.jsonl');
    await touch(home, '.codex/rules/a.rules');
    await touch(home, '.codex/config.toml');
    await touch(home, '.codex/history.jsonl');
    await touch(home, '.codex/sessions/2026/11/09/r.jsonl');
    await touch(home, '.gemini/settings.json');
    await touch(home, '.gemini/policies/a.toml');
    await touch(home, '.gemini/tmp/hash/chats/c.json');
    await touch(home, '.gemini/tmp/hash/chats/d.jsonl');
    await touch(home, '.bash_history');
    await touch(home, '.zsh_history');
    await touch(home, '.local/share/fish/fish_history');
    // must be excluded
    await touch(home, '.codex/auth.json');
    await touch(home, '.claude/.credentials.json');
    await touch(home, '.gemini/oauth_creds.json');

    process.env.HOME = home;
    const res = await discoverHome({
      ...process.env,
      HOME: home,
      HISTFILE: path.join(home, '.zsh_history'),
    });
    const rels = new Set(res.files.map((f) => path.relative(home, f.abs).split(path.sep).join('/')));

    for (const expected of [
      '.claude/settings.json',
      '.claude/settings.local.json',
      '.claude.json',
      '.claude/history.jsonl',
      '.claude/projects/p/x.jsonl',
      '.codex/rules/a.rules',
      '.codex/config.toml',
      '.codex/history.jsonl',
      '.codex/sessions/2026/11/09/r.jsonl',
      '.gemini/settings.json',
      '.gemini/policies/a.toml',
      '.gemini/tmp/hash/chats/c.json',
      '.gemini/tmp/hash/chats/d.jsonl',
      '.bash_history',
      '.zsh_history',
      '.local/share/fish/fish_history',
    ]) {
      assert.ok(rels.has(expected), `${expected} should be discovered`);
    }
    for (const excluded of [
      '.codex/auth.json',
      '.claude/.credentials.json',
      '.gemini/oauth_creds.json',
    ]) {
      assert.ok(!rels.has(excluded), `${excluded} must be excluded`);
    }

    // $HISTFILE often equals ~/.zsh_history; dedupe by realpath.
    const zshReal = await realpath(path.join(home, '.zsh_history'));
    assert.equal(res.files.filter((f) => f.abs === zshReal).length, 1);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await cleanup(home);
  }
});

test('AS-10: CLAUDE_CONFIG_DIR and CODEX_HOME overrides are honored', async () => {
  const home = await tempDir('agent-spill-home-');
  const claude = await tempDir('agent-spill-claude-');
  const codex = await tempDir('agent-spill-codex-');
  const oldHome = process.env.HOME;
  try {
    await touch(claude, 'settings.json');
    await touch(codex, 'config.toml');
    process.env.HOME = home;
    const res = await discoverHome({
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: claude,
      CODEX_HOME: codex,
    });
    assert.ok(res.files.some((f) => f.abs === path.join(claude, 'settings.json')));
    assert.ok(res.files.some((f) => f.abs === path.join(codex, 'config.toml')));
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await cleanup(home);
    await cleanup(claude);
    await cleanup(codex);
  }
});
