"use client";

import { Link2, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { buildLaunchUrl } from "@/lib/launch-params";
import { browserStorage, loadHistory } from "@/lib/scan-history";
import { buildHistoryRows, clearAllHistory, loadInsights, type HistoryRow, type SiteStatus } from "@/lib/scan-insights";
import { SITE_URL } from "@/lib/share";
import { BadgePanel } from "./BadgePanel";
import { GRADE_TONE } from "./grade-tone";
import { MonitoringWaitlist } from "./MonitoringWaitlist";
import { Reveal } from "./Reveal";
import { useScan } from "./ScanProvider";

const STATUS_STYLE: Record<SiteStatus, string> = {
  clear: "text-safe",
  "needs-work": "text-warn",
  critical: "text-critical",
};

function statusLabel(row: HistoryRow): string {
  if (row.status === "clear") return "All clear";
  if (row.status === "critical") return `${row.critical} critical${row.warning > 0 ? ` · ${row.warning} warn` : ""}`;
  return `${row.warning} ${row.warning === 1 ? "warning" : "warnings"}`;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Tiny score trend (oldest → newest), drawn once a site has two or more scans. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="font-mono text-[11px] text-faint">first scan</span>;
  const width = 72;
  const height = 20;
  const points = values
    .map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${(height - 2 - (value / 100) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={`Score trend: ${values.join(", ")}`} role="img" className="shrink-0 text-muted">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function readRows(): HistoryRow[] {
  const storage = browserStorage();
  return storage ? buildHistoryRows(loadHistory(storage), loadInsights(storage)) : [];
}

/** History & badges: every scanned site with its trend, quick re-run, and a badge for the selected site. */
export function HistoryView() {
  const { pickHistory, scanning, result, isDemo, href } = useScan();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => setRows(readRows()), [result]);

  const selected = rows?.find((row) => row.site === picked) ?? rows?.[0] ?? null;

  return (
    <div className="space-y-10 pt-8 sm:pt-12">
      <Reveal index={0}>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">History &amp; badges</p>
        <h1 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">Track your fixes over time</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          Every site you scan is remembered in this browser only. Re-scan after patching to see what changed, then show your grade with a badge.
        </p>
      </Reveal>

      <div className="grid items-start gap-6 rail:grid-cols-[minmax(0,1fr)_22rem] lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-8">
      <Reveal as="section" index={1} aria-label="Scan history" className="surface @container rounded-lg">
        {rows === null ? (
          <p className="px-5 py-10 text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-soft">No scans yet.</p>
            <p className="mt-1 text-xs text-muted">Your last 20 sites will appear here, with their score trend.</p>
            <Link href={href("/")} className="btn-primary mt-5 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium">
              Scan a site
            </Link>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const isSelected = selected?.site === row.site;
                return (
                  <li key={row.site} className="flex flex-col gap-3 px-4 py-3.5 @2xl:flex-row @2xl:items-center @2xl:gap-4 @2xl:px-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-semibold ${GRADE_TONE[row.grade].badge}`}
                        aria-label={`Grade ${row.grade}`}
                      >
                        {row.grade}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-fg">{row.site}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                          <span className={STATUS_STYLE[row.status]}>{statusLabel(row)}</span>
                          <span className="text-faint">
                            {shortDate(row.scannedAt)}
                            {row.scans > 1 ? ` · ${row.scans} scans` : ""}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 @2xl:justify-end">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-lg tabular-nums text-fg">{row.score}</span>
                        {row.delta !== null && row.delta !== 0 && (
                          <span className={`font-mono text-xs tabular-nums ${row.delta > 0 ? "text-safe" : "text-critical"}`} title={`Previous scan: ${row.previousScore}`}>
                            {row.delta > 0 ? "▲ +" : "▼ "}
                            {row.delta}
                          </span>
                        )}
                      </div>
                      <Sparkline values={row.trend} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={scanning}
                        onClick={() => pickHistory(`https://${row.site}`)}
                        className="chip inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-soft hover:text-fg disabled:opacity-60"
                        title="Re-scan to verify your fixes"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                        Re-scan
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyText(buildLaunchUrl(SITE_URL, { url: `https://${row.site}`, autoScan: true }));
                          setCopied(ok ? row.site : null);
                          window.setTimeout(() => setCopied(null), 1500);
                        }}
                        className="chip inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-soft hover:text-fg"
                        title="Copy a link that opens the scanner with this site and starts the scan"
                      >
                        <Link2 className={`h-3.5 w-3.5 ${copied === row.site ? "text-safe" : ""}`} aria-hidden="true" />
                        {copied === row.site ? "Copied" : "Link"}
                      </button>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setPicked(row.site)}
                        className={`chip inline-flex h-8 items-center rounded-md px-3 text-xs ${isSelected ? "chip-active" : "text-soft hover:text-fg"}`}
                      >
                        Badge
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-faint">
              <span>Stored only in this browser.</span>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm("Remove all scan history from this browser?")) return;
                  clearAllHistory(browserStorage());
                  setRows([]);
                }}
                className="inline-flex items-center gap-1 text-muted transition-colors hover:text-critical"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Clear history
              </button>
            </div>
          </>
        )}
      </Reveal>

      <Reveal as="section" index={2} aria-label="Badge" className="surface rounded-lg p-5 sm:p-6 rail:sticky rail:top-20">
        <h2 className="text-sm font-medium text-fg">README badge</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {selected ? (
            <>
              Showing <span className="font-mono text-soft">{selected.site}</span> ({selected.grade}, {selected.score}/100). Pick another site above with its Badge button.
            </>
          ) : (
            "Scan a site first, then copy a badge for your README, itch.io page or docs."
          )}
        </p>
        <div className="mt-4 flex max-w-xl flex-col gap-3">
          {selected && !(isDemo && !rows?.length) ? (
            <BadgePanel score={selected.score} grade={selected.grade} />
          ) : (
            <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-xs text-faint">No badge yet. Run a real scan to get one.</p>
          )}
        </div>
      </Reveal>

      </div>

      <MonitoringWaitlist revealIndex={3} defaultSite={result && !isDemo && !result.target.startsWith("build:") ? result.target : undefined} />
    </div>
  );
}
