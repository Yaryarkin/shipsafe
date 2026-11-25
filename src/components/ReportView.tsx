"use client";

import { ArrowRight, FileSearch } from "lucide-react";
import Link from "next/link";
import { displayTarget } from "@/lib/scan-target";
import { Reveal, revealStyle } from "./Reveal";
import { ResultsDashboard } from "./ResultsDashboard";
import { ScanProgress } from "./ScanProgress";
import { useScan } from "./ScanProvider";

/** Report & fixes: the score, the verification panel, the findings with owner / developer views, and export. */
export function ReportView() {
  const { result, scanning, activeStep, scanningFile, isDemo, isBuildResult, scanDiff, verification, rescan, openOrder, loadDemo, href } = useScan();

  return (
    <div className="space-y-6 pt-8 sm:pt-12">
      <Reveal index={0}>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">Report &amp; fixes</p>
        <h1 className="mt-3 truncate text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
          {result ? displayTarget(result.target) : scanning ? "Scanning…" : "No report yet"}
        </h1>
      </Reveal>

      {scanning && !result ? (
        scanningFile ? (
          <p className="reveal surface rounded-lg px-4 py-3.5 text-sm text-soft" role="status" style={revealStyle(1)}>
            Unpacking and analyzing <span className="font-mono">{scanningFile}</span> locally…
          </p>
        ) : (
          <ScanProgress activeStep={activeStep} />
        )
      ) : result ? (
        <ResultsDashboard
          key={`${result.scannedAt}-${isDemo}`}
          result={result}
          isDemo={isDemo}
          scanDiff={isBuildResult ? null : scanDiff}
          verification={isBuildResult ? null : verification}
          onRescan={isDemo || isBuildResult ? undefined : rescan}
          rescanning={scanning}
          onOpenPro={openOrder}
        />
      ) : (
        <section className="reveal surface rounded-lg px-6 py-12 text-center" style={revealStyle(1)}>
          <FileSearch className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-medium text-fg">Nothing to show yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
            Scan a website or an .apk / .zip build and the report, with a fix for every finding, appears here.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Link href={href("/")} className="btn-primary inline-flex h-10 items-center gap-2 rounded-md px-5 text-sm font-semibold">
              Scan a site
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button type="button" onClick={() => loadDemo("vibe")} className="chip inline-flex h-10 items-center rounded-md px-5 text-sm text-soft hover:text-fg">
              View demo report
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
