import { scoreFindings, sortFindings } from "@/lib/scanner/scoring";
import type { Finding, ScanResult } from "@/lib/scanner/types";
import { buildFixPrompt, finding } from "@/lib/scanner/utils";

/**
 * A realistic, fully static sample report so visitors can explore the UI instantly (no network).
 * The target uses the reserved .example TLD so it never points at a real site.
 */
const SITE = "https://launchpad-demo.example";

const demoFindings: Finding[] = [
  finding({
    id: "secrets.stripe-live",
    category: "secrets",
    severity: "critical",
    title: "Stripe live secret key exposed in client code",
    description:
      "A Stripe live secret key is shipped to every visitor's browser. Anyone can open DevTools, copy it and use it to issue refunds, read customer data or create charges. Rotate it now — removing it from the code is not enough, because it is already public.",
    evidence: "sk_live_****9f3A  in /_next/static/chunks/app/checkout/page-4c1e2a.js",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "A Stripe live secret key is exposed in my client-side JavaScript (found in /_next/static/chunks/app/checkout/page-4c1e2a.js).",
      goal: "The secret must only exist on the server, and the leaked one must be revoked.",
      steps: [
        "Rotation first: Roll the key in Stripe Dashboard → Developers → API keys, and review recent API logs for unknown activity.",
        "Search the codebase for where this key is read. In Next.js, any env var prefixed NEXT_PUBLIC_ is inlined into the browser bundle — rename it (e.g. NEXT_PUBLIC_STRIPE_SECRET_KEY → STRIPE_SECRET_KEY).",
        "Move checkout-session creation into a server-only route handler (app/api/checkout/route.ts) and have the frontend call it.",
        "Add `import 'server-only'` to the module that creates the Stripe client so it can never be bundled for the browser again.",
        "Redeploy, then run `grep -r \"sk_live_\" .next/static` to confirm the key is gone from the client bundle.",
      ],
      verify: "Re-run the ShipSafe scan and confirm this finding is gone; check the Stripe dashboard shows the old key as revoked.",
    }),
  }),
  finding({
    id: "headers.csp",
    category: "headers",
    severity: "warning",
    title: "Content-Security-Policy is missing",
    description:
      "CSP is your main defense against cross-site scripting (XSS). Without it, a single injected <script> (from user content, a compromised npm package or a third-party widget) can steal sessions and tokens.",
    evidence: "Content-Security-Policy: (not set)",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My site has no Content-Security-Policy header.",
      goal: "Ship a Content-Security-Policy that blocks injected scripts without breaking the app.",
      steps: [
        "Inventory every external origin the app loads scripts, styles, images, fonts, frames and API calls from (analytics, Stripe, Supabase, fonts, etc.).",
        "Write a policy starting from `default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` and allow-list only those origins per directive.",
        "Avoid 'unsafe-inline' and 'unsafe-eval' for scripts; use nonces (Next.js supports nonces via middleware).",
        "Roll it out as Content-Security-Policy-Report-Only first, then enforce it.",
      ],
      verify: `Run \`curl -sI ${SITE} | grep -i content-security-policy\`.`,
    }),
  }),
  finding({
    id: "transport.hsts",
    category: "transport",
    severity: "warning",
    title: "HSTS header is missing",
    description:
      "Without HSTS, a visitor's first request can be silently downgraded to HTTP on hostile Wi-Fi (SSL stripping). HSTS tells browsers to always use HTTPS for your domain.",
    evidence: "Strict-Transport-Security: (not set)",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My site does not send a Strict-Transport-Security (HSTS) header.",
      goal: "Send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` on every HTTPS response.",
      steps: [
        "Add the header globally (Next.js: `headers()` in next.config; Vercel: vercel.json `headers`; Netlify: `_headers`; Express: `helmet.hsts()`).",
        "Only add `includeSubDomains` if every subdomain supports HTTPS.",
      ],
      verify: `Run \`curl -sI ${SITE} | grep -i strict-transport-security\`.`,
    }),
  }),
  finding({
    id: "cookies.httponly",
    category: "cors-cookies",
    severity: "warning",
    title: "Session-like cookies readable by JavaScript",
    description:
      "Cookies that look like session or auth tokens are missing HttpOnly, so any XSS bug or malicious third-party script can steal them and hijack accounts.",
    evidence: "sb-access-token [Secure, no HttpOnly, SameSite=lax]",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "Session-like cookies are missing HttpOnly: sb-access-token.",
      goal: "Auth cookies are HttpOnly, Secure and SameSite=Lax.",
      steps: [
        "This app uses Supabase auth: switch to @supabase/ssr with cookie-based sessions handled in middleware/route handlers.",
        "Set `httpOnly: true`, `secure: true` and `sameSite: 'lax'` in the cookie options.",
      ],
      verify: `Open DevTools → Application → Cookies on ${SITE} and confirm the HttpOnly column is checked.`,
    }),
  }),
  finding({
    id: "secrets.supabase-public",
    category: "secrets",
    severity: "info",
    title: "Supabase client config detected — verify Row-Level Security",
    description:
      "The Supabase URL and anon/publishable key are meant to be public. That's safe ONLY if Row-Level Security is enabled with correct policies on every table; otherwise anyone can read or modify your data using these values.",
    evidence: "https://abcdefghijklmnopqrst.supabase.co  in /_next/static/chunks/main-app.js\nanon key eyJhbGci****Qx8M  in /_next/static/chunks/main-app.js",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My app uses Supabase from the browser with the public anon key. I need to verify that Row-Level Security protects all data.",
      goal: "Every table in exposed schemas has RLS enabled with least-privilege policies, and storage buckets are locked down.",
      steps: [
        "List every table in the `public` schema and show whether RLS is enabled; enable it on all of them.",
        "For each table, write explicit policies scoped to `auth.uid()`. Remove any `using (true)` policies on private data.",
        "Review storage buckets and RPC functions.",
        "Write a test that uses the anon key and a second user's session to prove they cannot read another user's rows.",
      ],
      verify: "Run the Supabase Security Advisor and confirm zero RLS warnings.",
    }),
  }),
  finding({
    id: "headers.permissions-policy",
    category: "headers",
    severity: "info",
    title: "Permissions-Policy is not set",
    description:
      "This header lets you switch off browser features you don't use (camera, microphone, geolocation, payment), so a compromised third-party script can't request them.",
    evidence: "Permissions-Policy: (not set)",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My site does not send a Permissions-Policy header.",
      goal: "Send `camera=(), microphone=(), geolocation=(), payment=(), usb=()` unless a feature is needed.",
      steps: ["Search the codebase for getUserMedia, geolocation, PaymentRequest and keep only what's used."],
      verify: `Run \`curl -sI ${SITE} | grep -i permissions-policy\`.`,
    }),
  }),
  finding({
    id: "exposure.tech-disclosure",
    category: "exposure",
    severity: "info",
    title: "X-Powered-By header reveals your framework",
    description: "No version is shown, but the header fingerprints your stack for automated scanners. It serves no purpose for users.",
    evidence: "Server: Vercel · X-Powered-By: Next.js",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My responses send `X-Powered-By: Next.js`.",
      goal: "Remove framework fingerprints from response headers.",
      steps: ["Set `poweredByHeader: false` in next.config.ts."],
      verify: `Run \`curl -sI ${SITE}\` and confirm no X-Powered-By header.`,
    }),
  }),
  finding({
    id: "frontend.sri",
    category: "frontend",
    severity: "info",
    title: "Third-party scripts without Subresource Integrity",
    description:
      "These scripts run with full access to your page but are loaded from other servers without an `integrity` hash. If that CDN or vendor is compromised, the attacker's code runs on your site. Pin versioned files with SRI, self-host them, or restrict evergreen vendor scripts with a strict CSP.",
    evidence: "cdn.jsdelivr.net/npm/confetti-js@0.0.18/dist/index.min.js",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My page loads cdn.jsdelivr.net/npm/confetti-js@0.0.18/dist/index.min.js without Subresource Integrity.",
      goal: "Every static, versioned third-party script has an `integrity` + `crossorigin=\"anonymous\"` attribute, or is self-hosted.",
      steps: [
        "Prefer installing the package from npm and bundling it instead of loading it from a CDN.",
        "Otherwise add an SRI hash (`curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A`) via `next/script` `integrity` and `crossOrigin` props.",
      ],
      verify: "View the page source and confirm the script has an integrity attribute and loads without console errors.",
    }),
  }),
  finding({
    id: "exposure.security-txt",
    category: "exposure",
    severity: "info",
    title: "No security.txt found",
    description:
      "security.txt (RFC 9116) tells researchers who find a vulnerability how to reach you privately, instead of posting it publicly or giving up. It takes two minutes to add.",
    evidence: "GET /.well-known/security.txt → HTTP 404 (text/html; charset=utf-8)",
    fixPrompt: buildFixPrompt({
      site: SITE,
      issue: "My site has no valid /.well-known/security.txt file.",
      goal: "Publish an RFC 9116 security.txt so security researchers know how to report vulnerabilities privately.",
      steps: [
        "Create `public/.well-known/security.txt` with `Contact: mailto:security@<my-domain>` and an `Expires:` date within the next 12 months.",
      ],
      verify: `Run \`curl -s ${SITE}/.well-known/security.txt\`.`,
    }),
  }),
  finding({
    id: "frontend.source-maps",
    category: "frontend",
    severity: "passed",
    title: "No public source maps found",
    description: "Your original frontend source code isn't downloadable via .map files from the bundles we checked.",
    evidence: "GET /_next/static/chunks/main-app.js.map → HTTP 404\nGET /_next/static/chunks/app/page.js.map → HTTP 404",
  }),
  finding({
    id: "frontend.mixed-content",
    category: "frontend",
    severity: "passed",
    title: "No mixed content",
    description: "All scripts, stylesheets and images referenced in the page HTML load over HTTPS.",
    evidence: "No http:// <script>, <link> or <img> URLs found in the HTML.",
  }),
  finding({
    id: "transport.https",
    category: "transport",
    severity: "passed",
    title: "Site is served over HTTPS",
    description: "The page loads over an encrypted HTTPS connection with a certificate browsers trust.",
    evidence: `Final URL: ${SITE}/ (TLSv1.3)`,
  }),
  finding({
    id: "transport.certificate",
    category: "transport",
    severity: "passed",
    title: "TLS certificate is valid",
    description: "The certificate is trusted, not close to expiry, and a modern TLS protocol was negotiated.",
    evidence: "Issuer: Let's Encrypt · Expires in 71 days · Protocol: TLSv1.3",
  }),
  finding({
    id: "transport.http-redirect",
    category: "transport",
    severity: "passed",
    title: "HTTP redirects to HTTPS",
    description: "Visitors who type your domain without https:// are sent to the encrypted version automatically.",
    evidence: `GET http://launchpad-demo.example/ → 308 Location: ${SITE}/`,
  }),
  finding({
    id: "headers.framing",
    category: "headers",
    severity: "passed",
    title: "Clickjacking protection is enabled",
    description: "Other sites cannot embed your pages in an invisible iframe to trick users into clicking buttons.",
    evidence: "X-Frame-Options: DENY",
  }),
  finding({
    id: "headers.nosniff",
    category: "headers",
    severity: "passed",
    title: "MIME sniffing is disabled",
    description: "Browsers will not reinterpret uploaded or served files as executable scripts.",
    evidence: "X-Content-Type-Options: nosniff",
  }),
  finding({
    id: "headers.referrer-policy",
    category: "headers",
    severity: "passed",
    title: "Referrer-Policy is set",
    description: "Full URLs are not leaked to third-party sites via the Referer header.",
    evidence: "Referrer-Policy: strict-origin-when-cross-origin",
  }),
  finding({
    id: "exposure.env",
    category: "exposure",
    severity: "passed",
    title: ".env file is not publicly accessible",
    description: "Your environment file (database URLs, API secrets) cannot be downloaded from the web root.",
    evidence: "GET /.env → HTTP 404 (text/html; charset=utf-8)",
  }),
  finding({
    id: "exposure.git",
    category: "exposure",
    severity: "passed",
    title: ".git directory is not exposed",
    description: "Your repository metadata cannot be downloaded, so source code and commit history stay private.",
    evidence: "GET /.git/HEAD → HTTP 404 (text/html; charset=utf-8)",
  }),
  finding({
    id: "exposure.robots",
    category: "exposure",
    severity: "passed",
    title: "robots.txt is present",
    description: "Search engines get crawl instructions, and no sensitive-looking paths are advertised.",
    evidence: "GET /robots.txt → HTTP 200 (text/plain)",
  }),
  finding({
    id: "exposure.sitemap",
    category: "exposure",
    severity: "passed",
    title: "sitemap.xml is present",
    description: "Search engines can discover your public pages. Make sure it lists only pages meant to be public.",
    evidence: "GET /sitemap.xml → HTTP 200 (application/xml)",
  }),
  finding({
    id: "cors.policy",
    category: "cors-cookies",
    severity: "passed",
    title: "CORS is not overly permissive",
    description: "Untrusted origins are not granted access to your responses.",
    evidence:
      "Request Origin: https://shipsafe-cors-probe.example → Access-Control-Allow-Origin: (not set) · Access-Control-Allow-Credentials: (not set)",
  }),
];

export function createDemoReport(): ScanResult {
  const findings = sortFindings(demoFindings);
  const { score, grade, summary } = scoreFindings(findings);
  return {
    target: `${SITE}/`,
    finalUrl: `${SITE}/`,
    scannedAt: new Date().toISOString(),
    overallScore: score,
    grade,
    scanDurationMs: 8_412,
    summary,
    findings,
  };
}
