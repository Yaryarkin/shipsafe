"use client";

import { useId, useState } from "react";
import type { FixSnippet } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";

/** Tabs of copy-paste fixes, one per stack (Next.js, Vercel, Nginx, Express, Android). */
export function FixSnippets({ snippets }: { snippets: FixSnippet[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const current = snippets[Math.min(active, snippets.length - 1)];
  if (!current) return null;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-raised">
      <div role="tablist" aria-label="Fix for your stack" className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5 [scrollbar-width:none]">
        {snippets.map((item, index) => {
          const selected = index === active;
          return (
            <button
              key={`${item.stack}-${item.label}`}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              onClick={() => setActive(index)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs transition-colors ${selected ? "chip-active" : "text-muted hover:text-fg"}`}
            >
              {item.label}
              {item.recommended && <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-faint">detected</span>}
            </button>
          );
        })}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`}>
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">{current.language}</span>
          <CopyButton text={current.code} label="Copy code" />
        </div>
        <pre className="max-h-64 overflow-auto px-3 pb-3 pt-1.5 font-mono text-xs leading-relaxed text-soft">{current.code}</pre>
      </div>
    </div>
  );
}
