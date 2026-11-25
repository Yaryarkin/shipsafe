import { assessReadiness, type ReadinessStatus } from "@/lib/readiness";
import type { ScanResult } from "@/lib/scanner/types";
import { revealStyle } from "./Reveal";

/** Semantic color is allowed here: the gate indicator is a status indicator. */
const TONE: Record<ReadinessStatus, { badge: string; dot: string }> = {
  ready: { badge: "border-safe/30 bg-safe/10 text-safe", dot: "bg-safe" },
  attention: { badge: "border-warn/30 bg-warn/10 text-warn", dot: "bg-warn" },
  blocked: { badge: "border-critical/30 bg-critical/10 text-critical", dot: "bg-critical" },
};

export function ReadinessBadge({ status, label }: { status: ReadinessStatus; label: string }) {
  const tone = TONE[status];
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-2 rounded-md border px-2.5 font-mono text-xs font-medium ${tone.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Pre-Launch Readiness Gate: one verdict on whether this target is safe to launch, with the reasons. */
export function ReadinessGate({ result, index = 1 }: { result: ScanResult; index?: number }) {
  const gate = assessReadiness(result);

  return (
    <section aria-label="Pre-launch readiness gate" className="reveal surface rounded-lg p-5 sm:p-6" style={revealStyle(index)}>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Pre-launch gate</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <ReadinessBadge status={gate.status} label={gate.label} />
        <h2 className="text-base font-medium leading-snug text-fg">{gate.headline}</h2>
      </div>

      <div className="mt-5 grid gap-5 border-t border-line pt-5 md:grid-cols-2">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Why</h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-soft">
            {gate.reasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span className="mt-2 h-px w-3 shrink-0 bg-line-strong" aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
        {gate.holding.length > 0 && (
          <div>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Holding the gate</h3>
            <ol className="mt-2 space-y-1.5 text-sm leading-relaxed text-soft">
              {gate.holding.map((title, position) => (
                <li key={title} className="flex gap-2.5">
                  <span className="w-4 shrink-0 font-mono text-xs text-faint">{position + 1}</span>
                  <span className="min-w-0">{title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {gate.unlock && <p className="mt-5 border-t border-line pt-4 font-mono text-xs text-muted">{gate.unlock}</p>}
    </section>
  );
}
