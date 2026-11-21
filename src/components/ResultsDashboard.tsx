"use client";

import { useMemo, useState } from "react";
import type { ScanDiff } from "@/lib/scan-history";
import { isBuildTarget } from "@/lib/scan-target";
import type { ScanResult } from "@/lib/scanner/types";
import { ExportBar } from "./ExportBar";
import { FilterBar, type CategoryFilter, type FindingFilter } from "./FilterBar";
import { FindingCard } from "./FindingCard";
import { ScoreCard } from "./ScoreCard";

const EMPTY_MESSAGE: Record<FindingFilter, string> = {
  all: "No findings match these filters.",
  critical: "No critical issues. Nothing here is an emergency.",
  warning: "No warnings.",
  info: "No informational notes.",
  passed: "No passed checks yet.",
};

export function ResultsDashboard({
  result,
  isDemo,
  scanDiff = null,
  onRescan,
  rescanning = false,
  onOpenPro,
}: {
  result: ScanResult;
  isDemo: boolean;
  scanDiff?: ScanDiff | null;
  onRescan?: () => void;
  rescanning?: boolean;
  onOpenPro: () => void;
}) {
  const [filter, setFilter] = useState<FindingFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const isBuild = isBuildTarget(result.target);

  const visible = useMemo(
    () =>
      result.findings.filter(
        (item) => (filter === "all" || item.severity === filter) && (category === "all" || item.category === category),
      ),
    [filter, category, result.findings],
  );

  return (
    <div className="animate-fade-up space-y-6">
      <ScoreCard result={result} isDemo={isDemo} scanDiff={scanDiff} onRescan={onRescan} rescanning={rescanning} />

      <section aria-labelledby="findings-title" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 id="findings-title" className="text-sm font-medium text-fg">
            Findings <span className="ml-1 font-mono text-xs text-faint">{visible.length}</span>
          </h3>
          <FilterBar value={filter} onChange={setFilter} category={category} onCategoryChange={setCategory} result={result} />
        </div>

        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            {category === "all" ? EMPTY_MESSAGE[filter] : EMPTY_MESSAGE.all}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((item) => (
              <FindingCard
                key={`${result.scannedAt}-${item.id}`}
                finding={item}
                defaultOpen={item.severity === "critical"}
                isBuild={isBuild}
                onOpenPro={onOpenPro}
              />
            ))}
          </ul>
        )}
      </section>

      <ExportBar result={result} isDemo={isDemo} onOpenPro={onOpenPro} />
    </div>
  );
}
