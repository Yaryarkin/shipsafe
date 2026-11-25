"use client";

import { ArrowRight, Download, Printer, Send } from "lucide-react";
import { buildLaunchUrl } from "@/lib/launch-params";
import { downloadMarkdown } from "@/lib/markdown";
import { formatStars, PRICING_TIERS, TELEGRAM_BOT_USERNAME, TIER_IDS } from "@/lib/payments";
import type { ReportView } from "@/lib/report-summary";
import { isBuildTarget } from "@/lib/scan-target";
import { SITE_URL } from "@/lib/share";
import type { ScanResult } from "@/lib/scanner/types";
import Link from "next/link";
import { revealStyle } from "./Reveal";
import { useScan } from "./ScanProvider";
import { CopyButton } from "./CopyButton";

const SECONDARY_BUTTON =
  "chip inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3.5 text-xs text-soft hover:text-fg";

function Panel({ title, description, index, children }: { title: string; description: string; index: number; children: React.ReactNode }) {
  return (
    <div className="reveal surface flex flex-col rounded-lg p-5" style={revealStyle(index)}>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      <div className="mt-4 flex flex-1 flex-col justify-end gap-3">{children}</div>
    </div>
  );
}

export function ExportBar({
  result,
  isDemo = false,
  view = "developer",
  onOpenPro,
}: {
  result: ScanResult;
  isDemo?: boolean;
  view?: ReportView;
  onOpenPro: () => void;
}) {
  const { href } = useScan();
  const isBuild = isBuildTarget(result.target);
  const viewLabel = view === "owner" ? "Owner" : "Developer";
  const rescanLink = !isDemo && !isBuild ? buildLaunchUrl(SITE_URL, { url: result.target, autoScan: true }) : null;

  return (
    <section aria-label="Export and human review" className="grid gap-3 pt-2 lg:grid-cols-2">
      <Panel index={9} title="Export report" description="A clean report to share: summary metrics, severity breakdown, priority list and remediation steps.">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadMarkdown(result, view)} className={SECONDARY_BUTTON} title="Markdown matching the audience selected above">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Markdown · {viewLabel}
          </button>
          <button type="button" onClick={() => window.print()} className={SECONDARY_BUTTON} title="Opens the print dialog: choose Save as PDF">
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Print / PDF
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => downloadMarkdown(result, "full")} className="text-xs text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
            Full report (.md)
          </button>
          {rescanLink && <CopyButton text={rescanLink} label="Copy re-scan link" />}
          {!isDemo && !isBuild && (
            <Link href={href("/history")} className="text-xs text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
              Get a README badge
            </Link>
          )}
        </div>
      </Panel>

      <Panel
        index={9}
        title="Need a human review?"
        description={
          isBuild
            ? "A reviewer checks your build, backend APIs and anti-cheat endpoints, then sends prioritized fixes."
            : "A reviewer checks your repo, API routes and Supabase RLS / Firebase rules, then sends prioritized fixes."
        }
      >
        <dl className="divide-y divide-line rounded-md border border-line bg-raised">
          {TIER_IDS.map((id) => {
            const tier = PRICING_TIERS[id];
            return (
              <div key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="min-w-0 truncate text-xs text-soft">{tier.menuLabel}</dt>
                <dd className="shrink-0 font-mono text-xs tabular-nums text-muted">
                  <span className="text-fg">${tier.priceUsd}</span> · {formatStars(tier.starsAmount)}
                </dd>
              </div>
            );
          })}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenPro}
            className="btn-primary inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3.5 text-xs font-medium"
          >
            Order a review
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <a href={`https://t.me/${TELEGRAM_BOT_USERNAME}`} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Telegram bot
          </a>
        </div>
        <p className="text-[11px] text-faint">USDT / USDC on Solana, USDT on Tron, or Telegram Stars.</p>
      </Panel>
    </section>
  );
}
