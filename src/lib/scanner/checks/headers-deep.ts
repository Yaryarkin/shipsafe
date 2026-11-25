import type { SafeResponse } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding, truncate } from "../utils";

const HEADER_LOCATIONS =
  "Add it globally (Next.js: `async headers()` in next.config; Vercel: `headers` in vercel.json; Netlify: `_headers`; Express: `helmet`; Nginx: `add_header ... always;`).";

/** CSP directive name → list of sources. The first occurrence of a directive wins, as in browsers. */
export function parseCspDirectives(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (name && !directives.has(name)) directives.set(name, tokens.map((token) => token));
  }
  return directives;
}

/** Problems beyond the script-src checks that checkHeaders already performs. */
export function cspHardeningIssues(policy: string): string[] {
  const directives = parseCspDirectives(policy);
  const issues: string[] = [];
  const lower = (name: string) => (directives.get(name) ?? []).map((source) => source.toLowerCase());
  const effective = (name: string) => (directives.has(name) ? lower(name) : lower("default-src"));

  const objectSrc = effective("object-src");
  if (!objectSrc.includes("'none'")) issues.push("object-src is not 'none' (plugin content can run)");
  if (!directives.has("base-uri")) issues.push("no base-uri (an injected <base> tag can hijack relative URLs)");
  if (!directives.has("form-action") && !directives.has("default-src")) issues.push("no form-action (forms can post to any site)");

  for (const name of ["default-src", "connect-src", "frame-src", "form-action", "img-src"] as const) {
    const sources = lower(name);
    if (sources.includes("*")) issues.push(`${name} allows any origin (*)`);
    else if (name !== "img-src" && sources.includes("http:")) issues.push(`${name} allows plain http:`);
  }
  if (lower("script-src").some((source) => source === "http:" || source.startsWith("http://"))) issues.push("script-src allows http: sources");
  if (lower("style-src").includes("*")) issues.push("style-src allows any origin (*)");
  return issues;
}

export function checkCspHardening(site: string, headers: Record<string, string>): Finding[] {
  const csp = headers["content-security-policy"];
  if (!csp) return [];
  const issues = cspHardeningIssues(csp);
  if (issues.length === 0) {
    return [
      finding({
        id: "headers.csp-hardening",
        category: "headers",
        severity: "passed",
        title: "CSP restricts plugins, base URI and wildcards",
        description: "Besides scripts, the policy blocks plugin content and base-tag hijacking and has no wildcard sources in sensitive directives.",
        evidence: `Content-Security-Policy: ${truncate(csp, 200)}`,
      }),
    ];
  }
  return [
    finding({
      id: "headers.csp-hardening",
      category: "headers",
      severity: "info",
      title: "CSP is missing hardening directives",
      description: `The policy leaves gaps that attackers use after finding an injection point: ${issues.join("; ")}.`,
      evidence: `Content-Security-Policy: ${truncate(csp, 200)}`,
      fixPrompt: buildFixPrompt({
        site,
        issue: `My Content-Security-Policy has gaps: ${issues.join("; ")}.`,
        goal: "Add `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and replace wildcard or http: sources with explicit https origins.",
        steps: ["Edit the existing policy instead of replacing it, and test in Report-Only mode first.", HEADER_LOCATIONS],
        verify: `Run \`curl -sI ${site} | grep -i content-security-policy\` and re-scan.`,
      }),
    }),
  ];
}

export function checkCoop(site: string, headers: Record<string, string>): Finding {
  const value = headers["cross-origin-opener-policy"]?.trim().toLowerCase();
  if (value === "same-origin" || value === "same-origin-allow-popups") {
    return finding({
      id: "headers.coop",
      category: "headers",
      severity: "passed",
      title: "Cross-Origin-Opener-Policy is set",
      description: "Pages opened from other sites cannot keep a handle to your window, which blocks several cross-window attacks.",
      evidence: `Cross-Origin-Opener-Policy: ${value}`,
    });
  }
  return finding({
    id: "headers.coop",
    category: "headers",
    severity: "info",
    title: value ? "Cross-Origin-Opener-Policy does not isolate the window" : "Cross-Origin-Opener-Policy is not set",
    description:
      "COOP stops other sites from keeping a reference to your window after opening it in a popup, which closes a class of cross-window leaks and XS-Leaks. Check that OAuth or payment popups still work after enabling it.",
    evidence: `Cross-Origin-Opener-Policy: ${value ?? "(not set)"}`,
    fixPrompt: buildFixPrompt({
      site,
      issue: "My site does not send `Cross-Origin-Opener-Policy: same-origin`.",
      goal: "Send `Cross-Origin-Opener-Policy: same-origin` (or `same-origin-allow-popups` if login or payment popups need it).",
      steps: [HEADER_LOCATIONS, "Test every flow that opens a popup (OAuth, Stripe, social login) after the change."],
      verify: `Run \`curl -sI ${site} | grep -i cross-origin-opener-policy\`.`,
    }),
  });
}

