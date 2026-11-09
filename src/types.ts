export type Grade = 'LOCAL' | 'AT-RISK' | 'COMMITTED' | 'PUSHED';
export const GRADE_RANK: Record<Grade, number> = {
  LOCAL: 1,
  'AT-RISK': 2,
  COMMITTED: 3,
  PUSHED: 4,
};

export type Confidence = 'low' | 'medium' | 'high';
export const CONF_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

export interface Rule {
  id: string;
  title: string;
  /** MUST be /g and contain a named `secret` group. */
  re: RegExp;
  confidence: Confidence;
  /** Only characters ever displayed for this rule's secret. */
  vendorPrefix?: string;
  /** Apply the generic entropy floor. */
  generic?: boolean;
  /** Cheap literal superset check run before the full regex (no `g` flag). */
  prefilter?: RegExp;
  advice: AdviceKey;
  /** `null` means drop the hit. May raise/lower confidence. */
  validate?: (secret: string, m: RegExpExecArray) => Confidence | null;
}

export type AdviceKey =
  | 'rotate-db-password'
  | 'rotate-api-key'
  | 'rotate-cloud-key'
  | 'rotate-private-key'
  | 'rotate-generic'
  | 'rotate-webhook';

export type LocationKind = 'worktree' | 'history' | 'home';

export interface Location {
  kind: LocationKind;
  /** Absolute repo root (worktree/history only). */
  repo?: string;
  /** Repo-relative for worktree/history, absolute for home. */
  path: string;
  /** History only (12 chars). */
  commit?: string;
  /** History only, ISO timestamp. */
  committedAt?: string;
  line: number;
  column: number;
  grade: Grade;
}

/** Internal only — never leaves aggregate.ts. Holds the raw value. */
export interface RawHit {
  rule: Rule;
  secret: string;
  confidence: Confidence;
  loc: Location;
}

/** Public — safe to render. No raw value. */
export interface Finding {
  fingerprint: string;
  rule: string;
  title: string;
  confidence: Confidence;
  grade: Grade;
  historyOnly: boolean;
  masked: string;
  length: number;
  locations: Location[];
  advice: AdviceKey;
}

export interface ScanWarning {
  message: string;
}

export interface ScanStats {
  repos: number;
  files: number;
  historyBlobs: number;
}
