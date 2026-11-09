import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/aggregate.js';
import { meetsThreshold, worstGrade } from '../src/grade.js';
import { RULES } from '../src/scan/rules.js';
import type { Location, RawHit } from '../src/types.js';
import { fake } from './helpers/fake.js';

test('grade ordering and threshold', () => {
  assert.equal(worstGrade(['LOCAL', 'AT-RISK']), 'AT-RISK');
  assert.equal(worstGrade(['PUSHED', 'LOCAL', 'COMMITTED']), 'PUSHED');
  assert.equal(worstGrade([]), 'LOCAL');
  assert.equal(meetsThreshold('AT-RISK', 'AT-RISK'), true);
  assert.equal(meetsThreshold('LOCAL', 'AT-RISK'), false);
  assert.equal(meetsThreshold('PUSHED', 'COMMITTED'), true);
});

test('AS-14: one secret in home + history is one PUSHED finding with two locations', () => {
  const rule = RULES.find((r) => r.id === 'github-pat')!;
  const secret = fake.github();
  const home: Location = {
    kind: 'home',
    path: '/home/u/.zsh_history',
    line: 1,
    column: 1,
    grade: 'LOCAL',
  };
  const history: Location = {
    kind: 'history',
    repo: '/home/u/code/api',
    path: '.claude/settings.local.json',
    commit: 'a'.repeat(12),
    committedAt: '2026-01-02T03:04:05Z',
    line: 4,
    column: 31,
    grade: 'PUSHED',
  };
  const hits: RawHit[] = [
    { rule, secret, confidence: 'high', loc: home },
    { rule, secret, confidence: 'high', loc: history },
  ];
  const findings = aggregate(hits);
  assert.equal(findings.length, 1);
  const f = findings[0]!;
  assert.equal(f.grade, 'PUSHED');
  assert.equal(f.historyOnly, true);
  assert.equal(f.locations.length, 2);
  assert.equal(f.masked, 'gh…(40 chars)');
  assert.equal(f.length, 40);
  assert.ok(!JSON.stringify(f).includes(secret));
});

test('AS-14: findings sort by grade then confidence', () => {
  const github = RULES.find((r) => r.id === 'github-pat')!;
  const genericRule = RULES.find((r) => r.id === 'secret-named-assignment')!;
  const locLocal: Location = { kind: 'home', path: '/x', line: 1, column: 1, grade: 'LOCAL' };
  const locRisk: Location = { kind: 'worktree', repo: '/r', path: '.mcp.json', line: 1, column: 1, grade: 'AT-RISK' };
  const findings = aggregate([
    { rule: genericRule, secret: fake.generic(), confidence: 'medium', loc: locLocal },
    { rule: github, secret: fake.github(), confidence: 'high', loc: locRisk },
  ]);
  assert.equal(findings.length, 2);
  assert.equal(findings[0]!.grade, 'AT-RISK');
  assert.equal(findings[1]!.grade, 'LOCAL');
});
