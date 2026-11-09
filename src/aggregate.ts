import { fingerprint, mask } from './scan/mask.js';
import {
  CONF_RANK,
  GRADE_RANK,
  type Confidence,
  type Finding,
  type Location,
  type RawHit,
} from './types.js';
import { worstGrade } from './grade.js';

function betterRepresentative(a: RawHit, b: RawHit): RawHit {
  // Prefer the most specific rule (non-generic), then highest confidence.
  if (a.rule.generic !== b.rule.generic) return a.rule.generic ? b : a;
  return CONF_RANK[b.confidence] > CONF_RANK[a.confidence] ? b : a;
}

function dedupeLocations(locs: Location[]): Location[] {
  const seen = new Set<string>();
  const out: Location[] = [];
  for (const l of locs) {
    const key = `${l.kind}\0${l.repo ?? ''}\0${l.path}\0${l.commit ?? ''}\0${l.line}\0${l.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  out.sort((a, b) => {
    const g = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (g !== 0) return g;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.line - b.line || a.column - b.column;
  });
  return out;
}

/**
 * Group raw hits by fingerprint. This is the only module that reads
 * RawHit.secret; raw hits are dropped once aggregated.
 */
export function aggregate(hits: RawHit[]): Finding[] {
  const byFingerprint = new Map<string, RawHit[]>();
  for (const h of hits) {
    const fp = fingerprint(h.secret);
    const list = byFingerprint.get(fp);
    if (list) list.push(h);
    else byFingerprint.set(fp, [h]);
  }

  const findings: Finding[] = [];
  for (const [fp, list] of byFingerprint) {
    let rep = list[0]!;
    for (const h of list) rep = betterRepresentative(rep, h);
    const grades = list.map((h) => h.loc.grade);
    let confidence: Confidence = 'low';
    for (const h of list) {
      if (CONF_RANK[h.confidence] > CONF_RANK[confidence]) confidence = h.confidence;
    }
    const hasWorktree = list.some((h) => h.loc.kind === 'worktree');
    const hasHistory = list.some((h) => h.loc.kind === 'history');
    findings.push({
      fingerprint: fp,
      rule: rep.rule.id,
      title: rep.rule.title,
      confidence,
      grade: worstGrade(grades),
      historyOnly: hasHistory && !hasWorktree,
      masked: mask(rep.secret, rep.rule),
      length: rep.secret.length,
      locations: dedupeLocations(list.map((h) => h.loc)),
      advice: rep.rule.advice,
    });
    list.length = 0; // drop raw values
  }

  findings.sort((a, b) => {
    const g = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (g !== 0) return g;
    const c = CONF_RANK[b.confidence] - CONF_RANK[a.confidence];
    if (c !== 0) return c;
    const ap = a.locations[0]?.path ?? '';
    const bp = b.locations[0]?.path ?? '';
    return ap < bp ? -1 : ap > bp ? 1 : 0;
  });
  return findings;
}
