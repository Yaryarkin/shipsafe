"use client";

import { useEffect, type ReactNode } from "react";
import { useDeviceType } from "@/hooks/useDeviceType";
import { MobileNav } from "./MobileNav";
import { PrintReport } from "./PrintReport";
import { useScan } from "./ScanProvider";
import { TopBar } from "./TopBar";

/**
 * Mirrors the device category onto <html> (data-device / data-touch / data-orientation) so CSS or
 * tests can key off it. Layout itself never depends on this: it runs on media queries alone.
 */
function DeviceAttributes() {
  const { device, isTouch, orientation } = useDeviceType();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.device = device;
    root.dataset.touch = String(isTouch);
    root.dataset.orientation = orientation;
  }, [device, isTouch, orientation]);
  return null;
}

/** The persistent frame around every view: top bar, footer, mobile tab bar and the print document. */
export function AppShell({ children }: { children: ReactNode }) {
  const { result } = useScan();

  return (
    <div>
      <div className="print-hide flex min-h-dvh flex-col print:hidden">
        <DeviceAttributes />
        <TopBar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 sm:px-6 md:pb-24 lg:px-8 xl:max-w-7xl">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 xl:max-w-7xl">
            <span>ShipSafe: pre-launch security &amp; config audit for builders.</span>
            <span>Results are informational and not a substitute for a professional penetration test.</span>
          </div>
        </footer>
        <MobileNav />
      </div>

      {result && <PrintReport result={result} />}
    </div>
  );
}
