"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDemoTarget, type DemoKind } from "@/lib/demo-targets";
import { haptic } from "@/lib/haptics";
import { parseLaunchParams, stripLaunchParams } from "@/lib/launch-params";
import { carriedQueryFrom, hrefWithQuery, ORDER_PATH, REPORT_PATH } from "@/lib/nav";
import { browserStorage, recordScanAndDiff, type ScanDiff } from "@/lib/scan-history";
import { recordInsights, type FixVerification } from "@/lib/scan-insights";
import { isBuildTarget } from "@/lib/scan-target";
import { apiErrorSchema, scanResultSchema, type ScanResult } from "@/lib/scanner/types";
import { SCAN_STEPS } from "./ScanProgress";

export type ScanMode = "url" | "build";

/** When each progress step lights up (ms after start). The real scan runs all checks in parallel. */
const STEP_SCHEDULE_MS = [0, 1_200, 3_200, 6_500];
const CLIENT_TIMEOUT_MS = 25_000;

export interface ScanContextValue {
  url: string;
  setUrl: (value: string) => void;
  mode: ScanMode;
  setMode: (mode: ScanMode) => void;
  scanning: boolean;
  activeStep: number;
  scanningFile: string | null;
  error: string | null;
  setError: (message: string | null) => void;
  result: ScanResult | null;
  isDemo: boolean;
  isBuildResult: boolean;
  scanDiff: ScanDiff | null;
  verification: FixVerification | null;
  /** Query string carried between views (share keys, utm_*, Telegram parameters), e.g. "?utm_source=telegram". */
  carriedQuery: string;
  /** A view path with the carried query appended. */
  href: (path: string) => string;
  runScan: (target?: string) => Promise<void>;
  loadDemo: (kind?: DemoKind) => void;
  scanBuild: (file: File) => Promise<void>;
  rescan: () => void;
  pickHistory: (target: string) => void;
  openOrder: () => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function useScan(): ScanContextValue {
  const value = useContext(ScanContext);
  if (!value) throw new Error("useScan must be used inside <ScanProvider>");
  return value;
}

/**
 * Holds the scan state for every view, so a result survives navigation between the scanner, the
 * report, the history and the order page. Also handles launch links (/?url=…&scan=1).
 */
export function ScanProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [scanDiff, setScanDiff] = useState<ScanDiff | null>(null);
  const [verification, setVerification] = useState<FixVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ScanMode>("url");
  const [scanningFile, setScanningFile] = useState<string | null>(null);
  const [carriedQuery, setCarriedQuery] = useState("");

  const stepTimers = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pathnameRef = useRef(pathname);
  const carriedRef = useRef(carriedQuery);
  pathnameRef.current = pathname;
  carriedRef.current = carriedQuery;

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

  // Keep the carried query in step with the address bar (also after the back button).
  useEffect(() => {
    setCarriedQuery(carriedQueryFrom(window.location.search));
  }, [pathname]);

  const href = useCallback((path: string) => hrefWithQuery(path, carriedQuery), [carriedQuery]);

  const showReport = useCallback(() => {
    if (pathnameRef.current !== REPORT_PATH) router.push(hrefWithQuery(REPORT_PATH, carriedRef.current));
  }, [router]);

  // Phone haptics when a scan lands: a firm triple pulse for critical issues, a soft one otherwise.
  useEffect(() => {
    if (result && !isDemo) haptic(result.summary.critical > 0 ? "alert" : "success");
  }, [result, isDemo]);

