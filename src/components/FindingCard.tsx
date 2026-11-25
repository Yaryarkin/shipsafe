"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { auditOfferFor } from "@/lib/audit-offer";
import { buildDeveloperBrief, plainImpact, type ReportView } from "@/lib/report-summary";
import { CATEGORY_LABELS, type Finding } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";
import { revealStyle } from "./Reveal";
import { FixSnippets } from "./FixSnippets";
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
  view = "developer",
  site = "",
  revealIndex = 3,
  position,
  focusNonce,
}: {
  finding: Finding;
  defaultOpen?: boolean;
  isBuild?: boolean;
  onOpenPro?: () => void;
  /** Owner: plain-language impact. Developer: evidence, snippets and the AI prompt. */
  view?: ReportView;
  site?: string;
  revealIndex?: number;
  /** Place in the fix priority queue (1 = patch first). Passed findings have none. */
  position?: number;
  /** Changes each time this finding is picked in the fix queue: open it and scroll to it. */
  focusNonce?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rowRef = useRef<HTMLLIElement>(null);
  const panelId = useId();
  const offer = auditOfferFor(finding, isBuild);
  useEffect(() => {
    if (focusNonce === undefined) return;
    setOpen(true);
    rowRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusNonce]);

  const owner = view === "owner";
  const path = finding.evidence ? affectedPath(finding.evidence) : "";
  const subtitle = owner ? plainImpact(finding) : path;

  return (
    <li ref={rowRef} id={`finding-${finding.id}`} data-open={open} style={revealStyle(revealIndex)} className="reveal surface scroll-mt-20 overflow-hidden rounded-lg @container">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left sm:items-center"
      >
        {position !== undefined && <span className="w-5 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-faint sm:pt-0">{String(position).padStart(2, "0")}</span>}
        <span className="pt-0.5 sm:pt-0">
          <SeverityBadge severity={finding.severity} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg">{finding.title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 text-muted">{CATEGORY_LABELS[finding.category]}</span>
            {subtitle && (
              <>
                <span className="text-faint" aria-hidden="true">
                  ·
                </span>
                <span className={`truncate ${owner ? "text-faint" : "font-mono text-faint"}`}>{subtitle}</span>
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
          {owner ? (
            <>
              <div className="space-y-1.5">
                <SectionLabel>{finding.severity === "passed" ? "What this means" : "Why it matters"}</SectionLabel>
                <p className="max-w-3xl text-sm leading-relaxed text-soft">{finding.severity === "passed" ? finding.description : plainImpact(finding)}</p>
              </div>
              {finding.severity !== "passed" && (
                <div className="space-y-2">
                  <SectionLabel>What to do</SectionLabel>
                  <p className="max-w-3xl text-sm leading-relaxed text-soft">
                    {finding.severity === "critical" ? "Ask your developer to fix this before launch." : "Ask your developer to fix this soon."} The brief below has everything they need.
                  </p>
                  <CopyButton text={buildDeveloperBrief(finding, site)} label="Copy brief for your developer" />
                </div>
              )}
            </>
          ) : (
            // Wide cards (desktop workspace): risk and evidence on the left, copy-ready fixes on the right.
            <div className="grid gap-5 @3xl:grid-cols-2 @3xl:gap-6">
          <div className="min-w-0 space-y-5">
          <div className="space-y-1.5">
            <SectionLabel>Risk</SectionLabel>
            <p className="max-w-3xl text-sm leading-relaxed text-soft">{finding.description}</p>
          </div>

          {finding.impact && (
            <div className="space-y-1.5">
              <SectionLabel>Impact</SectionLabel>
              <p className="max-w-3xl text-sm leading-relaxed text-soft">{finding.impact}</p>
            </div>
          )}

          {finding.evidence && (
            <div className="space-y-1.5">
              <SectionLabel>Evidence</SectionLabel>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-raised px-3 py-2.5 font-mono text-xs leading-relaxed text-soft">
                {finding.evidence}
              </pre>
            </div>
          )}

          </div>
          <div className="min-w-0 space-y-5">
          {finding.snippets && finding.snippets.length > 0 && (
            <div className="space-y-1.5">
              <SectionLabel>Fix for your stack</SectionLabel>
              <FixSnippets snippets={finding.snippets} />
            </div>
          )}

          {finding.fixPrompt && (
            <div className="space-y-1.5">
              <SectionLabel>{finding.snippets && finding.snippets.length > 0 ? "Or let your AI assistant do it" : "Remediation"}</SectionLabel>
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
