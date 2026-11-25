"use client";

import { useEffect, useMemo, useState } from "react";
import { useDeviceType } from "@/hooks/useDeviceType";
import { buildFixQueue, sortByPriority } from "@/lib/fix-queue";
import type { ReportView } from "@/lib/report-summary";
import type { ScanDiff } from "@/lib/scan-history";
import type { FixVerification } from "@/lib/scan-insights";
import { isBuildTarget } from "@/lib/scan-target";
import type { ScanResult } from "@/lib/scanner/types";
import { ExportBar } from "./ExportBar";
import { FilterBar, type CategoryFilter, type FindingFilter } from "./FilterBar";
import { FindingCard } from "./FindingCard";
import { FixQueuePanel } from "./FixQueuePanel";
import { FixVerificationPanel } from "./FixVerificationPanel";
import { OwnerSummaryCard } from "./OwnerSummaryCard";
import { revealStyle } from "./Reveal";
import { ReadinessGate } from "./ReadinessGate";
import { ScoreCard } from "./ScoreCard";
import { StackChips } from "./StackChips";
import { StackConfigPanel } from "./StackConfigPanel";
import { ViewToggle } from "./ViewToggle";

const VIEW_STORAGE_KEY = "shipsafe:report-view:v1";

const EMPTY_MESSAGE: Record<FindingFilter, string> = {
  all: "No findings match these filters.",
  critical: "No critical issues. Nothing here is an emergency.",
  warning: "No warnings.",
  info: "No informational notes.",
  passed: "No passed checks yet.",
};

function readStoredView(): ReportView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "owner" ? "owner" : "developer";
  } catch {
    return "developer";
  }
}

export function ResultsDashboard({
  result,
  isDemo,
  scanDiff = null,
  verification = null,
  onRescan,
  rescanning = false,
  onOpenPro,
}: {
  result: ScanResult;
  isDemo: boolean;
  scanDiff?: ScanDiff | null;
  verification?: FixVerification | null;
  onRescan?: () => void;
  rescanning?: boolean;
  onOpenPro: () => void;
}) {
  const [filter, setFilter] = useState<FindingFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [view, setView] = useState<ReportView>("developer");
  const isBuild = isBuildTarget(result.target);
  const { device } = useDeviceType();
  // Selecting a row in the fix queue clears the filters and opens that finding. The nonce lets the same row be chosen twice.
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const jumpTo = (id: string) => {
    setFilter("all");
    setCategory("all");
    setFocus((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }));
  };

  // The audience choice is remembered per browser. Read after mount so server and client markup match.
  useEffect(() => setView(readStoredView()), []);
  const changeView = (next: ReportView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // the choice simply is not remembered
    }
  };

  const visible = useMemo(
    () =>
      sortByPriority(result.findings).filter(
        (item) => (filter === "all" || item.severity === filter) && (category === "all" || item.category === category),
      ),
    [filter, category, result.findings],
  );
  const positions = useMemo(() => new Map(buildFixQueue(result.findings).map((entry) => [entry.id, entry.position] as const)), [result.findings]);

  // On a phone only the first critical card starts open, so the list stays short; larger screens open every critical one.
  const firstCriticalId = visible.find((item) => item.severity === "critical")?.id;
  const opensByDefault = (item: ScanResult["findings"][number]) =>
    item.severity === "critical" && (device !== "mobile" || item.id === firstCriticalId);

  return (
    <div className="space-y-6">
      <ReadinessGate result={result} index={1} />

    <div className="space-y-6 rail:grid rail:grid-cols-[17rem_minmax(0,1fr)] rail:items-start rail:gap-6 rail:space-y-0 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-8">
      {/*
        Summary column. Phones: stacked. Tablet portrait: score and verification side by side.
        Tablet landscape and desktop: a sticky side rail that also holds the filters.
      */}
      <aside
        aria-label="Summary and filters"
        className="rail-scroll space-y-4 md:max-lg:portrait:grid md:max-lg:portrait:grid-cols-2 md:max-lg:portrait:items-start md:max-lg:portrait:gap-4 md:max-lg:portrait:space-y-0 rail:sticky rail:top-[4.5rem] rail:-mx-3 rail:-my-2 rail:max-h-[calc(100dvh-5rem)] rail:overflow-y-auto rail:px-3 rail:py-2"
      >
        <div className={isDemo ? "md:max-lg:portrait:col-span-2" : ""}>
          <ScoreCard result={result} isDemo={isDemo} scanDiff={scanDiff} onRescan={onRescan} rescanning={rescanning} />
        </div>

        {!isDemo && <FixVerificationPanel verification={verification} onRescan={onRescan} rescanning={rescanning} />}

        <div className="md:max-lg:portrait:col-span-2">
          <StackChips detected={result.detectedStack} index={3} />
        </div>

        <div className="hidden rail:flex rail:flex-col rail:gap-3">
          <ViewToggle value={view} onChange={changeView} />
          <FilterBar layout="rail" value={filter} onChange={setFilter} category={category} onCategoryChange={setCategory} result={result} />
        </div>
      </aside>

      <div className="min-w-0 space-y-6">
        <FixQueuePanel findings={result.findings} onJump={jumpTo} index={2} />

        {view === "developer" && <StackConfigPanel result={result} index={3} />}

        {view === "owner" && <OwnerSummaryCard result={result} />}

        <section aria-labelledby="findings-title" className="space-y-3">
          <div className="reveal flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" style={revealStyle(3)}>
            <h3 id="findings-title" className="text-sm font-medium text-fg">
              Findings <span className="ml-1 font-mono text-xs text-faint">{visible.length}</span>
            </h3>
            {/* Phones and tablet portrait: filters sit above the list. The rail shows them instead on wider layouts. */}
            <div className="flex flex-col gap-3 rail:hidden lg:flex-row lg:items-center">
              <ViewToggle value={view} onChange={changeView} />
              <FilterBar value={filter} onChange={setFilter} category={category} onCategoryChange={setCategory} result={result} />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              {category === "all" ? EMPTY_MESSAGE[filter] : EMPTY_MESSAGE.all}
            </p>
          ) : (
            <ul className="space-y-2">
              {visible.map((item, index) => (
                <FindingCard
                  revealIndex={Math.min(index, 4) + 4}
                  // Remount when the audience changes so every card starts from its default open state.
                  key={`${result.scannedAt}-${item.id}-${view}`}
                  finding={item}
                  defaultOpen={opensByDefault(item)}
                  isBuild={isBuild}
                  onOpenPro={onOpenPro}
                  view={view}
                  site={result.target}
                  position={positions.get(item.id)}
                  focusNonce={focus?.id === item.id ? focus.nonce : undefined}
                />
              ))}
            </ul>
          )}
        </section>

        <ExportBar result={result} isDemo={isDemo} view={view} onOpenPro={onOpenPro} />
      </div>
    </div>
    </div>
  );
}
