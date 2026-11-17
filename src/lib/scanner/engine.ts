import { checkBundleSecrets, fetchSameOriginScripts } from "./checks/secrets";
import { checkCorsAndCookies } from "./checks/cors-cookies";
import { checkMixedContentAndSri, checkSourceMaps } from "./checks/frontend";
import { checkExposure } from "./checks/exposure";
import { checkHeaders } from "./checks/headers";
import { checkTransport } from "./checks/transport";
import { ScanError } from "./errors";
import { createScanContext, errorCode, PER_FETCH_TIMEOUT_MS, type SafeResponse } from "./http";
import { scoreFindings, sortFindings } from "./scoring";
import { assertPublicDns, normalizeUrl } from "./ssrf";
import {
  CATEGORY_LABELS,
  scanResultSchema,
  type Category,
  type Finding,
  type ScanResult,
} from "./types";
import { finding } from "./utils";

export const TOTAL_SCAN_BUDGET_MS = 12_000;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

function withProtocol(url: URL, protocol: "http:" | "https:"): URL {
  const next = new URL(url.href);
  next.protocol = protocol;
  if (protocol === "https:" && next.port === "80") next.port = "";
  if (protocol === "http:" && next.port === "443") next.port = "";
  return next;
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new ScanError("TIMEOUT", "Scan time budget exhausted."));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ScanError("TIMEOUT", "Check exceeded the scan time budget.")), remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function incompleteFinding(category: Category, key: string, label: string, error: unknown): Finding {
  const reason = error instanceof ScanError ? error.message : (errorCode(error) ?? (error instanceof Error ? error.message : "unknown error"));
  return finding({
    id: `${key}.incomplete`,
    category,
    severity: "info",
    title: `${label} check did not complete`,
    description: "This group of checks ran out of time or the server stopped responding. Re-run the scan to get a full result.",
    evidence: reason,
  });
}

export async function runScan(rawUrl: string): Promise<ScanResult> {
  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_SCAN_BUDGET_MS;

  const target = normalizeUrl(rawUrl);
  await withDeadline(assertPublicDns(target), startedAt + PER_FETCH_TIMEOUT_MS);

  const ctx = createScanContext(target, deadline);
  const site = target.origin;

  // Step 1: main page over HTTPS + plain-HTTP redirect probe, in parallel.
  const httpsUrl = withProtocol(target, "https:");
  const httpRootUrl = new URL("/", withProtocol(target, "http:"));
  const [httpsResult, httpProbe] = await Promise.allSettled([
    ctx.fetch(httpsUrl, { maxBytes: MAX_PAGE_BYTES, followRedirects: true }),
    ctx.fetch(httpRootUrl, { maxBytes: 16 * 1024, followRedirects: false }),
  ]);

  let main: SafeResponse;
  let httpsError: unknown = null;
  if (httpsResult.status === "fulfilled") {
    main = httpsResult.value;
  } else {
    httpsError = httpsResult.reason;
    if (httpsError instanceof ScanError) throw httpsError;
    try {
      main = await ctx.fetch(withProtocol(target, "http:"), { maxBytes: MAX_PAGE_BYTES, followRedirects: true });
    } catch (error) {
      if (error instanceof ScanError) throw error;
      const code = errorCode(httpsError) ?? errorCode(error);
      throw new ScanError(
        "UNREACHABLE",
        `Could not reach ${target.host}${code ? ` (${code})` : ""}. Make sure the site is online and publicly accessible.`,
      );
    }
  }

  // Step 2: all check groups in parallel, each bounded by the global deadline.
  // Same-origin scripts are fetched once and shared by the secrets and source-map checks.
  const bundlePromise = fetchSameOriginScripts(ctx, main);

  const groups: Array<{ category: Category; key: string; label: string; run: () => Promise<Finding[]> }> = [
    { category: "transport", key: "transport", label: CATEGORY_LABELS.transport, run: async () => checkTransport({ site, main, httpsError, httpProbe }) },
    { category: "headers", key: "headers", label: CATEGORY_LABELS.headers, run: async () => checkHeaders(site, main) },
    { category: "exposure", key: "exposure", label: CATEGORY_LABELS.exposure, run: () => checkExposure(ctx, site, main) },
    { category: "cors-cookies", key: "cors-cookies", label: CATEGORY_LABELS["cors-cookies"], run: () => checkCorsAndCookies(ctx, site, main) },
    { category: "secrets", key: "secrets", label: CATEGORY_LABELS.secrets, run: async () => checkBundleSecrets(site, main, await bundlePromise) },
    { category: "frontend", key: "frontend.html", label: "Mixed content & SRI", run: async () => checkMixedContentAndSri(site, main) },
    { category: "frontend", key: "frontend.source-maps", label: "Source map", run: async () => checkSourceMaps(ctx, site, await bundlePromise) },
  ];

  const settled = await Promise.allSettled(groups.map((group) => withDeadline(group.run(), deadline)));
  const findings: Finding[] = settled.flatMap((result, index) => {
    const group = groups[index];
    if (!group) return [];
    return result.status === "fulfilled" ? result.value : [incompleteFinding(group.category, group.key, group.label, result.reason)];
  });

  const sorted = sortFindings(findings);
  const { score, grade, summary } = scoreFindings(sorted);

  const result: ScanResult = {
    target: target.href,
    finalUrl: main.url,
    scannedAt: new Date().toISOString(),
    overallScore: score,
    grade,
    scanDurationMs: Date.now() - startedAt,
    summary,
    findings: sorted,
  };

  return scanResultSchema.parse(result);
}
