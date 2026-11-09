import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IN_REPO_GLOBS,
  isExcluded,
  matchesInRepo,
  pathspecs,
} from '../src/discover/targets.js';

test('AS-8: every B3 in-repo row matches', () => {
  for (const rel of [
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.mcp.json',
    'sub/.mcp.json',
    '.cursor/mcp.json',
    '.cursor/other.json',
    '.vscode/mcp.json',
    '.gemini/settings.json',
    '.gemini/policies/a.toml',
    '.codex/config.toml',
    '.codex/rules/a.rules',
    '.specstory/history/2026-01-01.md',
    '.specstory/history/sub/deeper.md',
    '.continue/config.yaml',
    '.continue/sessions/x.json',
    '.aider.chat.history.md',
    '.aider.input.history',
    'sub/.claude/settings.local.json',
  ]) {
    assert.equal(matchesInRepo(rel), true, `${rel} should match`);
  }
});

test('AS-8: non-targets do not match', () => {
  for (const rel of [
    'src/settings.json',
    '.env',
    '.env.local',
    '.claude/settings.local.js',
    '.cursor/mcp.yaml',
    'README.md',
  ]) {
    assert.equal(matchesInRepo(rel), false, `${rel} should not match`);
  }
});

test('intended credential stores are excluded', () => {
  for (const rel of ['auth.json', 'x/.credentials.json', 'oauth_creds.json', '.env', 'a/.env.production']) {
    assert.equal(isExcluded(rel), true, `${rel} should be excluded`);
  }
});

test('pathspecs mirror the in-repo globs', () => {
  const ps = pathspecs();
  assert.equal(ps.length, IN_REPO_GLOBS.length);
  for (const p of ps) assert.ok(p.startsWith(':(glob)'));
});
