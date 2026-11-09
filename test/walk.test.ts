import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { walkRoot } from '../src/discover/walk.js';
import { cleanup, tempDir } from './helpers/fake.js';

test('AS-9: bounded walk finds nested repos, skips decoys, never follows symlinks', async () => {
  const root = await tempDir();
  try {
    await mkdir(path.join(root, 'repo1', '.git'), { recursive: true });
    await mkdir(path.join(root, 'repo1', '.claude'), { recursive: true });
    await mkdir(path.join(root, 'repo1', 'node_modules', '.claude'), { recursive: true });
    await mkdir(path.join(root, 'repo1', 'sub', '.git'), { recursive: true });
    await mkdir(path.join(root, 'plain'), { recursive: true });
    await writeFile(path.join(root, 'repo1', '.claude', 'settings.local.json'), '{}');
    await writeFile(path.join(root, 'repo1', 'node_modules', '.claude', 'settings.json'), '{}');
    await writeFile(path.join(root, 'repo1', 'sub', '.mcp.json'), '{}');
    await writeFile(path.join(root, 'plain', '.aider.chat.history.md'), 'x');
    await writeFile(path.join(root, 'plain', '.env'), 'SECRET=x');
    await symlink(root, path.join(root, 'loop'), 'dir');

    const res = await walkRoot(root);
    const rels = res.files.map((f) => f.abs).sort();
    assert.deepEqual(rels, [
      path.join(root, 'plain', '.aider.chat.history.md'),
      path.join(root, 'repo1', '.claude', 'settings.local.json'),
      path.join(root, 'repo1', 'sub', '.mcp.json'),
    ]);

    assert.deepEqual(
      new Set(res.repos),
      new Set([path.join(root, 'repo1'), path.join(root, 'repo1', 'sub')]),
    );
    const nested = res.files.find((f) => f.abs.endsWith('.mcp.json'))!;
    assert.equal(nested.repoRoot, path.join(root, 'repo1', 'sub'));
    assert.equal(nested.rel, '.mcp.json');
    const nonRepo = res.files.find((f) => f.abs.endsWith('.aider.chat.history.md'))!;
    assert.equal(nonRepo.repoRoot, null);
  } finally {
    await cleanup(root);
  }
});

test('AS-9: max-depth bounds the walk', async () => {
  const root = await tempDir();
  try {
    await mkdir(path.join(root, 'a', 'b', 'c', '.claude'), { recursive: true });
    await writeFile(path.join(root, 'a', 'b', 'c', '.claude', 'settings.json'), '{}');
    const shallow = await walkRoot(root, { maxDepth: 2 });
    assert.equal(shallow.files.length, 0);
    const deep = await walkRoot(root, { maxDepth: 5 });
    assert.equal(deep.files.length, 1);
  } finally {
    await cleanup(root);
  }
});
