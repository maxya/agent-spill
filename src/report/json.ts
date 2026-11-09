import type { Finding, Grade } from '../types.js';
import type { RunResult } from '../run.js';
import { VERSION } from '../version.js';

export interface JsonReport {
  tool: 'agent-spill';
  version: string;
  schema: 1;
  scannedAt: string;
  summary: {
    repos: number;
    files: number;
    historyBlobs: number;
    findings: number;
    byGrade: Record<Grade, number>;
    worstGrade: Grade;
    failOn: Grade;
    exitCode: number;
  };
  findings: {
    fingerprint: string;
    rule: string;
    confidence: string;
    grade: Grade;
    historyOnly: boolean;
    masked: string;
    length: number;
    locations: Finding['locations'];
    advice: string;
  }[];
  warnings: string[];
}

export function buildJsonReport(
  result: RunResult,
  failOn: Grade,
  exitCode: number,
): JsonReport {
  const byGrade: Record<Grade, number> = {
    PUSHED: 0,
    COMMITTED: 0,
    'AT-RISK': 0,
    LOCAL: 0,
  };
  for (const f of result.findings) byGrade[f.grade]++;

  return {
    tool: 'agent-spill',
    version: VERSION,
    schema: 1,
    scannedAt: new Date().toISOString(),
    summary: {
      repos: result.stats.repos,
      files: result.stats.files,
      historyBlobs: result.stats.historyBlobs,
      findings: result.findings.length,
      byGrade,
      worstGrade: result.findings[0]?.grade ?? 'LOCAL',
      failOn,
      exitCode,
    },
    findings: result.findings.map((f) => ({
      fingerprint: f.fingerprint,
      rule: f.rule,
      confidence: f.confidence,
      grade: f.grade,
      historyOnly: f.historyOnly,
      masked: f.masked,
      length: f.length,
      locations: f.locations,
      advice: f.advice,
    })),
    warnings: result.warnings,
  };
}

export function renderJson(
  result: RunResult,
  failOn: Grade,
  exitCode: number,
): string {
  return JSON.stringify(buildJsonReport(result, failOn, exitCode), null, 2);
}
