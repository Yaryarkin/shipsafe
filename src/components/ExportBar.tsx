"use client";

import { ArrowRight, Download, Lock } from "lucide-react";
import { downloadMarkdown } from "@/lib/markdown";
import { PRICING_TIERS } from "@/lib/payments";
import type { ScanResult } from "@/lib/scanner/types";

export function ExportBar({ result, onOpenPro }: { result: ScanResult; onOpenPro: () => void }) {
  return (
    <section
      aria-label="Export and upgrade"
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">This scan sees what the public sees.</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Get a ${PRICING_TIERS.quick.priceUsd} expert config review of these findings, or a ${PRICING_TIERS.full.priceUsd} full audit of
          your repo, API routes and Supabase RLS / Firebase rules.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
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
          Get Pro Audit (${PRICING_TIERS.quick.priceUsd} / ${PRICING_TIERS.full.priceUsd})
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
