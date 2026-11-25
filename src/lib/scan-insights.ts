import { z } from "zod";
import { gradeSchema, type Grade, type ScanResult, type Severity } from "@/lib/scanner/types";
import { HISTORY_STORAGE_KEY, historyKey, type KeyValueStorage } from "@/lib/scan-history";

/**
 * Extra per-site history that powers the history menu and the "verify your fixes" panel: a short
 * score trend, open-issue counts and the titles of open issues. It lives under its own storage key
 * so the baseline history in `scan-history.ts` keeps its exact format.
 */

export const INSIGHTS_STORAGE_KEY = "shipsafe:scan-insights:v1";
export const MAX_TREND_POINTS = 8;
const MAX_TITLES = 60;
const MAX_SITES = 20;

const ISSUE_SEVERITIES: ReadonlySet<Severity> = new Set(["critical", "warning"]);

const snapshotSchema = z.object({
  score: z.number().int().min(0).max(100),
  grade: gradeSchema,
  critical: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  scannedAt: z.string().max(40),
});

const insightSchema = z.object({
  current: snapshotSchema,
  previous: snapshotSchema.nullable(),
  /** Oldest → newest, at most MAX_TREND_POINTS scores. */
  trend: z.array(z.number().int().min(0).max(100)).max(MAX_TREND_POINTS),
  /** id → title of every critical / warning finding in the latest scan. */
  openIssues: z.record(z.string().max(120), z.string().max(160)),
  /** Same, for the scan before the latest one. */
  previousOpenIssues: z.record(z.string().max(120), z.string().max(160)),
  scans: z.number().int().positive(),
});

const insightsSchema = z.record(z.string().max(500), insightSchema);

export type Snapshot = z.infer<typeof snapshotSchema>;
export type SiteInsight = z.infer<typeof insightSchema>;
type Insights = z.infer<typeof insightsSchema>;

export interface FixVerification {
  previousScannedAt: string;
  /** Titles of issues from the previous scan that are gone (passed or no longer reported). */
  fixed: string[];
  /** Titles of issues that dropped to an informational note. */
  improved: string[];
  /** Titles of issues that are still critical / warning. */
  stillOpen: string[];
  /** Titles of critical / warning findings that were not in the previous scan. */
  added: string[];
}

export function loadInsights(storage: KeyValueStorage | null | undefined): Insights {
  if (!storage) return {};
  try {
    const raw = storage.getItem(INSIGHTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = insightsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function snapshotOf(result: ScanResult): Snapshot {
  return {
    score: result.overallScore,
    grade: result.grade,
    critical: result.summary.critical,
    warning: result.summary.warning,
    scannedAt: result.scannedAt,
  };
}

function openIssuesOf(result: ScanResult): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const finding of result.findings) {
    if (!ISSUE_SEVERITIES.has(finding.severity)) continue;
    if (Object.keys(issues).length >= MAX_TITLES) break;
    issues[finding.id] = finding.title.slice(0, 160);
  }
  return issues;
}

/** Pure comparison used by the UI; `previous` is the open-issue map of the scan before `current`. */
export function verifyFixes(previousOpen: Record<string, string>, previousScannedAt: string, current: ScanResult): FixVerification {
  const severityNow = new Map(current.findings.map((finding) => [finding.id, finding.severity] as const));
  const fixed: string[] = [];
  const improved: string[] = [];
  const stillOpen: string[] = [];
  for (const [id, title] of Object.entries(previousOpen)) {
    const now = severityNow.get(id);
    if (now === undefined || now === "passed") fixed.push(title);
    else if (now === "info") improved.push(title);
    else stillOpen.push(title);
  }
  const added = current.findings.filter((finding) => ISSUE_SEVERITIES.has(finding.severity) && !(finding.id in previousOpen)).map((finding) => finding.title);
  return { previousScannedAt, fixed, improved, stillOpen, added };
}

/**
 * Stores this scan in the insights and returns the fix verification against the previous scan of
 * the same site (null on a first scan). Never throws: storage may be blocked or full.
 */
export function recordInsights(result: ScanResult, storage: KeyValueStorage | null | undefined): FixVerification | null {
  if (!storage) return null;
  const key = historyKey(result.finalUrl);
  const all = loadInsights(storage);
  const before = all[key];

  const verification = before ? verifyFixes(before.openIssues, before.current.scannedAt, result) : null;
  const trend = [...(before?.trend ?? []), result.overallScore].slice(-MAX_TREND_POINTS);
  const next: SiteInsight = {
    current: snapshotOf(result),
    previous: before?.current ?? null,
    trend,
    openIssues: openIssuesOf(result),
    previousOpenIssues: before?.openIssues ?? {},
    scans: (before?.scans ?? 0) + 1,
  };

  try {
    const merged: Insights = { ...all };
    delete merged[key];
    merged[key] = next;
    const entries = Object.entries(merged).sort(([, a], [, b]) => a.current.scannedAt.localeCompare(b.current.scannedAt));
    storage.setItem(INSIGHTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_SITES))));
  } catch {
    // The verification for this scan is still valid.
  }
  return verification;
}

export type SiteStatus = "clear" | "needs-work" | "critical";

export interface HistoryRow {
  site: string;
  score: number;
  grade: Grade;
  scannedAt: string;
  critical: number;
  warning: number;
  /** Score change since the previous scan, or null on a first scan. */
  delta: number | null;
  previousScore: number | null;
  trend: number[];
  scans: number;
  status: SiteStatus;
}

export function statusOf(critical: number, warning: number): SiteStatus {
  if (critical > 0) return "critical";
  return warning > 0 ? "needs-work" : "clear";
}

/**
 * One row per site for the history menu, newest first. `baseline` comes from `loadHistory` so sites
 * scanned before insights existed still appear (without trend or counts).
 */
export function buildHistoryRows(
  baseline: Record<string, { score: number; grade: Grade; scannedAt: string; issueIds: string[] }>,
  insights: Insights,
): HistoryRow[] {
  return Object.entries(baseline)
    .map(([site, scan]): HistoryRow => {
      const insight = insights[site];
      const critical = insight?.current.critical ?? 0;
      const warning = insight?.current.warning ?? scan.issueIds.length;
      return {
        site,
        score: scan.score,
        grade: scan.grade,
        scannedAt: scan.scannedAt,
        critical,
        warning: insight ? warning : scan.issueIds.length,
        delta: insight?.previous ? scan.score - insight.previous.score : null,
        previousScore: insight?.previous?.score ?? null,
        trend: insight?.trend ?? [scan.score],
        scans: insight?.scans ?? 1,
        status: insight ? statusOf(critical, warning) : statusOf(0, scan.issueIds.length),
      };
    })
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

/** Forgets all stored scans (history and insights). */
export function clearAllHistory(storage: KeyValueStorage | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(HISTORY_STORAGE_KEY, "{}");
    storage.setItem(INSIGHTS_STORAGE_KEY, "{}");
  } catch {
    // nothing to clear if storage is unavailable
  }
}
