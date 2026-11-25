import type { ScanResult } from "@/lib/scanner/types";
import { revealStyle } from "./Reveal";

/** The stack the scan detected, as mono tags. Fix snippets for these stacks are listed first. */
export function StackChips({ detected, index = 2 }: { detected: ScanResult["detectedStack"]; index?: number }) {
  const items = detected ?? [];

  return (
    <section aria-label="Detected stack" className="reveal surface rounded-lg p-4" style={revealStyle(index)}>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Detected stack</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">No clear stack signals. Fixes are shown for every common stack.</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {items.map((item) => (
              <li
                key={item.id}
                title={item.signals.join(" · ")}
                className="chip inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-soft"
              >
                {item.label}
                <span className={`text-[10px] ${item.confidence === "high" ? "text-muted" : "text-faint"}`}>{item.confidence}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">Fixes for this stack are listed first in every finding.</p>
        </>
      )}
    </section>
  );
}
