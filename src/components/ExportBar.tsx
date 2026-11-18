"use client";

import { ArrowRight, Download, Lock } from "lucide-react";
import { buildBadgeMarkdown } from "@/lib/badge";
import { downloadMarkdown } from "@/lib/markdown";
import { PRICE_LIST_USD, PRICING_TIERS } from "@/lib/payments";
import { isBuildTarget } from "@/lib/scan-target";
import type { ScanResult } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";

export function ExportBar({ result, isDemo = false, onOpenPro }: { result: ScanResult; isDemo?: boolean; onOpenPro: () => void }) {
  const isBuild = isBuildTarget(result.target);
  return (
    <section aria-label="Export and upgrade" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{isBuild ? "This scan sees what's inside the build." : "This scan sees what the public sees."}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          {isBuild
            ? `Get a $${PRICING_TIERS.quick.priceUsd} expert review of these findings, $${PRICING_TIERS.fix.priceUsd} ready-to-apply fixes, or a $${PRICING_TIERS.full.priceUsd} full audit of your code, backend APIs and anti-cheat endpoints.`
            : `Get a $${PRICING_TIERS.quick.priceUsd} expert config review, $${PRICING_TIERS.fix.priceUsd} ready-to-apply fixes, or a $${PRICING_TIERS.full.priceUsd} full audit of your repo, API routes and Supabase RLS / Firebase rules.`}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:shrink-0 lg:flex-nowrap">
        {!isDemo && (
          <span className="inline-flex [&>button]:h-9 [&>button]:w-full [&>button]:justify-center [&>button]:px-3.5 [&>button]:text-sm">
            <CopyButton text={buildBadgeMarkdown(result.overallScore, result.grade)} label="Copy README Badge" />
          </span>
        )}
        <button
          type="button"
          onClick={() => downloadMarkdown(result)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-ink px-3.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-fg"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export Markdown (.md)
        </button>
        <button
          type="button"
          onClick={onOpenPro}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-500 px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-emerald-400"
        >
          <Lock className="h-4 w-4" aria-hidden="true" />
          Get Pro Audit ({PRICE_LIST_USD})
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
