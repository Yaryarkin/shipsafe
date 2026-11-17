import * as cheerio from "cheerio";
import { errorCode, isHtmlResponse, type SafeResponse, type ScanContext } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding, formatBytes } from "../utils";
import { shortLabel, type ScriptBundle } from "./secrets";

const MAX_SOURCE_MAP_PROBES = 3;
/** Enough to recognize a source map's JSON header; the source code itself is never downloaded. */
const SOURCE_MAP_PROBE_BYTES = 4 * 1024;
const MAX_LISTED = 6;

/** <link rel> values whose href is actually loaded as a subresource (canonical/alternate are just metadata). */
const SUBRESOURCE_LINK_RELS = /\b(stylesheet|icon|apple-touch-icon|preload|modulepreload|prefetch|manifest|mask-icon)\b/i;

function resolve(value: string | undefined, base: string): URL | null {
  if (!value) return null;
  try {
    return new URL(value.trim(), base);
  } catch {
    return null;
  }
}

function listWithMore(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join("\n");
  return items.length > MAX_LISTED ? `${shown}\n+${items.length - MAX_LISTED} more` : shown;
}

/** Mixed content (http:// subresources on an https:// page) and missing Subresource Integrity. Pure. */
export function checkMixedContentAndSri(site: string, main: SafeResponse): Finding[] {
  if (!isHtmlResponse(main)) return [];
  const $ = cheerio.load(main.body.toString("utf8"));
  const pageUrl = main.url;
  const pageOrigin = new URL(pageUrl).origin;
  const isHttpsPage = pageUrl.startsWith("https:");
  const findings: Finding[] = [];

  if (isHttpsPage) {
    const insecure: string[] = [];
    const collect = (tag: string, raw: string | undefined) => {
      const url = resolve(raw, pageUrl);
      if (url?.protocol === "http:") {
        const entry = `<${tag}> ${url.href}`;
        if (!insecure.includes(entry)) insecure.push(entry);
      }
    };
    $("script[src]").each((_, element) => collect("script", $(element).attr("src")));
    $("img[src]").each((_, element) => collect("img", $(element).attr("src")));
    $("link[href]").each((_, element) => {
      const rel = $(element).attr("rel") ?? "";
      if (SUBRESOURCE_LINK_RELS.test(rel)) collect("link", $(element).attr("href"));
    });

    findings.push(
      insecure.length > 0
        ? finding({
            id: "frontend.mixed-content",
            category: "frontend",
            severity: "warning",
            title: "Mixed content: HTTP resources on an HTTPS page",
            description:
              "Your secure page loads resources over plain http://. Browsers block insecure scripts and stylesheets outright (breaking your page) and show a 'Not secure' warning for images. An attacker on the network can also swap those files for malicious ones.",
            evidence: listWithMore(insecure),
            fixPrompt: buildFixPrompt({
              site,
              issue: `My HTTPS page loads ${insecure.length} resource(s) over insecure http:// (e.g. ${insecure[0] ?? ""}).`,
              goal: "Every script, stylesheet, image and icon is loaded over https:// (or from my own origin).",
              steps: [
                "Search the codebase, CMS content and environment variables for hard-coded `http://` asset URLs and change them to `https://` (or protocol-relative to same-origin paths).",
                "If a third-party host doesn't support HTTPS, self-host the file instead.",
                "Add `upgrade-insecure-requests` to the Content-Security-Policy as a safety net.",
              ],
              verify: "Open the page with DevTools → Console and confirm there are no 'Mixed Content' warnings, then re-run ShipSafe.",
            }),
          })
        : finding({
            id: "frontend.mixed-content",
            category: "frontend",
            severity: "passed",
            title: "No mixed content",
            description: "All scripts, stylesheets and images referenced in the page HTML load over HTTPS.",
            evidence: "No http:// <script>, <link> or <img> URLs found in the HTML.",
          }),
    );
  }

  const unprotected: string[] = [];
  let thirdPartyCount = 0;
  $("script[src]").each((_, element) => {
    const url = resolve($(element).attr("src"), pageUrl);
    if (!url || url.origin === pageOrigin || url.protocol !== "https:") return;
    thirdPartyCount += 1;
    if (!$(element).attr("integrity")) {
      const entry = `${url.host}${url.pathname}`;
      if (!unprotected.includes(entry)) unprotected.push(entry);
    }
  });

  if (unprotected.length > 0) {
    findings.push(
      finding({
        id: "frontend.sri",
        category: "frontend",
        severity: "info",
        title: "Third-party scripts without Subresource Integrity",
        description:
          "These scripts run with full access to your page but are loaded from other servers without an `integrity` hash. If that CDN or vendor is compromised, the attacker's code runs on your site. Pin versioned files with SRI, self-host them, or (for scripts that change constantly, like Stripe.js or tag managers) restrict them with a strict CSP.",
        evidence: listWithMore(unprotected),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My page loads third-party scripts without Subresource Integrity: ${unprotected.slice(0, 4).join(", ")}.`,
          goal: "Every static, versioned third-party script has an `integrity` + `crossorigin=\"anonymous\"` attribute, or is self-hosted.",
          steps: [
            "For each script, decide: (a) pin an exact version and add an SRI hash (generate with `curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A`), (b) install it from npm and bundle/self-host it, or (c) for evergreen vendor scripts that don't support SRI (Stripe.js, Google Tag Manager), keep them but allow-list their exact origin in the CSP `script-src`.",
            "In Next.js, use `next/script` with the `integrity` and `crossOrigin` props, or import the package instead of loading it from a CDN.",
          ],
          verify: "View the page source and confirm each remaining cross-origin <script> has an integrity attribute; the page should load with no SRI errors in the console.",
        }),
      }),
    );
  } else {
    findings.push(
      finding({
        id: "frontend.sri",
        category: "frontend",
        severity: "passed",
        title: thirdPartyCount > 0 ? "Third-party scripts use Subresource Integrity" : "No third-party scripts in the HTML",
        description:
          thirdPartyCount > 0
            ? "Every cross-origin script tag carries an integrity hash, so a tampered CDN file would be refused by the browser."
            : "All script tags in the HTML are served from your own origin, so there is no third-party script supply chain to pin.",
        evidence: `${thirdPartyCount} cross-origin <script src> tag(s) found`,
      }),
    );
  }

  return findings;
}

