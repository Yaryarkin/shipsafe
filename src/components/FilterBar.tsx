import { ChevronDown } from "lucide-react";
import { CATEGORY_LABELS, type Category, type ScanResult } from "@/lib/scanner/types";

export type FindingFilter = "all" | "critical" | "warning" | "info" | "passed";
export type CategoryFilter = "all" | Category;

const FILTERS: Array<{ key: FindingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warnings" },
  { key: "info", label: "Info" },
  { key: "passed", label: "Passed" },
];

export function FilterBar({
  value,
  onChange,
  category,
  onCategoryChange,
  result,
}: {
  value: FindingFilter;
  onChange: (value: FindingFilter) => void;
  category: CategoryFilter;
  onCategoryChange: (value: CategoryFilter) => void;
  result: ScanResult;
}) {
  const counts: Record<FindingFilter, number> = {
    all: result.findings.length,
    critical: result.summary.critical,
    warning: result.summary.warning,
    info: result.summary.info,
    passed: result.summary.passed,
  };
  const categories = Array.from(new Set(result.findings.map((finding) => finding.category)));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Filter by severity" className="inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-card p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.filter((filter) => filter.key === "all" || counts[filter.key] > 0 || filter.key === value).map((filter) => {
          const active = value === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(filter.key)}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-[13px] transition-colors ${
                active ? "bg-raised text-fg shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-fg"
              }`}
            >
              {filter.label}
              <span className={`font-mono text-[11px] tabular-nums ${active ? "text-soft" : "text-faint"}`}>{counts[filter.key]}</span>
            </button>
          );
        })}
      </div>

      {categories.length > 1 && (
        <label className="relative inline-flex">
          <span className="sr-only">Filter by category</span>
          <select
            value={category}
            onChange={(event) => onCategoryChange(event.target.value as CategoryFilter)}
            className="h-8 appearance-none rounded-md border border-line bg-card pl-3 pr-8 text-[13px] text-soft transition-colors hover:border-line-strong focus:border-focus focus:outline-none"
          >
            <option value="all">All categories</option>
            {categories.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
        </label>
      )}
    </div>
  );
}
