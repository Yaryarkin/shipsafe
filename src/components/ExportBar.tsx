"use client";

import { ArrowRight, Download, Send } from "lucide-react";
import { buildBadgeMarkdown } from "@/lib/badge";
import { downloadMarkdown } from "@/lib/markdown";
import { formatStars, PRICING_TIERS, TELEGRAM_BOT_USERNAME, TIER_IDS } from "@/lib/payments";
import { isBuildTarget } from "@/lib/scan-target";
import type { ScanResult } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";

const SECONDARY_BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3 text-xs text-soft transition-colors hover:border-line-strong hover:text-fg";

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-card p-5">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      <div className="mt-4 flex flex-1 flex-col justify-end gap-3">{children}</div>
    </div>
  );
}

export function ExportBar({ result, isDemo = false, onOpenPro }: { result: ScanResult; isDemo?: boolean; onOpenPro: () => void }) {
  const isBuild = isBuildTarget(result.target);
  // Same-origin preview (CSP allows only 'self' images); the copied markdown uses the public URL.
  const badgePreview = `/api/badge?grade=${result.grade}&score=${result.overallScore}`;

  return (
    <section aria-label="Export, badge and human review" className="grid gap-3 pt-2 lg:grid-cols-3">
      <Panel title="Export report" description="The full report as Markdown — for a pull request, an issue or your launch checklist.">
        <button type="button" onClick={() => downloadMarkdown(result)} className={`${SECONDARY_BUTTON} self-start`}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download .md
        </button>
      </Panel>

      <Panel title="README badge" description="Show your current grade on GitHub or itch.io. The badge links back to the scanner.">
        {isDemo ? (
          <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-xs text-faint">Run a real scan to get your badge.</p>
        ) : (
          <>
            <div className="flex h-11 items-center rounded-md border border-line bg-raised px-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny same-origin SVG */}
              <img src={badgePreview} alt={`ShipSafe badge: grade ${result.grade}, ${result.overallScore}/100`} height={20} className="h-5 w-auto" />
            </div>
            <span className="self-start">
              <CopyButton text={buildBadgeMarkdown(result.overallScore, result.grade)} label="Copy README badge" />
            </span>
          </>
        )}
      </Panel>

      <Panel
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
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-fg px-3 text-xs font-medium text-ink transition-colors hover:bg-accent"
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
