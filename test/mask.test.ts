import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, mask } from '../src/scan/mask.js';
import { RULES } from '../src/scan/rules.js';
import { fake } from './helpers/fake.js';

const github = RULES.find((r) => r.id === 'github-pat')!;
const pg = RULES.find((r) => r.id === 'pg-password-env')!;

test('mask shows only the fixed vendor prefix and length', () => {
  assert.equal(mask(fake.github(), github), 'gh…(40 chars)');
  assert.equal(mask('hunter2xyz', pg), '…(10 chars)');
  const anthropicValue = 'sk-ant-api03-whatever';
  assert.equal(
    mask(anthropicValue, RULES.find((r) => r.id === 'anthropic-key')!),
    `sk-ant-…(${anthropicValue.length} chars)`,
  );
});

test('fingerprint is stable within a run and distinct across secrets', () => {
  const a = fake.password();
  const b = 'Qz' + 'xxYYzz9911' + '!7';
  assert.equal(fingerprint(a), fingerprint(a));
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.equal(fingerprint(a).length, 12);
});
