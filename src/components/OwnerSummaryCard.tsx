import { buildOwnerSummary } from "@/lib/report-summary";
import type { ScanResult } from "@/lib/scanner/types";
import { revealStyle } from "./Reveal";
import { SeverityBadge } from "./SeverityBadge";

/** Plain-language summary shown at the top of the findings in the owner view. */
export function OwnerSummaryCard({ result }: { result: ScanResult }) {
  const summary = buildOwnerSummary(result);
  return (
    <section aria-label="Summary for owners" className="reveal surface rounded-lg p-5" style={revealStyle(2)}>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Summary for owners</p>
      <h3 className="mt-2 text-base font-medium text-fg">{summary.headline}</h3>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-soft">{summary.verdict}</p>
      {summary.risks.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {summary.risks.map((risk) => (
            <li key={risk.title} className="flex items-start gap-3">
              <span className="pt-0.5">
                <SeverityBadge severity={risk.severity} />
              </span>
              <span className="min-w-0 text-sm leading-relaxed">
                <span className="text-fg">{risk.title}.</span> <span className="text-muted">{risk.impact}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 border-t border-line pt-3 text-sm text-soft">
        <span className="text-fg">Next step: </span>
        {summary.nextStep}
      </p>
    </section>
  );
}
