"use client";

import { ChevronDown, LifeBuoy } from "lucide-react";
import { useId, useState } from "react";
import { auditOfferFor } from "@/lib/audit-offer";
import { CATEGORY_LABELS, type Finding } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";
import { SeverityBadge } from "./SeverityBadge";

export function FindingCard({
  finding,
  defaultOpen = false,
  isBuild = false,
  onOpenPro,
}: {
  finding: Finding;
  defaultOpen?: boolean;
  isBuild?: boolean;
  onOpenPro?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const offer = auditOfferFor(finding, isBuild);

  return (
    <li className="overflow-hidden rounded-lg border border-line bg-card transition-colors hover:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <SeverityBadge severity={finding.severity} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg sm:whitespace-normal">{finding.title}</span>
          <span className="mt-0.5 block text-xs text-zinc-500">{CATEGORY_LABELS[finding.category]}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={panelId} className="animate-fade-in space-y-4 border-t border-line px-4 pb-4 pt-3.5">
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Why it matters</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{finding.description}</p>
          </div>

          {finding.evidence && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Evidence</h4>
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-ink px-3 py-2.5 font-mono text-xs leading-relaxed text-zinc-300">
                {finding.evidence}
              </pre>
            </div>
          )}

          {finding.fixPrompt && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line px-3 py-2.5">
              <p className="text-xs text-zinc-400">Paste into Cursor, Claude Code or Copilot to fix this in your codebase.</p>
              <CopyButton text={finding.fixPrompt} />
            </div>
          )}

          {offer && onOpenPro && (
            <button
              type="button"
              onClick={onOpenPro}
              className="flex w-full items-center gap-2 rounded-md border border-line bg-ink px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-fg"
            >
              <LifeBuoy className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span>{offer}</span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}
