import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholder,
  shannonEntropy,
  GENERIC_MIN_ENTROPY,
} from '../src/scan/placeholder.js';

test('isPlaceholder accepts common agent-command placeholders', () => {
  for (const v of [
    '$PGPASSWORD',
    '${DB_PASS}',
    '$(cat f)',
    '<password>',
    '****',
    'your-token',
    'changeme',
    '{{token}}',
    '[redacted]',
    '%DB_PASS%',
    '`cat secret`',
  ]) {
    assert.equal(isPlaceholder(v), true, `${v} should be a placeholder`);
  }
});

test('isPlaceholder rejects real-looking values', () => {
  for (const v of ['hunter2xyz9', 'Tr0ub4dor&3', 'QzAb12!xy']) {
    assert.equal(isPlaceholder(v), false, `${v} should not be a placeholder`);
  }
});

test('shannonEntropy behaves', () => {
  assert.equal(shannonEntropy('aaaa'), 0);
  assert.equal(shannonEntropy('abcd'), 2);
  assert.ok(shannonEntropy('QzAbCdEf123456') >= GENERIC_MIN_ENTROPY);
});
