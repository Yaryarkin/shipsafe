"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { auditOfferFor } from "@/lib/audit-offer";
import { CATEGORY_LABELS, type Finding } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";
import { SeverityBadge } from "./SeverityBadge";

/** First line of the evidence, shown as the affected target/path in the collapsed row. */
function affectedPath(evidence: string): string {
  const line = evidence.split("\n")[0]?.trim() ?? "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{children}</h4>;
}

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
  const path = finding.evidence ? affectedPath(finding.evidence) : "";

  return (
    <li className={`overflow-hidden rounded-lg border bg-card transition-colors ${open ? "border-line-strong" : "border-line hover:border-line-strong"}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left sm:items-center"
      >
        <span className="pt-0.5 sm:pt-0">
          <SeverityBadge severity={finding.severity} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg">{finding.title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 text-muted">{CATEGORY_LABELS[finding.category]}</span>
            {path && (
              <>
                <span className="text-faint" aria-hidden="true">
                  ·
                </span>
                <span className="truncate font-mono text-faint">{path}</span>
              </>
            )}
          </span>
        </span>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform duration-200 sm:mt-0 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={panelId} className="animate-fade-in space-y-5 border-t border-line px-4 pb-4 pt-4">
          <div className="space-y-1.5">
            <SectionLabel>Risk</SectionLabel>
            <p className="max-w-3xl text-sm leading-relaxed text-soft">{finding.description}</p>
          </div>

          {finding.evidence && (
            <div className="space-y-1.5">
              <SectionLabel>Evidence</SectionLabel>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-raised px-3 py-2.5 font-mono text-xs leading-relaxed text-soft">
                {finding.evidence}
              </pre>
            </div>
          )}

          {finding.fixPrompt && (
            <div className="space-y-1.5">
              <SectionLabel>Remediation</SectionLabel>
              <div className="overflow-hidden rounded-md border border-line bg-raised">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <p className="text-xs text-muted">AI fix prompt · paste into Cursor, Claude Code or Copilot</p>
                  <CopyButton text={finding.fixPrompt} />
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-xs leading-relaxed text-muted">
                  {finding.fixPrompt}
                </pre>
              </div>
            </div>
          )}

          {offer && onOpenPro && (
            <button
              type="button"
              onClick={onOpenPro}
              className="group inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
            >
              <span>{offer.replace(/\s*→\s*$/, "")}</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}
