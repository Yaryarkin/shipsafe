"use client";

import { useId, useState } from "react";
import { buildStackConfigs } from "@/lib/config-generator";
import type { ScanResult } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";
import { revealStyle } from "./Reveal";

/** One file that fixes every header and policy finding at once, for the detected stack (or all three). */
export function StackConfigPanel({ result, index = 3 }: { result: ScanResult; index?: number }) {
  const configs = buildStackConfigs(result);
  const [active, setActive] = useState(0);
  const baseId = useId();
  const current = configs[Math.min(active, configs.length - 1)];
  if (!current) return null;

  const covered = new Set(current.covers);
  const titles = result.findings.filter((item) => covered.has(item.id)).map((item) => item.title);

  return (
    <section aria-label="Unified stack config" className="reveal surface rounded-lg" style={revealStyle(index)}>
      <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-medium text-fg">Fix it all in one file</h2>
        <p className="font-mono text-xs text-faint">
          resolves {covered.size} {covered.size === 1 ? "finding" : "findings"}
        </p>
      </div>

      <div className="px-5 pt-4">
        <div role="tablist" aria-label="Stack" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {configs.map((config, position) => {
            const selected = position === active;
            return (
              <button
                key={config.stack}
                type="button"
                role="tab"
                id={`${baseId}-tab-${position}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                onClick={() => setActive(position)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors ${selected ? "chip-active" : "border border-transparent text-muted hover:text-fg"}`}
              >
                {config.label}
                {config.recommended && <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-faint">detected</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`} className="px-5 pb-5 pt-3">
        <div className="surface-raised overflow-hidden rounded-md">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="min-w-0 truncate font-mono text-xs text-muted">{current.filename}</span>
            <CopyButton text={current.code} label="Copy config" />
          </div>
          <pre className="max-h-80 overflow-auto px-3 py-3 font-mono text-xs leading-relaxed text-soft">{current.code}</pre>
        </div>

        {titles.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            <span className="text-soft">Covers:</span> {titles.join("; ")}.
          </p>
        )}
        {current.notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
            {current.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 h-px w-3 shrink-0 bg-line-strong" aria-hidden="true" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
