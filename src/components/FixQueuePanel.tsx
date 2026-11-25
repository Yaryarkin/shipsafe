"use client";

import { useState } from "react";
import { buildFixQueue, EFFORT_LABELS, queueByTier, TIER_HINTS, TIER_LABELS, type QueueItem } from "@/lib/fix-queue";
import type { Finding } from "@/lib/scanner/types";
import { revealStyle } from "./Reveal";

const DOT: Record<QueueItem["severity"], string> = {
  critical: "bg-critical",
  warning: "bg-warn",
  info: "bg-muted",
};

const INITIAL_VISIBLE = 8;

/** The order to patch things in: fix now, fix next, when you can. Selecting a row jumps to that finding. */
export function FixQueuePanel({ findings, onJump, index = 2 }: { findings: readonly Finding[]; onJump: (id: string) => void; index?: number }) {
  const queue = buildFixQueue(findings);
  const [expanded, setExpanded] = useState(false);
  if (queue.length === 0) return null;

  const visibleIds = new Set((expanded ? queue : queue.slice(0, INITIAL_VISIBLE)).map((entry) => entry.id));
  const hidden = queue.length - visibleIds.size;

  return (
    <section aria-label="Fix priority queue" className="reveal surface rounded-lg" style={revealStyle(index)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-sm font-medium text-fg">Fix priority queue</h2>
        <span className="font-mono text-xs text-faint">{queue.length} to fix</span>
      </div>

      <div className="divide-y divide-line">
        {queueByTier(queue).map((group) => {
          const rows = group.items.filter((entry) => visibleIds.has(entry.id));
          if (rows.length === 0) return null;
          return (
            <div key={group.tier} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-[13px] font-medium text-fg">{TIER_LABELS[group.tier]}</h3>
                <p className="text-xs text-faint">{TIER_HINTS[group.tier]}</p>
              </div>
              <ol className="mt-3 space-y-0.5">
                {rows.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onJump(entry.id)}
                      className="grid w-full grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-raised sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
                    >
                      <span className="pt-0.5 font-mono text-xs tabular-nums text-faint">{String(entry.position).padStart(2, "0")}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[entry.severity]}`} aria-hidden="true" />
                          <span className="min-w-0 truncate">{entry.title}</span>
                          {entry.position === 1 && <span className="shrink-0 rounded-md border border-brand/40 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-brand">Start here</span>}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{entry.reason}</span>
                      </span>
                      <span className="col-start-2 mt-1 font-mono text-[11px] text-faint sm:col-start-3 sm:mt-0.5 sm:text-right">{EFFORT_LABELS[entry.effort]}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>

      {queue.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full border-t border-line px-5 py-3 text-left text-xs text-muted transition-colors hover:text-fg"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}
