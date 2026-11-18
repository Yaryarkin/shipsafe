import { ArrowUpRight, Clock, RotateCw, TrendingDown, TrendingUp } from "lucide-react";
import { describeScanDiff, isMeaningfulDiff, type ScanDiff } from "@/lib/scan-history";
import type { Grade, ScanResult } from "@/lib/scanner/types";
import { displayTarget } from "@/lib/scan-target";
import { buildShareText, buildXIntentUrl, SITE_URL } from "@/lib/share";
import { CopyButton } from "./CopyButton";

const GRADE_COLOR: Record<Grade, { stroke: string; text: string; badge: string }> = {
  A: { stroke: "#10b981", text: "text-emerald-400", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  B: { stroke: "#10b981", text: "text-emerald-400", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  C: { stroke: "#f59e0b", text: "text-amber-400", badge: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  D: { stroke: "#f59e0b", text: "text-amber-400", badge: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  F: { stroke: "#ef4444", text: "text-red-400", badge: "border-red-500/30 bg-red-500/10 text-red-400" },
};

const VERDICT: Record<Grade, string> = {
  A: "Ready to ship. Nice work.",
  B: "Solid. A few hardening steps left.",
  C: "Shippable, but fix the warnings soon.",
  D: "Fix the issues below before launch.",
  F: "Not launch-ready. Fix critical issues first.",
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-line bg-ink px-3 py-2.5">
      <div className={`font-mono text-xl font-semibold tabular-nums ${value > 0 ? tone : "text-zinc-500"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

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
  const color = GRADE_COLOR[result.grade];
  const offset = CIRCUMFERENCE * (1 - result.overallScore / 100);
  const host = displayTarget(result.target);
  const shareText = buildShareText(result.overallScore, result.grade, SITE_URL, scanDiff, result.target);
  const diff = isMeaningfulDiff(scanDiff) ? scanDiff : null;
  const diffTone = !diff
    ? ""
    : diff.scoreDelta > 0
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : diff.scoreDelta < 0
        ? "border-red-500/30 bg-red-500/10 text-red-400"
        : "border-line bg-ink text-zinc-300";

  return (
    <section aria-label="Scan score" className="rounded-lg border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="relative mx-auto h-32 w-32 shrink-0 sm:mx-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="#27272a" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={color.stroke}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.2, 0.7, 0.2, 1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight">{result.overallScore}</span>
            <span className="text-xs text-zinc-500">/ 100</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-sm font-bold ${color.badge}`}>
                Grade {result.grade}
              </span>
              {isDemo && (
                <span className="inline-flex h-6 items-center rounded border border-line px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Demo report
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Scanned in {(result.scanDurationMs / 1000).toFixed(1)}s
              </span>
              {!isDemo && (
                <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <CopyButton text={shareText} label="Copy Share Text" />
                  <a
                    href={buildXIntentUrl(shareText)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-xs font-semibold text-ink transition-colors hover:bg-zinc-200"
                  >
                    Post on X
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </span>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight" title={result.target}>
                {host}
              </h2>
              {onRescan && (
                <button
                  type="button"
                  onClick={onRescan}
                  disabled={rescanning}
                  title="Re-check this site after applying fixes"
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-ink px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${rescanning ? "animate-spin" : ""}`} aria-hidden="true" />
                  Re-scan
                </button>
              )}
            </div>
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
            <p className={`text-sm ${color.text}`}>{VERDICT[result.grade]}</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Critical" value={result.summary.critical} tone="text-red-400" />
            <Stat label="Warnings" value={result.summary.warning} tone="text-amber-400" />
            <Stat label="Passed" value={result.summary.passed} tone="text-emerald-400" />
          </div>
          {result.summary.info > 0 && (
            <p className="text-xs text-zinc-500">
              + {result.summary.info} informational {result.summary.info === 1 ? "note" : "notes"} (no score impact)
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
