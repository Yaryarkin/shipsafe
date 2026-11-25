"use client";

import { FileText, History, ScanLine, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { haptic } from "@/lib/haptics";
import { NAV_ITEMS, viewForPath, type ViewId } from "@/lib/nav";
import { useScan } from "./ScanProvider";

const ICONS: Record<ViewId, typeof ScanLine> = {
  scan: ScanLine,
  report: FileText,
  history: History,
  order: Send,
};

/**
 * Phone-only bottom tab bar (thumb reach) for the four views. Respects the home-indicator safe
 * area. Hidden from md and up, where the top bar carries the same links.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { href, result } = useScan();
  const current = viewForPath(pathname);

  return (
    <nav aria-label="Views" className="mobile-nav surface fixed inset-x-3 z-40 rounded-lg md:hidden">
      <ul className="grid grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.id];
          const active = item.id === current;
          return (
            <li key={item.id}>
              <Link
                href={href(item.href)}
                aria-current={active ? "page" : undefined}
                onClick={() => haptic("tap")}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors ${active ? "text-fg" : "text-muted"}`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-fg" : ""}`} aria-hidden="true" />
                {item.short}
                {item.id === "report" && result && !active && (
                  <span className="absolute right-[28%] top-2 h-1.5 w-1.5 rounded-full bg-brand" aria-label="A report is ready" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
