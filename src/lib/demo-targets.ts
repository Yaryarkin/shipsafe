import { createDemoReport } from "@/lib/demo-report";
import { enrichFindings } from "@/lib/scanner/fixes";
import { buildScoreBreakdown, scoreFindings, sortFindings } from "@/lib/scanner/scoring";
import { snippetStacksFor, type StackDetection } from "@/lib/scanner/stack";
import type { Category, Finding, ScanResult, Severity } from "@/lib/scanner/types";
import { buildFixPrompt, finding } from "@/lib/scanner/utils";

/**
 * One-click demo targets. All are static fixtures (no network, reserved .example hostnames), so a
 * first-time visitor can open a full report (stack detection, fix queue, readiness gate) instantly.
 */
export type DemoKind = "vibe" | "api" | "hardened";

export interface DemoTargetInfo {
  id: DemoKind;
  /** Button label. */
  label: string;
  host: string;
  blurb: string;
}

export const DEMO_TARGETS: readonly DemoTargetInfo[] = [
  { id: "vibe", label: "Exposed web app", host: "launchpad-demo.example", blurb: "A vibe-coded Next.js app that shipped a live Stripe key." },
  { id: "api", label: "Leaky API", host: "api.rollout-demo.example", blurb: "An Express API with a service key in client code and open CORS." },
  { id: "hardened", label: "Hardened site", host: "app.hardened-demo.example", blurb: "A well-configured production site that earns an A." },
];

const stack = (id: string, label: string, signals: string[]): StackDetection => ({ id: id as StackDetection["id"], label, confidence: "high", signals });

function make(input: {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  evidence?: string;
  fix?: { site: string; issue: string; goal: string; steps: string[]; verify: string };
}): Finding {
  return finding({
    id: input.id,
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    evidence: input.evidence,
    fixPrompt: input.fix ? buildFixPrompt(input.fix) : "",
  });
}

const passed = (id: string, category: Category, title: string, evidence: string): Finding =>
  make({ id, category, severity: "passed", title, description: `${title}.`, evidence });

// ------------------------------------------------------------------------------------------ API

const API_SITE = "https://api.rollout-demo.example";

