"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { readDeviceNow } from "@/hooks/useDeviceType";
import { assessReadiness } from "@/lib/readiness";
import { Radar } from "./Radar";
import { ReadinessBadge } from "./ReadinessGate";
import { HowItWorks } from "./HowItWorks";
import { Reveal } from "./Reveal";
import { useScan } from "./ScanProvider";
import { ScannerForm } from "./ScannerForm";

/** The first view: a calm hero, the scan dock, and what ShipSafe checks. */
export function ScannerView() {
  const scan = useScan();
  const { result, scanning, href } = scan;

  // Desktop with a keyboard: put the cursor in the URL field once. Never on touch, where it would pop the keyboard up.
  // Reads the live device (not the hydration snapshot), so a phone is never mistaken for a desktop.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || scan.mode !== "url" || result) return;
    focused.current = true;
    const now = readDeviceNow();
    if (now.device === "desktop" && !now.isTouch) document.getElementById("scan-url")?.focus({ preventScroll: true });
  }, [scan.mode, result]);

  return (
    <div className="pt-10 sm:pt-16">
      <section aria-labelledby="scan-title" className="pb-14">
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-12">
          <div className="max-w-2xl">
            <Reveal as="p" index={0} className="font-mono text-xs uppercase tracking-[0.14em] text-brand">
              Pre-launch security check
            </Reveal>
            <Reveal as="h1" index={1} id="scan-title" className="mt-4 text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] text-balance sm:text-[2.75rem]">
              Catch leaks before your users do.
            </Reveal>
            <Reveal as="p" index={2} className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
              Audit HTTPS, security headers, exposed <span className="font-mono text-soft">.env</span> / <span className="font-mono text-soft">.git</span> files, CORS, cookies and
              keys in your JavaScript bundles, or inspect an <span className="font-mono text-soft">.apk</span> / <span className="font-mono text-soft">.zip</span> build locally. Every
              finding ships with a copy-paste fix.
            </Reveal>
          </div>
          <div className="order-first mx-auto w-44 space-y-4 sm:w-52 md:order-none md:mx-0 md:w-full">
            <Reveal index={1} className="mx-auto max-w-[17rem]">
              <Radar scanning={scanning} status={result && !scanning ? assessReadiness(result).status : null} />
            </Reveal>
            <Reveal index={1} className="surface hidden rounded-lg p-5 md:block" aria-label="Launch gate">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Pre-launch gate</p>
            {result && !scanning ? (
              <div className="mt-3 space-y-3">
                <ReadinessBadge status={assessReadiness(result).status} label={assessReadiness(result).label} />
                <p className="text-sm leading-relaxed text-soft">{assessReadiness(result).headline}</p>
                <Link href={href("/report")} className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-fg">
                  Open the report
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <>
                <p className="mt-3 text-sm leading-relaxed text-muted">{scanning ? "Scanning. The verdict appears when the checks finish." : "Every scan ends with one verdict:"}</p>
                <ul className="mt-3 space-y-2.5">
                  <li className="flex flex-col gap-1">
                    <ReadinessBadge status="ready" label="Ready to ship" />
                    <span className="text-xs text-muted">No critical issues or warnings.</span>
                  </li>
                  <li className="flex flex-col gap-1">
                    <ReadinessBadge status="attention" label="Needs attention" />
                    <span className="text-xs text-muted">Warnings to fix, nothing exploitable today.</span>
                  </li>
                  <li className="flex flex-col gap-1">
                    <ReadinessBadge status="blocked" label="Blocked by critical" />
                    <span className="text-xs text-muted">Fix these before you launch.</span>
                  </li>
                </ul>
              </>
            )}
            </Reveal>
          </div>
        </div>

        <div className="mt-9 max-w-3xl">
          <ScannerForm
            mode={scan.mode}
            onModeChange={(next) => {
              scan.setMode(next);
              scan.setError(null);
            }}
            url={scan.url}
            onUrlChange={scan.setUrl}
            onScan={scan.runScan}
            onFileScan={(file) => void scan.scanBuild(file)}
            onDemo={scan.loadDemo}
            scanning={scanning}
            activeStep={scan.activeStep}
            scanningFile={scan.scanningFile}
            error={scan.error}
          />

        </div>
      </section>

      <HowItWorks />
    </div>
  );
}
