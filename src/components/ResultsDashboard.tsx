"use client";

import { useMemo, useState } from "react";
import type { ScanDiff } from "@/lib/scan-history";
import { isBuildTarget } from "@/lib/scan-target";
import type { ScanResult } from "@/lib/scanner/types";
import { ExportBar } from "./ExportBar";
import { FilterBar, type FindingFilter } from "./FilterBar";
import { FindingCard } from "./FindingCard";
import { ScoreCard } from "./ScoreCard";

const EMPTY_MESSAGE: Record<FindingFilter, string> = {
  all: "No findings.",
  critical: "No critical issues. Nothing here is an emergency.",
  warning: "No warnings.",
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
  const isBuild = isBuildTarget(result.target);

  const visible = useMemo(
    () => (filter === "all" ? result.findings : result.findings.filter((item) => item.severity === filter)),
    [filter, result.findings],
  );

  return (
    <div className="animate-fade-up space-y-4">
      <ScoreCard result={result} isDemo={isDemo} scanDiff={scanDiff} onRescan={onRescan} rescanning={rescanning} />

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-medium text-zinc-400">
          Findings <span className="font-mono text-zinc-600">({visible.length})</span>
        </h3>
        <FilterBar value={filter} onChange={setFilter} result={result} />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-zinc-500">
          {EMPTY_MESSAGE[filter]}
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

      <ExportBar result={result} isDemo={isDemo} onOpenPro={onOpenPro} />
    </div>
  );
}