const SENSITIVE_FEATURES = ["camera", "microphone", "geolocation", "payment", "usb", "display-capture"] as const;

/** Features granted to every origin with `feature=*`. */
export function permissionsPolicyWildcards(value: string): string[] {
  const features = new Set<string>();
  for (const part of value.split(",")) {
    const match = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/i.exec(part);
    const name = match?.[1]?.toLowerCase();
    const allowlist = match?.[2];
    if (!name || !allowlist) continue;
    if ((SENSITIVE_FEATURES as readonly string[]).includes(name) && allowlist.split(/\s+/).includes("*")) features.add(name);
  }
  return [...features];
}

export function checkPermissionsPolicyQuality(site: string, headers: Record<string, string>): Finding[] {
  const value = headers["permissions-policy"];
  if (!value) return [];
  const wildcards = permissionsPolicyWildcards(value);
  if (wildcards.length === 0) return [];
  return [
    finding({
      id: "headers.permissions-policy-wildcard",
      category: "headers",
      severity: "info",
      title: "Permissions-Policy grants sensitive features to every origin",
      description: `Embedded third-party frames may request ${wildcards.join(", ")} because the policy allows them with *. Limit each feature to (self) or to the exact origins that need it.`,
      evidence: `Permissions-Policy: ${truncate(value, 200)}`,
      fixPrompt: buildFixPrompt({
        site,
        issue: `My Permissions-Policy allows ${wildcards.join(", ")} for every origin.`,
        goal: "Replace `feature=*` with `feature=()` or `feature=(self)` for every sensitive feature.",
        steps: [HEADER_LOCATIONS],
        verify: `Run \`curl -sI ${site} | grep -i permissions-policy\`.`,
      }),
    }),
  ];
}

/** HSTS quality beyond max-age: includeSubDomains and preload eligibility. */
export function checkHstsPreload(site: string, main: SafeResponse): Finding[] {
  if (!main.url.startsWith("https:")) return [];
  const value = main.headers["strict-transport-security"];
  if (!value) return [];
  const maxAge = Number(/max-age\s*=\s*"?(\d+)"?/i.exec(value)?.[1] ?? "0");
  if (maxAge < 31_536_000) return []; // short max-age is already reported by the transport check
  const includeSubDomains = /includesubdomains/i.test(value);
  const preload = /(?:^|;)\s*preload\b/i.test(value);
  if (includeSubDomains && preload) {
    return [
      finding({
        id: "transport.hsts-preload",
        category: "transport",
        severity: "passed",
        title: "HSTS is preload-ready",
        description: "max-age is at least one year with includeSubDomains and preload, so browsers can ship your domain on the HTTPS-only list.",
        evidence: `Strict-Transport-Security: ${value}`,
      }),
    ];
  }
  const missing = [includeSubDomains ? null : "includeSubDomains", preload ? null : "preload"].filter(Boolean).join(" and ");
  return [
    finding({
      id: "transport.hsts-preload",
      category: "transport",
      severity: "info",
      title: "HSTS is not preload-ready",
      description: `The header is strong on max-age but lacks ${missing}. Without them, subdomains and the very first visit stay open to downgrade attacks. Add them only when every subdomain supports HTTPS.`,
      evidence: `Strict-Transport-Security: ${value}`,
      fixPrompt: buildFixPrompt({
        site,
        issue: `My HSTS header is "${value}" and lacks ${missing}.`,
        goal: "Send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and submit the domain at hstspreload.org.",
        steps: [HEADER_LOCATIONS, "First confirm every subdomain serves valid HTTPS, since includeSubDomains forces it."],
        verify: `Run \`curl -sI ${site} | grep -i strict-transport-security\` and check the domain on hstspreload.org.`,
      }),
    }),
  ];
}

export function checkHeadersDeep(site: string, main: SafeResponse): Finding[] {
  return [
    ...checkCspHardening(site, main.headers),
    checkCoop(site, main.headers),
    ...checkPermissionsPolicyQuality(site, main.headers),
    ...checkHstsPreload(site, main),
  ];
}
