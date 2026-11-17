import { z } from "zod";
import { gradeSchema, type Grade, type ScanResult, type Severity } from "@/lib/scanner/types";

/**
 * Client-side scan history (no database): the last scan per site is kept in localStorage so a
 * re-scan can show what changed. Storage is injectable so everything here is unit-testable.
 */

export const HISTORY_STORAGE_KEY = "shipsafe:scan-history:v1";
export const MAX_HISTORY_ENTRIES = 20;

const ISSUE_SEVERITIES: ReadonlySet<Severity> = new Set(["critical", "warning"]);

const storedScanSchema = z.object({
  score: z.number().int().min(0).max(100),
  grade: gradeSchema,
  /** Every finding id in the scan. */
  findingIds: z.array(z.string().max(120)).max(200),
  /** Ids that were critical or warning — needed to tell what got fixed (ids are stable per check). */
  issueIds: z.array(z.string().max(120)).max(200),
  scannedAt: z.string().max(40),
});

const historySchema = z.record(z.string().max(500), storedScanSchema);

export type StoredScan = z.infer<typeof storedScanSchema>;
type History = z.infer<typeof historySchema>;

export interface ScanDiff {
  previousScore: number;
  previousGrade: Grade;
  previousScannedAt: string;
  /** newScore - previousScore */
  scoreDelta: number;
  /** Findings that were critical/warning before and are now passed or gone. */
  fixedCount: number;
  /** Critical/warning findings that weren't issues in the previous scan. */
  newIssuesCount: number;
}

/** Minimal Storage surface (window.localStorage satisfies it). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * "https://www.Example.com/app/?x=1#y" and "http://example.com/app" share one history entry:
 * protocol, "www.", query, hash and trailing slashes are ignored.
 */
export function historyKey(finalUrl: string): string {
  try {
    const url = new URL(finalUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const port = url.port ? `:${url.port}` : "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${port}${path}`;
  } catch {
    return finalUrl.trim().toLowerCase();
  }
}

export function toStoredScan(result: ScanResult): StoredScan {
  return {
    score: result.overallScore,
    grade: result.grade,
    findingIds: result.findings.map((finding) => finding.id),
    issueIds: result.findings.filter((finding) => ISSUE_SEVERITIES.has(finding.severity)).map((finding) => finding.id),
    scannedAt: result.scannedAt,
  };
}

export function computeScanDiff(previous: StoredScan, current: ScanResult): ScanDiff {
  const currentSeverity = new Map(current.findings.map((finding) => [finding.id, finding.severity] as const));
  const previousIssues = new Set(previous.issueIds);

  const fixedCount = previous.issueIds.filter((id) => {
    const now = currentSeverity.get(id);
    return now === undefined || now === "passed";
  }).length;

  const newIssuesCount = current.findings.filter(
    (finding) => ISSUE_SEVERITIES.has(finding.severity) && !previousIssues.has(finding.id),
  ).length;

  return {
    previousScore: previous.score,
    previousGrade: previous.grade,
    previousScannedAt: previous.scannedAt,
    scoreDelta: current.overallScore - previous.score,
    fixedCount,
    newIssuesCount,
  };
}

/** True when the diff is worth showing: the score moved or something got fixed. */
export function isMeaningfulDiff(diff: ScanDiff | null | undefined): diff is ScanDiff {
  return Boolean(diff && (diff.scoreDelta !== 0 || diff.fixedCount > 0));
}

export function loadHistory(storage: KeyValueStorage): History {
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = historySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Keeps the most recently scanned MAX_HISTORY_ENTRIES sites. */
function trimHistory(history: History): History {
  const entries = Object.entries(history).sort(([, a], [, b]) => a.scannedAt.localeCompare(b.scannedAt));
  return Object.fromEntries(entries.slice(-MAX_HISTORY_ENTRIES));
}

/**
 * Compares a finished real scan with the previous scan of the same site, then stores it as the
 * new baseline. Returns null on a first scan. Never throws (private mode, full or blocked storage).
 */
export function recordScanAndDiff(result: ScanResult, storage: KeyValueStorage | null | undefined): ScanDiff | null {
  if (!storage) return null;
  const key = historyKey(result.finalUrl);
  const history = loadHistory(storage);
  const previous = history[key];
  const diff = previous ? computeScanDiff(previous, result) : null;

  try {
    const next: History = { ...history };
    delete next[key];
    next[key] = toStoredScan(result);
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimHistory(next)));
  } catch {
    // storage full or unavailable: the diff for this scan is still valid
  }
  return diff;
}

/** "62 (D) → 94 (A) · +32 pts · 4 issues fixed · 1 new issue" */
export function describeScanDiff(diff: ScanDiff, score: number, grade: Grade): string {
  const parts = [`${diff.previousScore} (${diff.previousGrade}) → ${score} (${grade})`];
  if (diff.scoreDelta !== 0) parts.push(`${diff.scoreDelta > 0 ? "+" : ""}${diff.scoreDelta} pts`);
  if (diff.fixedCount > 0) parts.push(`${diff.fixedCount} ${diff.fixedCount === 1 ? "issue" : "issues"} fixed`);
  if (diff.newIssuesCount > 0) parts.push(`${diff.newIssuesCount} new ${diff.newIssuesCount === 1 ? "issue" : "issues"}`);
  return parts.join(" · ");
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