const API_FINDINGS: Finding[] = [
  make({
    id: "secrets.supabase-service-role",
    category: "secrets",
    severity: "critical",
    title: "Supabase service_role key exposed in client code",
    description:
      "A service_role key is shipped to the browser. It bypasses Row-Level Security, so anyone who copies it can read and write your whole database.",
    evidence: "eyJhbGci****Qm9Y  in /assets/index-9a1f.js",
    fix: {
      site: API_SITE,
      issue: "A Supabase service_role key is exposed in my client-side JavaScript.",
      goal: "The service_role key only exists on the server and the leaked one is rotated.",
      steps: [
        "Rotation first: rotate the JWT secret in Supabase, Project Settings, API.",
        "Move every call that needs the service_role key into a server-only route and call that from the browser.",
        "Use the anon key with Row-Level Security in the browser.",
      ],
      verify: "Search the built bundle for the key prefix and confirm it is gone.",
    },
  }),
  make({
    id: "cors.policy",
    category: "cors-cookies",
    severity: "critical",
    title: "CORS trusts any website with credentials",
    description: "The API echoes any Origin and allows credentials, so a malicious site can call it as a logged-in user and read the answers.",
    evidence: "Request Origin: https://shipsafe-cors-probe.example → Access-Control-Allow-Origin: https://shipsafe-cors-probe.example · Access-Control-Allow-Credentials: true",
    fix: {
      site: API_SITE,
      issue: "My API reflects any Origin with credentials.",
      goal: "Only an allow-list of origins may make credentialed requests.",
      steps: ["Replace the reflected origin with a fixed allow-list.", "Send Vary: Origin and only allow credentials for allow-listed origins."],
      verify: `Run curl -sI -H "Origin: https://evil.example" ${API_SITE} and confirm the origin is not echoed.`,
    },
  }),
  make({
    id: "exposure.tech-disclosure",
    category: "exposure",
    severity: "warning",
    title: "Server software version is disclosed",
    description: "Exact version numbers let attackers look up known vulnerabilities for your stack.",
    evidence: "Server: nginx/1.18.0 · X-Powered-By: Express",
    fix: {
      site: API_SITE,
      issue: "My responses disclose nginx and Express versions.",
      goal: "Remove version numbers and framework fingerprints from response headers.",
      steps: ["Nginx: server_tokens off;", "Express: app.disable('x-powered-by') or helmet."],
      verify: `Run curl -sI ${API_SITE} and confirm no versions appear.`,
    },
  }),
  make({
    id: "transport.hsts",
    category: "transport",
    severity: "warning",
    title: "HSTS header is missing",
    description: "Without HSTS a visitor's first request can be downgraded to HTTP on hostile networks.",
    evidence: "Strict-Transport-Security: (not set)",
    fix: { site: API_SITE, issue: "No HSTS header.", goal: "Send Strict-Transport-Security on every HTTPS response.", steps: ["Add the header globally."], verify: `Run curl -sI ${API_SITE} | grep -i strict-transport-security.` },
  }),
  make({
    id: "headers.nosniff",
    category: "headers",
    severity: "warning",
    title: "X-Content-Type-Options is missing",
    description: "Without nosniff, browsers may guess a file's type and run an uploaded file as a script.",
    evidence: "X-Content-Type-Options: (not set)",
    fix: { site: API_SITE, issue: "No nosniff header.", goal: "Send X-Content-Type-Options: nosniff.", steps: ["Add the header globally."], verify: `Run curl -sI ${API_SITE} | grep -i x-content-type-options.` },
  }),
  make({
    id: "cookies.samesite",
    category: "cors-cookies",
    severity: "warning",
    title: "Session cookie has no SameSite attribute",
    description: "Cookies without SameSite are sent on cross-site requests, which enables cross-site request forgery.",
    evidence: "Set-Cookie: sid=****; Path=/; Secure; HttpOnly",
    fix: { site: API_SITE, issue: "The session cookie has no SameSite.", goal: "Set SameSite=Lax or Strict.", steps: ["Add sameSite to the cookie options."], verify: "Inspect Set-Cookie in DevTools." },
  }),
  make({
    id: "secrets.public-keys",
    category: "secrets",
    severity: "info",
    title: "Public client-side keys found (expected)",
    description: "These keys are designed to be in the browser, so this is not a leak. Make sure each one is restricted to your domains in its provider dashboard.",
    evidence: "Publishable key (Stripe / Clerk) pk_live_****x9Qa  in /assets/index-9a1f.js",
    fix: { site: API_SITE, issue: "My client code contains a publishable key.", goal: "Confirm the key is public by design and restricted.", steps: ["Check the prefix is pk_.", "Restrict allowed domains in the dashboard."], verify: "Re-scan." },
  }),
  make({
    id: "headers.referrer-policy",
    category: "headers",
    severity: "info",
    title: "Referrer-Policy is not set",
    description: "Setting it explicitly prevents full URLs from leaking to third parties.",
    evidence: "Referrer-Policy: (not set)",
    fix: { site: API_SITE, issue: "No Referrer-Policy.", goal: "Send strict-origin-when-cross-origin.", steps: ["Add the header globally."], verify: `Run curl -sI ${API_SITE} | grep -i referrer-policy.` },
  }),
  passed("transport.https", "transport", "HTTPS is available", "Final URL: https://api.rollout-demo.example/ (TLSv1.3)"),
  passed("transport.certificate", "transport", "TLS certificate is valid", "Issuer: R3 · Expires in 61 days"),
  passed("transport.http-redirect", "transport", "HTTP redirects to HTTPS", "GET http://api.rollout-demo.example/ → 301"),
  passed("exposure.env", "exposure", ".env file is not publicly accessible", "GET /.env → HTTP 404"),
  passed("exposure.git", "exposure", ".git directory is not exposed", "GET /.git/HEAD → HTTP 404"),
  passed("exposure.sensitive-files", "exposure", "No leftover backups or dotfiles exposed", "Checked 15 common paths"),
  passed("headers.framing", "headers", "Clickjacking protection is enabled", "X-Frame-Options: DENY"),
  passed("frontend.mixed-content", "frontend", "No mixed content", "All resources use https"),
];

// ------------------------------------------------------------------------------------ hardened

