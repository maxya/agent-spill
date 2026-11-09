import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detect } from '../src/scan/detect.js';
import {
  extractJsonlFile,
  extractString,
  formatFor,
  type Unit,
} from '../src/scan/extract.js';
import { fake, tempDir, cleanup } from './helpers/fake.js';

function hitsOf(units: Unit[]) {
  return units.flatMap((u) => detect(u.text, 'low').map((h) => ({ u, h })));
}

test('formatFor dispatches by extension', () => {
  assert.equal(formatFor('/a/b.json'), 'json');
  assert.equal(formatFor('/a/b.jsonl'), 'jsonl');
  assert.equal(formatFor('/a/b.md'), 'text');
});

test('AS-7: decoded JSON allow-rule produces one pg hit with the right line', () => {
  const pw = fake.password();
  const raw = JSON.stringify({
    permissions: { allow: [`Bash(PGPASSWORD="${pw}" psql -h db)`] },
  });
  const units = [...extractString(raw, 'json')];
  const pg = hitsOf(units).filter((x) => x.h.rule.id === 'pg-password-env');
  assert.equal(pg.length, 1);
  assert.equal(pg[0]!.u.line, 1);
  assert.equal(pg[0]!.h.secret, pw);
});

test('JSON is parsed, not regexed raw: escaped quotes are decoded', () => {
  const raw = JSON.stringify({ cmd: 'PGPASSWORD="abc12345" psql' });
  const [unit] = [...extractString(raw, 'json')];
  assert.ok(unit);
  assert.ok(unit.text.includes('PGPASSWORD="abc12345" psql'));
  assert.ok(!unit.text.includes('\\"'));
});

test('AS-7: a 3-line JSONL fixture reports line 2 for a secret on line 2', async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, 'x.jsonl');
    await writeFile(
      file,
      [
        JSON.stringify({ a: 'nothing here' }),
        JSON.stringify({ b: 'PGPASSWORD=LineTwoPass99 psql' }),
        JSON.stringify({ c: 'also nothing' }),
        '',
      ].join('\n'),
    );
    const units: Unit[] = [];
    for await (const u of extractJsonlFile(file)) units.push(u);
    const pg = hitsOf(units).filter((x) => x.h.rule.id === 'pg-password-env');
    assert.equal(pg.length, 1);
    assert.equal(pg[0]!.u.line, 2);
  } finally {
    await cleanup(dir);
  }
});

test('unparseable JSON falls back to text without throwing', () => {
  const raw = '{"broken": PGPASSWORD=FallbackPass11';
  const units = [...extractString(raw, 'json')];
  assert.ok(units.length >= 1);
  assert.ok(units[0]!.text.includes('PGPASSWORD=FallbackPass11'));
});

test('zsh extended-history prefix is stripped', () => {
  const units = [...extractString(': 1700000000:0;mysql -pZshPass22 db', 'text', { stripZsh: true })];
  assert.equal(units[0]!.text, 'mysql -pZshPass22 db');
});
