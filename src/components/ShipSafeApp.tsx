"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createDemoReport } from "@/lib/demo-report";
import { browserStorage, recordScanAndDiff, type ScanDiff } from "@/lib/scan-history";
import { isBuildTarget } from "@/lib/scan-target";
import { apiErrorSchema, scanResultSchema, type ScanResult } from "@/lib/scanner/types";
import { HowItWorks } from "./HowItWorks";
import { MonitoringWaitlist } from "./MonitoringWaitlist";
import { ProAuditModal } from "./ProAuditModal";
import { ResultsDashboard } from "./ResultsDashboard";
import { SCAN_STEPS } from "./ScanProgress";
import { ScannerForm, type ScanMode } from "./ScannerForm";
import { TopBar } from "./TopBar";

/** When each progress step lights up (ms after start). The real scan runs all checks in parallel. */
const STEP_SCHEDULE_MS = [0, 1_200, 3_200, 6_500];
const CLIENT_TIMEOUT_MS = 25_000;

export function ShipSafeApp() {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [scanDiff, setScanDiff] = useState<ScanDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proOpen, setProOpen] = useState(false);
  const [mode, setMode] = useState<ScanMode>("url");
  const [scanningFile, setScanningFile] = useState<string | null>(null);

  const stepTimers = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const shouldScroll = useRef(false);

  const clearStepTimers = () => {
    stepTimers.current.forEach((timer) => window.clearTimeout(timer));
    stepTimers.current = [];
  };

  useEffect(
    () => () => {
      clearStepTimers();
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (result && shouldScroll.current) {
      shouldScroll.current = false;
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  /** Scans the URL in the input, or `targetOverride` (used by the Re-scan button). */
  const runScan = useCallback(async (targetOverride?: string) => {
    if (scanning) return;
    const value = (targetOverride ?? url).trim();
    if (!value) {
      setError("Enter the URL of a site you own, e.g. https://your-app.com");
      return;
    }
    if (targetOverride) setUrl(targetOverride);

    setError(null);
    setResult(null);
    setScanDiff(null);
    setScanning(true);
    setActiveStep(0);
    clearStepTimers();
    stepTimers.current = STEP_SCHEDULE_MS.slice(1).map((delay, index) =>
      window.setTimeout(() => setActiveStep(index + 1), delay),
    );

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value }),
        signal: controller.signal,
      });
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(data);
        throw new Error(parsedError.success ? parsedError.data.error.message : `Scan failed (HTTP ${response.status}).`);
      }

      const parsed = scanResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("The scanner returned an unexpected response. Please try again.");

      setActiveStep(SCAN_STEPS.length);
      shouldScroll.current = true;
      setIsDemo(false);
      // Compare with the last scan of this site (localStorage) and store this one as the new baseline.
      setScanDiff(recordScanAndDiff(parsed.data, browserStorage()));
      setResult(parsed.data);
    } catch (caught) {
      if (controller.signal.aborted) {
        setError("The scan took too long. The site may be slow or blocking automated requests.");
      } else {
        setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      clearStepTimers();
      abortRef.current = null;
      setScanning(false);
    }
  }, [scanning, url]);

  const loadDemo = useCallback(() => {
    if (scanning) return;
    setError(null);
    shouldScroll.current = true;
    setIsDemo(true);
    setScanDiff(null);
    setResult(createDemoReport());
  }, [scanning]);

  /** Client-side build scan: the archive is unpacked and analyzed in this tab, never uploaded. */
  const scanBuild = useCallback(
    async (file: File) => {
      if (scanning) return;
      // Lazy-load JSZip + the analyzer only when someone actually scans a build.
      const [{ extractBuildArchive }, { analyzeBuildArchive, assertArchiveSize, BuildArchiveError, isSupportedBuildFile }] = await Promise.all([
        import("@/lib/build-extract"),
        import("@/lib/scanner/build-analyzer"),
      ]);
      if (!isSupportedBuildFile(file.name)) {
        setError("Choose an Android .apk or a .zip of your game / app build.");
        return;
      }
      try {
        assertArchiveSize(file.size);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "This archive is too large to scan in the browser.");
        return;
      }

      setError(null);
      setResult(null);
      setScanDiff(null);
      setScanningFile(file.name);
      setScanning(true);
      const startedAt = performance.now();
      try {
        const { files, meta } = await extractBuildArchive(file, file.name);
        const report = analyzeBuildArchive(files, file.name, { meta, durationMs: performance.now() - startedAt });
        shouldScroll.current = true;
        setIsDemo(false);
        setResult(report);
      } catch (caught) {
        setError(caught instanceof BuildArchiveError ? caught.message : `Couldn't analyze "${file.name}". Make sure it's a valid .apk or .zip archive.`);
      } finally {
        setScanning(false);
        setScanningFile(null);
      }
    },
    [scanning],
  );

  const isBuildResult = Boolean(result && isBuildTarget(result.target));

  const rescan = useCallback(() => {
    if (result && !isDemo && !isBuildTarget(result.target)) void runScan(result.target);
  }, [result, isDemo, runScan]);

  /** History menu: switch to URL mode and re-scan the picked site. */
  const pickHistory = useCallback(
    (target: string) => {
      setMode("url");
      void runScan(target);
    },
    [runScan],
  );

  const openPro = useCallback(() => setProOpen(true), []);
  const closePro = useCallback(() => setProOpen(false), []);

  return (
    <>
      <TopBar onOpenPro={openPro} onPickHistory={pickHistory} hasReport={Boolean(result)} />

      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <section id="scan" className="scroll-mt-20 pb-12 pt-14 sm:pt-20">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">Pre-launch security check</p>
            <h1 className="mt-4 text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] text-balance sm:text-[2.75rem]">
              Catch leaks before your users do.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
              Audit HTTPS, security headers, exposed <span className="font-mono text-soft">.env</span> /{" "}
              <span className="font-mono text-soft">.git</span> files, CORS, cookies and keys in your JavaScript bundles — or inspect an{" "}
              <span className="font-mono text-soft">.apk</span> / <span className="font-mono text-soft">.zip</span> build locally.
              Every finding ships with a copy-paste fix.
            </p>
          </div>

          <div className="mt-9 max-w-3xl">
            <ScannerForm
              mode={mode}
              onModeChange={(next) => {
                setMode(next);
                setError(null);
              }}
              url={url}
              onUrlChange={setUrl}
              onScan={runScan}
              onFileScan={(file) => void scanBuild(file)}
              onDemo={loadDemo}
              scanning={scanning}
              activeStep={activeStep}
              scanningFile={scanningFile}
              error={error}
            />
          </div>
        </section>

        <div ref={resultsRef} id="report" className="scroll-mt-20">
          {result && (
            <ResultsDashboard
              key={`${result.scannedAt}-${isDemo}`}
              result={result}
              isDemo={isDemo}
              scanDiff={isBuildResult ? null : scanDiff}
              onRescan={isDemo || isBuildResult ? undefined : rescan}
              rescanning={scanning}
              onOpenPro={openPro}
            />
          )}
        </div>

        <div className="mt-16">
          <MonitoringWaitlist defaultSite={result && !isDemo && !isBuildResult ? result.target : undefined} />
        </div>

        <div className="mt-20">
          <HowItWorks />
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>ShipSafe — pre-launch security &amp; config audit for builders.</span>
          <span>Results are informational and not a substitute for a professional penetration test.</span>
        </div>
      </footer>

      {/* Builds have no URL to prefill (the order form expects an http(s) site). */}
      <ProAuditModal open={proOpen} onClose={closePro} scannedUrl={result && !isDemo && !isBuildResult ? result.target : undefined} />
    </>
  );
}
