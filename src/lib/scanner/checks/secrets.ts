import * as cheerio from "cheerio";
import type { SafeResponse, ScanContext } from "../http";
import type { Finding } from "../types";
import { analyzeSecrets, MAX_SCRIPTS, type SecretSource } from "./secret-patterns";

// Pure detection lives in ./secret-patterns (browser-safe); re-exported here so existing imports keep working.
export { analyzeSecrets, MAX_SCRIPTS, type SecretSource } from "./secret-patterns";

const MAX_SCRIPT_BYTES = 1024 * 1024;

export interface FetchedScript extends SecretSource {
  url: string;
}

/** Same-origin scripts fetched once per scan and shared by the secrets and source-map checks. */
export interface ScriptBundle {
  scriptUrls: string[];
  scripts: FetchedScript[];
  failed: number;
}

export function collectScriptUrls(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(pageUrl).origin;
  const urls: string[] = [];
  $("script[src]").each((_, element) => {
    const src = $(element).attr("src");
    if (!src) return;
    try {
      const resolved = new URL(src, pageUrl);
      resolved.hash = "";
      if (resolved.origin === origin && !urls.includes(resolved.href)) urls.push(resolved.href);
    } catch {
      // ignore malformed src attributes
    }
  });
  return urls.slice(0, MAX_SCRIPTS);
}

export function shortLabel(url: string): string {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  return path.length > 80 ? `…${path.slice(-79)}` : path;
}

/** Fetches up to MAX_SCRIPTS same-origin scripts (1 MB each). Never rejects. */
export async function fetchSameOriginScripts(ctx: ScanContext, main: SafeResponse): Promise<ScriptBundle> {
  let scriptUrls: string[] = [];
  try {
    scriptUrls = collectScriptUrls(main.body.toString("utf8"), main.url);
  } catch {
    return { scriptUrls: [], scripts: [], failed: 0 };
  }

  const results = await Promise.allSettled(
    scriptUrls.map((url) => ctx.fetch(url, { maxBytes: MAX_SCRIPT_BYTES, followRedirects: true })),
  );

  const scripts: FetchedScript[] = [];
  let failed = 0;
  results.forEach((result, index) => {
    const url = scriptUrls[index];
    if (!url) return;
    if (result.status === "fulfilled" && result.value.status >= 200 && result.value.status < 300) {
      scripts.push({ url, label: shortLabel(url), text: result.value.body.toString("utf8") });
    } else {
      failed += 1;
    }
  });
  return { scriptUrls, scripts, failed };
}

export function checkBundleSecrets(site: string, main: SafeResponse, bundle: ScriptBundle): Finding[] {
  const sources: SecretSource[] = [
    { label: `${shortLabel(main.url) || "/"} (HTML)`, text: main.body.toString("utf8") },
    ...bundle.scripts,
  ];
  return analyzeSecrets(site, sources, {
    failedScripts: bundle.failed,
    scriptLimitReached: bundle.scriptUrls.length === MAX_SCRIPTS,
  });
}
