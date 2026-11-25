"use client";

import { ArrowUpRight, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, ORDER_PATH, viewForPath } from "@/lib/nav";
import { STARTING_PRICE_USD, TELEGRAM_BOT_USERNAME } from "@/lib/payments";
import { LogoMark } from "./Logo";
import { useScan } from "./ScanProvider";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "";
const BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

export function TopBar() {
  const pathname = usePathname();
  const { href, result } = useScan();
  const current = viewForPath(pathname);

  return (
    <header className="topbar sticky top-0 z-30">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:px-6 md:h-14 md:gap-4 lg:gap-6 xl:max-w-7xl lg:px-8">
        <Link href={href("/")} className="flex shrink-0 items-center gap-2.5" aria-label="ShipSafe home">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight">ShipSafe</span>
        </Link>

        <nav aria-label="Views" className="chip hidden items-center gap-0.5 rounded-md p-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = item.id === current;
            return (
              <Link
                key={item.id}
                href={href(item.href)}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-md px-3 py-1 text-sm transition-colors ${active ? "chip-active" : "text-muted hover:bg-raised hover:text-fg"}`}
              >
                <span className="lg:hidden">{item.short}</span>
                <span className="hidden lg:inline">{item.label}</span>
                {item.id === "report" && result && !active && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" aria-label="A report is ready" />
                )}
              </Link>
            );
          })}
          {DOCS_URL.startsWith("http") && (
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              Docs
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="chip inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-muted hover:text-fg"
            title={`Order or pay in Telegram: @${TELEGRAM_BOT_USERNAME}`}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Bot</span>
          </a>
          <Link href={href(ORDER_PATH)} className="btn-primary inline-flex h-8 items-center rounded-md px-3.5 text-sm font-medium">
            Pro Audit<span className="hidden text-ink/55 lg:inline">&nbsp;· from ${STARTING_PRICE_USD}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
