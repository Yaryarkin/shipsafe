import { ArrowUpRight, RotateCw, TrendingDown, TrendingUp } from "lucide-react";
import { describeScanDiff, isMeaningfulDiff, type ScanDiff } from "@/lib/scan-history";
import type { Grade, ScanResult } from "@/lib/scanner/types";
import { displayTarget } from "@/lib/scan-target";
import { buildShareText, buildXIntentUrl, SITE_URL } from "@/lib/share";
import { CopyButton } from "./CopyButton";
import { GRADE_TONE } from "./grade-tone";

const VERDICT: Record<Grade, string> = {
  A: "Ready to ship.",
  B: "Solid. A few hardening steps left.",
  C: "Shippable, but fix the warnings soon.",
  D: "Fix the issues below before launch.",
  F: "Not launch-ready. Fix critical issues first.",
};

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Mobile: 2×2 grid. ≥sm: one row of four. Borders are drawn per cell so both layouts stay crisp. */
const CELL_BORDERS = ["", "border-l", "border-t sm:border-t-0 sm:border-l", "border-l border-t sm:border-t-0"];

export function ScoreCard({
  result,
  isDemo,
  scanDiff = null,
  onRescan,
  rescanning = false,
}: {
  result: ScanResult;
  isDemo: boolean;
  scanDiff?: ScanDiff | null;
  onRescan?: () => void;
  rescanning?: boolean;
}) {
  const tone = GRADE_TONE[result.grade];
  const offset = CIRCUMFERENCE * (1 - result.overallScore / 100);
  const host = displayTarget(result.target);
  const shareText = buildShareText(result.overallScore, result.grade, SITE_URL, scanDiff, result.target);
  const diff = isMeaningfulDiff(scanDiff) ? scanDiff : null;
  const diffTone = !diff
    ? ""
    : diff.scoreDelta > 0
      ? "border-safe/25 bg-safe/10 text-safe"
      : diff.scoreDelta < 0
        ? "border-critical/25 bg-critical/10 text-critical"
        : "border-line bg-raised text-soft";

  const stats = [
    { label: "Critical", value: result.summary.critical, color: "text-critical", dot: "bg-critical" },
    { label: "Warnings", value: result.summary.warning, color: "text-warn", dot: "bg-warn" },
    { label: "Info", value: result.summary.info, color: "text-soft", dot: "bg-muted" },
    { label: "Passed", value: result.summary.passed, color: "text-safe", dot: "bg-safe" },
  ];

  return (
    <section aria-label="Scan score" className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#1f2430" strokeWidth="5" />
            <circle
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke={tone.stroke}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.2, 0.7, 0.2, 1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-[28px] font-medium leading-none tabular-nums tracking-tight">{result.overallScore}</span>
            <span className="mt-1 font-mono text-[11px] text-faint">/ 100</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-6 items-center rounded-md border px-2 font-mono text-xs font-semibold ${tone.badge}`}>
              Grade {result.grade}
            </span>
            {isDemo && (
              <span className="inline-flex h-6 items-center rounded-md border border-line px-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                Demo
              </span>
            )}
            <span className="font-mono text-xs text-faint">{(result.scanDurationMs / 1000).toFixed(1)}s</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-mono text-lg font-medium tracking-tight text-fg" title={result.target}>
              {host}
            </h2>
            {onRescan && (
              <button
                type="button"
                onClick={onRescan}
                disabled={rescanning}
                title="Re-check this site after applying fixes"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs text-soft transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCw className={`h-3.5 w-3.5 ${rescanning ? "animate-spin" : ""}`} aria-hidden="true" />
                Re-scan
              </button>
            )}
          </div>
          <p className={`text-sm ${tone.text}`}>{VERDICT[result.grade]}</p>
          {diff && (
            <p
              data-testid="scan-diff"
              className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums ${diffTone}`}
              title={`Compared with your previous scan of this site (${new Date(diff.previousScannedAt).toLocaleString()})`}
            >
              {diff.scoreDelta > 0 ? (
                <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : diff.scoreDelta < 0 ? (
                <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : null}
              <span className="truncate">{describeScanDiff(diff, result.overallScore, result.grade)}</span>
            </p>
          )}
        </div>

        {!isDemo && (
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
            <CopyButton text={shareText} label="Copy share text" />
            <a
              href={buildXIntentUrl(shareText)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3 text-xs text-soft transition-colors hover:border-line-strong hover:text-fg"
            >
              Post on X
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
        {stats.map((stat, index) => (
          <div key={stat.label} className={`border-line px-5 py-3.5 sm:px-6 ${CELL_BORDERS[index]}`}>
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${stat.dot}`} aria-hidden="true" />
              {stat.label}
            </dt>
            <dd className={`mt-1 font-mono text-xl font-medium tabular-nums ${stat.value > 0 ? stat.color : "text-faint"}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