  /** Scans the URL in the input, or `targetOverride` (used by Re-scan and history). */
  const runScan = useCallback(
    async (targetOverride?: string) => {
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
      setVerification(null);
      setScanning(true);
      setActiveStep(0);
      clearStepTimers();
      stepTimers.current = STEP_SCHEDULE_MS.slice(1).map((delay, index) => window.setTimeout(() => setActiveStep(index + 1), delay));

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
        setIsDemo(false);
        // Compare with the last scan of this site (localStorage) and store this one as the new baseline.
        setScanDiff(recordScanAndDiff(parsed.data, browserStorage()));
        setVerification(recordInsights(parsed.data, browserStorage()));
        setResult(parsed.data);
        showReport();
      } catch (caught) {
        if (controller.signal.aborted) {
          setError("The scan took too long. The site may be slow or blocking automated requests.");
        } else {
          setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
        }
        // A failed re-scan started from another view should bring the user back to the scanner to see the message.
        if (pathnameRef.current !== "/") router.push(hrefWithQuery("/", carriedRef.current));
      } finally {
        window.clearTimeout(timeout);
        clearStepTimers();
        abortRef.current = null;
        setScanning(false);
      }
    },
    [scanning, url, router, showReport],
  );

  const loadDemo = useCallback((kind: DemoKind = "vibe") => {
    if (scanning) return;
    setError(null);
    setIsDemo(true);
    setScanDiff(null);
    setVerification(null);
    setResult(createDemoTarget(kind));
    showReport();
  }, [scanning, showReport]);

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
      setVerification(null);
      setScanningFile(file.name);
      setScanning(true);
      const startedAt = performance.now();
      try {
        const { files, meta } = await extractBuildArchive(file, file.name);
        const report = analyzeBuildArchive(files, file.name, { meta, durationMs: performance.now() - startedAt });
        setIsDemo(false);
        setResult(report);
        showReport();
      } catch (caught) {
        setError(caught instanceof BuildArchiveError ? caught.message : `Couldn't analyze "${file.name}". Make sure it's a valid .apk or .zip archive.`);
      } finally {
        setScanning(false);
        setScanningFile(null);
      }
    },
    [scanning, showReport],
  );

  /**
   * Links such as /?url=https://my-app.com&mode=url&scan=1 (Telegram bot, teammates) prefill the
   * scanner on any view. Only the launch keys are consumed and removed from the address bar; every
   * other parameter (share-card keys, utm_*, Telegram start) is left exactly as it was.
   */
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    const params = new URLSearchParams(window.location.search);
    const launch = parseLaunchParams((key) => params.get(key));
    if (!launch.url && !launch.mode) return;

    if (launch.mode) setMode(launch.mode);
    if (launch.url) setUrl(launch.url);
    setCarriedQuery(stripLaunchParams(window.location.search));
    // Deferred: Next's router re-applies its own URL right after hydration and would undo an immediate change.
    window.setTimeout(() => {
      const rest = stripLaunchParams(window.location.search);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest}${window.location.hash}`);
    }, 120);
    if (launch.autoScan && launch.url) void runScan(launch.url);
  }, [runScan]);

  const isBuildResult = Boolean(result && isBuildTarget(result.target));

  const rescan = useCallback(() => {
    if (result && !isDemo && !isBuildTarget(result.target)) void runScan(result.target);
  }, [result, isDemo, runScan]);

  /** History: switch to website mode and re-scan the picked site. */
  const pickHistory = useCallback(
    (target: string) => {
      setMode("url");
      void runScan(target);
    },
    [runScan],
  );

  const openOrder = useCallback(() => router.push(hrefWithQuery(ORDER_PATH, carriedRef.current)), [router]);

  const value = useMemo<ScanContextValue>(
    () => ({
      url,
      setUrl,
      mode,
      setMode,
      scanning,
      activeStep,
      scanningFile,
      error,
      setError,
      result,
      isDemo,
      isBuildResult,
      scanDiff,
      verification,
      carriedQuery,
      href,
      runScan,
      loadDemo,
      scanBuild,
      rescan,
      pickHistory,
      openOrder,
    }),
    [url, mode, scanning, activeStep, scanningFile, error, result, isDemo, isBuildResult, scanDiff, verification, carriedQuery, href, runScan, loadDemo, scanBuild, rescan, pickHistory, openOrder],
  );

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
