import { BookOpen } from "lucide-react";
import { STARTING_PRICE_USD } from "@/lib/payments";
import { LogoMark } from "./Logo";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "#docs";

export function TopBar({ onOpenPro }: { onOpenPro: () => void }) {
  const external = DOCS_URL.startsWith("http");
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" className="flex min-w-0 items-center gap-2.5" aria-label="ShipSafe home">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight">ShipSafe</span>
          <span className="hidden truncate border-l border-line pl-2.5 text-sm text-zinc-400 sm:inline">
            Pre-launch security &amp; config audit
          </span>
        </a>
        <nav className="flex items-center gap-1.5">
          <a
            href={DOCS_URL}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-zinc-400 transition-colors hover:bg-card hover:text-fg"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>GitHub / Docs</span>
          </a>
          <button
            type="button"
            onClick={onOpenPro}
            className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-sm font-medium text-fg transition-colors hover:border-zinc-600"
          >
            Pro Audit<span className="hidden text-zinc-400 sm:inline">&nbsp;(from ${STARTING_PRICE_USD})</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
