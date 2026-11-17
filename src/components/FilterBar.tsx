import type { ScanResult } from "@/lib/scanner/types";

export type FindingFilter = "all" | "critical" | "warning" | "passed";

const FILTERS: Array<{ key: FindingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warnings" },
  { key: "passed", label: "Passed" },
];

export function FilterBar({
  value,
  onChange,
  result,
}: {
  value: FindingFilter;
  onChange: (value: FindingFilter) => void;
  result: ScanResult;
}) {
  const counts: Record<FindingFilter, number> = {
    all: result.findings.length,
    critical: result.summary.critical,
    warning: result.summary.warning,
    passed: result.summary.passed,
  };

  return (
    <div role="group" aria-label="Filter findings" className="inline-flex rounded-md border border-line bg-card p-0.5">
      {FILTERS.map((filter) => {
        const active = value === filter.key;
        return (
          <button
            key={filter.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter.key)}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm transition-colors sm:px-3 ${
              active ? "bg-line text-fg" : "text-zinc-400 hover:text-fg"
            }`}
          >
            {filter.label}
            <span className={`font-mono text-xs tabular-nums ${active ? "text-zinc-300" : "text-zinc-600"}`}>{counts[filter.key]}</span>
          </button>
        );
      })}
    </div>
  );
}
