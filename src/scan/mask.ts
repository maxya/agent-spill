import { createHmac, randomBytes } from 'node:crypto';
import type { Rule } from '../types.js';

// Per-process key; never persisted. An unsalted hash of a low-entropy password
// can be brute-forced offline, and the JSON report may be pasted into CI logs.
const RUN_KEY = randomBytes(32);

export function fingerprint(secret: string): string {
  return createHmac('sha256', RUN_KEY).update(secret, 'utf8').digest('hex').slice(0, 12);
}

export function mask(secret: string, rule: Rule): string {
  const p =
    rule.vendorPrefix && secret.startsWith(rule.vendorPrefix) ? rule.vendorPrefix : '';
  return `${p}…(${secret.length} chars)`;
}