const HARDENED: Finding[] = [
  make({
    id: "headers.coop",
    category: "headers",
    severity: "info",
    title: "Cross-Origin-Opener-Policy is not set",
    description: "COOP stops other sites from keeping a reference to your window. Optional hardening.",
    evidence: "Cross-Origin-Opener-Policy: (not set)",
    fix: { site: "https://app.hardened-demo.example", issue: "No COOP header.", goal: "Send Cross-Origin-Opener-Policy: same-origin.", steps: ["Add the header, then test popups."], verify: "Run curl -sI and look for the header." },
  }),
  make({
    id: "exposure.security-txt",
    category: "exposure",
    severity: "info",
    title: "No security.txt found",
    description: "security.txt tells researchers how to reach you privately. It takes two minutes to add.",
    evidence: "GET /.well-known/security.txt → request failed (HTTP 404)",
    fix: { site: "https://app.hardened-demo.example", issue: "No security.txt.", goal: "Publish an RFC 9116 security.txt.", steps: ["Create public/.well-known/security.txt with Contact and Expires."], verify: "Open the file in a browser." },
  }),
  passed("transport.https", "transport", "HTTPS is available", "Final URL: https://app.hardened-demo.example/ (TLSv1.3)"),
  passed("transport.certificate", "transport", "TLS certificate is valid", "Issuer: R3 · Expires in 74 days"),
  passed("transport.http-redirect", "transport", "HTTP redirects to HTTPS", "GET http://app.hardened-demo.example/ → 308"),
  passed("transport.hsts", "transport", "HSTS is enabled", "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload"),
  passed("transport.hsts-preload", "transport", "HSTS is preload-ready", "max-age 2 years with includeSubDomains and preload"),
  passed("headers.csp", "headers", "Content-Security-Policy is set", "Content-Security-Policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'"),
  passed("headers.csp-hardening", "headers", "CSP restricts plugins, base URI and wildcards", "object-src 'none'; base-uri 'self'"),
  passed("headers.framing", "headers", "Clickjacking protection is enabled", "X-Frame-Options: DENY"),
  passed("headers.nosniff", "headers", "MIME sniffing is disabled", "X-Content-Type-Options: nosniff"),
  passed("headers.referrer-policy", "headers", "Referrer-Policy is set", "Referrer-Policy: strict-origin-when-cross-origin"),
  passed("headers.permissions-policy", "headers", "Permissions-Policy is set", "Permissions-Policy: camera=(), microphone=(), geolocation=()"),
  passed("exposure.env", "exposure", ".env file is not publicly accessible", "GET /.env → HTTP 404"),
  passed("exposure.git", "exposure", ".git directory is not exposed", "GET /.git/HEAD → HTTP 404"),
  passed("exposure.sensitive-files", "exposure", "No leftover backups or dotfiles exposed", "Checked 15 common paths"),
  passed("exposure.tech-disclosure", "exposure", "No server version disclosure", "Server / X-Powered-By: (not set)"),
  passed("cors.policy", "cors-cookies", "CORS is not overly permissive", "Access-Control-Allow-Origin: (not set)"),
  passed("cookies.secure", "cors-cookies", "Cookies use Secure, HttpOnly and SameSite", "session: Secure; HttpOnly; SameSite=Lax"),
  passed("secrets.none", "secrets", "No private keys found in client bundles", "Scanned 5 file(s), 412.8 KB"),
  passed("frontend.mixed-content", "frontend", "No mixed content", "All resources use https"),
  passed("frontend.sri", "frontend", "No third-party scripts without integrity", "0 third-party scripts"),
  passed("frontend.source-maps", "frontend", "No public source maps", "No .js.map files found"),
];

const NEXT_VERCEL = [
  stack("nextjs", "Next.js", ["x-powered-by: Next.js", "/_next/ assets"]),
  stack("vercel", "Vercel", ["x-vercel-id header", "server: Vercel"]),
];

function assemble(host: string, findings: Finding[], detected: StackDetection[], durationMs: number): ScanResult {
  const site = `https://${host}`;
  const sorted = sortFindings(findings);
  const { score, grade, summary } = scoreFindings(sorted);
  return {
    target: `${site}/`,
    finalUrl: `${site}/`,
    scannedAt: new Date().toISOString(),
    overallScore: score,
    grade,
    scanDurationMs: durationMs,
    summary,
    findings: enrichFindings(sorted, site, snippetStacksFor(detected)),
    scoreBreakdown: buildScoreBreakdown(sorted),
    detectedStack: detected,
  };
}

/** Builds a demo report. `vibe` is the original sample; `api` and `hardened` are the other two presets. */
export function createDemoTarget(kind: DemoKind): ScanResult {
  if (kind === "api") {
    return assemble("api.rollout-demo.example", API_FINDINGS, [stack("express", "Node / Express", ["x-powered-by: Express"]), stack("nginx", "Nginx", ["server: nginx"])], 5_906);
  }
  if (kind === "hardened") return assemble("app.hardened-demo.example", HARDENED, NEXT_VERCEL, 3_127);
  return createDemoReport();
}
