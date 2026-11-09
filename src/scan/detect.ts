import { RULES } from './rules.js';
import {
  isPlaceholder,
  shannonEntropy,
  GENERIC_MIN_ENTROPY,
  GENERIC_MIN_LEN,
} from './placeholder.js';
import { CONF_RANK, type Confidence, type Rule } from '../types.js';

export interface Hit {
  rule: Rule;
  secret: string;
  confidence: Confidence;
  index: number;
}

export function detect(text: string, minConf: Confidence): Hit[] {
  const hits: Hit[] = [];
  for (const rule of RULES) {
    if (rule.prefilter && !rule.prefilter.test(text)) continue;
    rule.re.lastIndex = 0;
    for (let m; (m = rule.re.exec(text)); ) {
      const secret = m.groups?.secret;
      if (!secret || isPlaceholder(secret)) continue;
      if (
        rule.generic &&
        (secret.length < GENERIC_MIN_LEN || shannonEntropy(secret) < GENERIC_MIN_ENTROPY)
      )
        continue;
      const conf = rule.validate ? rule.validate(secret, m) : rule.confidence;
      if (!conf || CONF_RANK[conf] < CONF_RANK[minConf]) continue;
      hits.push({
        rule,
        secret,
        confidence: conf,
        index: m.index + m[0].indexOf(secret),
      });
    }
  }
  // Same secret value at same index reported by several rules → keep the most
  // specific (non-generic, highest confidence).
  const best = new Map<string, Hit>();
  for (const h of hits) {
    const k = `${h.index}:${h.secret}`;
    const cur = best.get(k);
    if (
      !cur ||
      (cur.rule.generic && !h.rule.generic) ||
      CONF_RANK[h.confidence] > CONF_RANK[cur.confidence]
    )
      best.set(k, h);
  }
  return [...best.values()].sort((a, b) => a.index - b.index);
}
