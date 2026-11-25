import type { Finding, Grade, ScanSummary, ScoreBreakdown, Severity } from "./types";

/** Pure scoring helpers – safe to import from both server and client code. */

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, passed: 3 };
const PENALTY: Record<Severity, number> = { critical: 20, warning: 6, info: 0, passed: 0 };
/** Any critical finding caps the grade at D: a leaked key or exposed .env is never "ship-ready". */
const CRITICAL_SCORE_CAP = 69;

export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function scoreFindings(findings: Finding[]): { score: number; grade: Grade; summary: ScanSummary } {
  const summary: ScanSummary = { critical: 0, warning: 0, info: 0, passed: 0 };
  let score = 100;
  for (const item of findings) {
    summary[item.severity] += 1;
    score -= PENALTY[item.severity];
  }
  score = Math.max(0, Math.min(100, score));
  if (summary.critical > 0) score = Math.min(score, CRITICAL_SCORE_CAP);
  const rounded = Math.round(score);
  return { score: rounded, grade: gradeFor(rounded), summary };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Explains how the score was reached: points lost per severity and whether the critical cap applied. */
export function buildScoreBreakdown(findings: Finding[]): ScoreBreakdown {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0, passed: 0 };
  for (const item of findings) counts[item.severity] += 1;
  const items = (["critical", "warning"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => ({ severity, count: counts[severity], pointsEach: PENALTY[severity], points: counts[severity] * PENALTY[severity] }));
  const uncapped = Math.max(0, 100 - items.reduce((sum, item) => sum + item.points, 0));
  const capped = counts.critical > 0 && uncapped > CRITICAL_SCORE_CAP;
  return { base: 100, items, criticalCap: capped ? CRITICAL_SCORE_CAP : null, total: scoreFindings(findings).score };
}
