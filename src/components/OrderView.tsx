"use client";

import { Send } from "lucide-react";
import { TELEGRAM_BOT_USERNAME } from "@/lib/payments";
import { OrderPanel } from "./OrderPanel";
import { Reveal, revealStyle } from "./Reveal";
import { useScan } from "./ScanProvider";

/** Bot & orders: the human-review order form (Stars, crypto, inquiry) next to the Telegram bot. */
export function OrderView() {
  const { result, isDemo, isBuildResult } = useScan();
  const scannedUrl = result && !isDemo && !isBuildResult ? result.target : undefined;

  return (
    <div className="space-y-8 pt-8 sm:pt-12">
      <Reveal index={0}>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">Bot &amp; orders</p>
        <h1 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">Get a human review</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          Pay with Telegram Stars in our bot or with crypto here. We confirm every payment on-chain before work starts.
        </p>
      </Reveal>

      <div className="grid items-start gap-5 rail:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8">
        <OrderPanel scannedUrl={scannedUrl} />

        <aside className="reveal surface rounded-lg p-5 sm:p-6 rail:sticky rail:top-20" style={revealStyle(2)}>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-raised">
            <Send className="h-4 w-4 text-soft" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-sm font-medium text-fg">Prefer Telegram?</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The bot sends a Stars invoice, remembers your order and answers status questions. Start it with <span className="font-mono text-soft">/start</span>.
          </p>
          <a
            href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold"
          >
            Open @{TELEGRAM_BOT_USERNAME}
          </a>
        </aside>
      </div>
    </div>
  );
}