interface MapCandidate {
  scriptLabel: string;
  mapUrl: string | null;
  inlineBytes: number | null;
}

/** Last `//# sourceMappingURL=` reference in a script, or a `<script>.map` guess when there is none. */
export function sourceMapCandidate(scriptUrl: string, scriptText: string): MapCandidate {
  const scriptLabel = shortLabel(scriptUrl);
  let reference: string | undefined;
  for (const match of scriptText.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/g)) reference = match[1];

  if (reference?.startsWith("data:")) {
    return { scriptLabel, mapUrl: null, inlineBytes: reference.length };
  }
  const resolved = reference ? resolve(reference, scriptUrl) : resolve(`${new URL(scriptUrl).pathname}.map`, scriptUrl);
  if (!resolved || resolved.origin !== new URL(scriptUrl).origin) return { scriptLabel, mapUrl: null, inlineBytes: null };
  resolved.hash = "";
  return { scriptLabel, mapUrl: resolved.href, inlineBytes: null };
}

/** True when the first bytes of a response look like a source map document. */
export function looksLikeSourceMap(text: string): boolean {
  const body = text.replace(/^\)\]\}'[^\n]*\n?/, "").trimStart();
  return body.startsWith("{") && /"(mappings|sources)"\s*:/.test(body);
}

export async function checkSourceMaps(ctx: ScanContext, site: string, bundle: ScriptBundle): Promise<Finding[]> {
  const candidates = bundle.scripts.map((script) => sourceMapCandidate(script.url, script.text));
  const exposed: string[] = [];
  const probedEvidence: string[] = [];

  for (const candidate of candidates) {
    if (candidate.inlineBytes !== null) {
      exposed.push(`${candidate.scriptLabel} → inline data: source map (${formatBytes(candidate.inlineBytes)} embedded) — contents not shown`);
    }
  }

  const toProbe = candidates
    .filter((candidate): candidate is MapCandidate & { mapUrl: string } => candidate.mapUrl !== null)
    .slice(0, MAX_SOURCE_MAP_PROBES);

  const results = await Promise.allSettled(
    toProbe.map((candidate) =>
      ctx.fetch(candidate.mapUrl, { maxBytes: SOURCE_MAP_PROBE_BYTES, followRedirects: false }),
    ),
  );

  results.forEach((result, index) => {
    const candidate = toProbe[index];
    if (!candidate) return;
    const label = shortLabel(candidate.mapUrl);
    if (result.status === "rejected") {
      probedEvidence.push(`GET ${label} → request failed (${errorCode(result.reason) ?? "error"})`);
      return;
    }
    const response = result.value;
    const type = response.headers["content-type"] ?? "no content-type";
    if (response.status === 200 && looksLikeSourceMap(response.body.toString("utf8"))) {
      exposed.push(`GET ${label} → HTTP 200 (${type}), source map JSON detected — contents not shown`);
    } else if (response.status === 200) {
      const servedHtml = isHtmlResponse(response);
      probedEvidence.push(`GET ${label} → HTTP 200 (${type}) — ${servedHtml ? "HTML fallback page" : "not source map JSON"}, not exposed`);
    } else {
      probedEvidence.push(`GET ${label} → HTTP ${response.status}`);
    }
  });

  if (exposed.length > 0) {
    return [
      finding({
        id: "frontend.source-maps",
        category: "frontend",
        severity: "warning",
        title: "Source maps are publicly accessible",
        description:
          "Anyone can download your original, un-minified frontend source code — comments, internal API routes, feature flags and business logic included. It makes finding vulnerabilities much easier and often reveals hard-coded URLs or keys.",
        evidence: listWithMore(exposed),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My production site serves JavaScript source maps publicly (e.g. ${exposed[0] ?? ""}).`,
          goal: "No source maps are publicly downloadable in production; error monitoring still gets them privately if needed.",
          steps: [
            "Next.js: remove `productionBrowserSourceMaps: true` from next.config (it defaults to false). Vite: set `build.sourcemap` to `false` or `'hidden'`. Create React App: set `GENERATE_SOURCEMAP=false`. Webpack: use `devtool: false` or `'hidden-source-map'`.",
            "If you use Sentry or another error tracker, keep generating maps but upload them privately and delete them from the build output (e.g. Sentry `sourcemaps.deleteSourcemapsAfterUpload: true`).",
            "Make sure no `//# sourceMappingURL=` comment or inline `data:` source map is left in production bundles.",
            "Redeploy and purge the CDN cache so previously published .map files are no longer served.",
          ],
          verify: "Request one of the listed .map URLs with `curl -I` and confirm 404, then re-run ShipSafe.",
        }),
      }),
    ];
  }

  return [
    finding({
      id: "frontend.source-maps",
      category: "frontend",
      severity: "passed",
      title: "No public source maps found",
      description: "Your original frontend source code isn't downloadable via .map files from the bundles we checked.",
      evidence:
        probedEvidence.length > 0
          ? probedEvidence.join("\n")
          : bundle.scripts.length === 0
            ? "No same-origin scripts to check"
            : "No source map references found in the fetched scripts",
    }),
  ];
}
