import { snippetStacksFor } from "@/lib/scanner/stack";
import type { ScanResult, Stack } from "@/lib/scanner/types";

/**
 * Unified stack config: one copy-ready file per stack that fixes every header and policy finding
 * of a scan at once. Individual snippets stay available per finding; this is the "apply it all"
 * version. Pure, so the report, the Markdown export and the tests share one source.
 */

export type ConfigStack = Extract<Stack, "nextjs" | "vercel" | "nginx">;

export interface GeneratedConfig {
  stack: ConfigStack;
  label: string;
  filename: string;
  language: string;
  code: string;
  /** True when this stack was detected on the target. */
  recommended: boolean;
  /** Ids of the findings this file resolves. */
  covers: string[];
  /** Things the file cannot do for you (shown under the code). */
  notes: string[];
}

interface HeaderSpec {
  name: string;
  value: string;
}

/**
 * A starter policy that works for most apps: scripts and styles from your own origin plus inline
 * (Next.js and most bundlers need inline scripts until you add nonces). Everything else is closed.
 */
export const STARTER_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

const CONFIG_STACKS: ConfigStack[] = ["nextjs", "vercel", "nginx"];
const LABELS: Record<ConfigStack, { label: string; filename: string; language: string }> = {
  nextjs: { label: "Next.js", filename: "next.config.ts", language: "ts" },
  vercel: { label: "Vercel", filename: "vercel.json", language: "json" },
  nginx: { label: "Nginx", filename: "nginx.conf (server block)", language: "nginx" },
};

interface Needs {
  headers: HeaderSpec[];
  covers: string[];
  poweredBy: boolean;
  sourceMaps: boolean;
  httpRedirect: boolean;
}

/** Which headers and server settings the scan's open findings call for. Passed findings add nothing. */
export function configNeeds(result: ScanResult): Needs {
  const open = new Set(result.findings.filter((item) => item.severity !== "passed").map((item) => item.id));
  const has = (...ids: string[]) => ids.filter((id) => open.has(id));
  const headers: HeaderSpec[] = [];
  const covers: string[] = [];
  const add = (ids: string[], header: HeaderSpec) => {
    if (ids.length === 0) return;
    headers.push(header);
    covers.push(...ids);
  };

  add(has("headers.csp", "headers.csp-hardening"), { name: "Content-Security-Policy", value: STARTER_CSP });
  add(has("transport.hsts", "transport.hsts-preload"), { name: "Strict-Transport-Security", value: HSTS_VALUE });
  add(has("headers.framing"), { name: "X-Frame-Options", value: "DENY" });
  add(has("headers.nosniff"), { name: "X-Content-Type-Options", value: "nosniff" });
  add(has("headers.referrer-policy"), { name: "Referrer-Policy", value: "strict-origin-when-cross-origin" });
  add(has("headers.permissions-policy", "headers.permissions-policy-wildcard"), { name: "Permissions-Policy", value: PERMISSIONS_POLICY });
  add(has("headers.coop"), { name: "Cross-Origin-Opener-Policy", value: "same-origin" });

  const techIds = has("exposure.tech-disclosure");
  const mapIds = has("frontend.source-maps");
  const redirectIds = has("transport.http-redirect");
  covers.push(...techIds, ...mapIds, ...redirectIds);

  return { headers, covers, poweredBy: techIds.length > 0, sourceMaps: mapIds.length > 0, httpRedirect: redirectIds.length > 0 };
}

function nextConfig(needs: Needs): string {
  const lines = [
    'import type { NextConfig } from "next";',
    "",
    "const securityHeaders = [",
    ...needs.headers.map((header) => `  { key: "${header.name}", value: "${header.value}" },`),
    "];",
    "",
    "const nextConfig: NextConfig = {",
  ];
  if (needs.poweredBy) lines.push("  poweredByHeader: false,");
  if (needs.sourceMaps) lines.push("  productionBrowserSourceMaps: false,");
  if (needs.headers.length > 0) {
    lines.push("  async headers() {", '    return [{ source: "/(.*)", headers: securityHeaders }];', "  },");
  }
  lines.push("};", "", "export default nextConfig;");
  return lines.join("\n");
}

function vercelConfig(needs: Needs): string {
  return JSON.stringify(
    {
      headers: [
        {
          source: "/(.*)",
          headers: needs.headers.map((header) => ({ key: header.name, value: header.value })),
        },
      ],
    },
    null,
    2,
  );
}

function nginxConfig(needs: Needs): string {
  const lines: string[] = [];
  if (needs.httpRedirect) {
    lines.push("# Redirect plain HTTP to HTTPS", "server {", "  listen 80;", "  server_name your-domain.com www.your-domain.com;", "  return 301 https://$host$request_uri;", "}", "");
  }
  lines.push("server {", "  listen 443 ssl;", "  server_name your-domain.com;", "");
  if (needs.poweredBy) lines.push("  server_tokens off;", "  proxy_hide_header X-Powered-By;", "");
  for (const header of needs.headers) lines.push(`  add_header ${header.name} "${header.value}" always;`);
  if (needs.sourceMaps) lines.push("", "  location ~* \\.map$ { return 404; }");
  lines.push("}");
  return lines.join("\n");
}

function notesFor(stack: ConfigStack, needs: Needs): string[] {
  const notes: string[] = [];
  if (needs.headers.some((header) => header.name === "Content-Security-Policy")) {
    notes.push("The CSP is a starter policy. Add the origins you really use (analytics, payments, fonts) and test it with Content-Security-Policy-Report-Only before enforcing.");
  }
  if (needs.headers.some((header) => header.name === "Strict-Transport-Security")) {
    notes.push("HSTS with includeSubDomains forces HTTPS on every subdomain. Make sure they all have a valid certificate first.");
  }
  if (stack === "vercel") {
    if (needs.poweredBy) notes.push("Hide X-Powered-By in next.config (poweredByHeader: false); vercel.json cannot remove it.");
    if (needs.sourceMaps) notes.push("Disable source maps in your build tool (Next.js: productionBrowserSourceMaps: false).");
    if (needs.httpRedirect) notes.push("Vercel redirects HTTP to HTTPS automatically once the domain is attached.");
  }
  if (stack === "nextjs" && needs.httpRedirect) notes.push("Redirect HTTP to HTTPS at your host or CDN; Next.js cannot do it from next.config.");
  if (stack === "nginx" && needs.headers.length > 0) notes.push("Repeat the add_header lines inside any location block that sets its own add_header, or nginx drops the inherited ones.");
  return notes;
}

/** Number of findings that a unified config would resolve. 0 means there is nothing to generate. */
export function configCoverage(result: ScanResult): number {
  const needs = configNeeds(result);
  return needs.covers.length;
}

/**
 * One config per supported stack (Next.js, Vercel, Nginx), the detected stack first. Returns an
 * empty list when no open finding can be fixed with server or framework configuration.
 */
export function buildStackConfigs(result: ScanResult): GeneratedConfig[] {
  const needs = configNeeds(result);
  if (needs.covers.length === 0) return [];

  const detected = snippetStacksFor(result.detectedStack).filter((stack): stack is ConfigStack => (CONFIG_STACKS as Stack[]).includes(stack));
  const ordered = [...detected, ...CONFIG_STACKS.filter((stack) => !detected.includes(stack))];

  return ordered.map((stack) => {
    const meta = LABELS[stack];
    const code = stack === "nextjs" ? nextConfig(needs) : stack === "vercel" ? vercelConfig(needs) : nginxConfig(needs);
    return { stack, ...meta, code, recommended: detected.includes(stack), covers: needs.covers, notes: notesFor(stack, needs) };
  });
}
