"use client";

import { ArrowUpRight, History, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { STARTING_PRICE_USD, TELEGRAM_BOT_USERNAME } from "@/lib/payments";
import { browserStorage, loadHistory } from "@/lib/scan-history";
import type { Grade } from "@/lib/scanner/types";
import { GRADE_TONE } from "./grade-tone";
import { LogoMark } from "./Logo";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "";
const BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

type HistoryItem = { site: string; score: number; grade: Grade; scannedAt: string };

function readHistory(): HistoryItem[] {
  const storage = browserStorage();
  if (!storage) return [];
  return Object.entries(loadHistory(storage))
    .map(([site, scan]) => ({ site, score: scan.score, grade: scan.grade, scannedAt: scan.scannedAt }))
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function HistoryMenu({ onPick }: { onPick: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setItems(readHistory());
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors hover:bg-card hover:text-fg ${
          open ? "bg-card text-fg" : "text-muted"
        }`}
      >
        <History className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">History</span>
      </button>
      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 top-10 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-card shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
        >
          <div className="border-b border-line px-3.5 py-2.5 text-xs text-muted">Recent scans · stored in this browser</div>
          {items.length === 0 ? (
            <p className="px-3.5 py-5 text-sm text-muted">No scans yet. Your last 20 sites will appear here.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((item) => (
                <li key={item.site}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onPick(`https://${item.site}`);
                    }}
                    className="flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-raised"
                    title={`Re-scan ${item.site}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-soft">{item.site}</span>
                    <span className="font-mono text-xs tabular-nums text-muted">{item.score}</span>
                    <span
                      className={`inline-flex h-5 w-6 items-center justify-center rounded border font-mono text-[11px] font-semibold ${GRADE_TONE[item.grade].badge}`}
                    >
                      {item.grade}
                    </span>
                    <span className="w-12 text-right text-[11px] text-faint">{shortDate(item.scannedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  onOpenPro,
  onPickHistory,
  hasReport,
}: {
  onOpenPro: () => void;
  onPickHistory: (url: string) => void;
  hasReport: boolean;
}) {
  const links = [
    { href: "#scan", label: "Scan" },
    ...(hasReport ? [{ href: "#report", label: "Report" }] : []),
    { href: "#monitoring", label: "Monitoring" },
    { href: "#docs", label: "Checks" },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="#" className="flex shrink-0 items-center gap-2.5" aria-label="ShipSafe home">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight">ShipSafe</span>
        </a>

        <nav aria-label="Sections" className="hidden items-center gap-0.5 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-card hover:text-fg"
            >
              {link.label}
            </a>
          ))}
          {DOCS_URL.startsWith("http") && (
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-card hover:text-fg"
            >
              Docs
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <HistoryMenu onPick={onPickHistory} />
          <a
            href={BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-card hover:text-fg"
            title={`Order or pay in Telegram — @${TELEGRAM_BOT_USERNAME}`}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Bot</span>
          </a>
          <span className="mx-1.5 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
          <button
            type="button"
            onClick={onOpenPro}
            className="inline-flex h-8 items-center rounded-md bg-fg px-3 text-sm font-medium text-ink transition-colors hover:bg-accent"
          >
            Pro Audit<span className="hidden text-ink/55 sm:inline">&nbsp;· from ${STARTING_PRICE_USD}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
