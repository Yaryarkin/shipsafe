import { revealStyle } from "./Reveal";
const CHECKS = [
  {
    title: "Transport & TLS",
    body: "HTTPS availability, certificate validity and expiry, HTTP → HTTPS redirect, HSTS.",
  },
  {
    title: "Security headers",
    body: "Content-Security-Policy, X-Frame-Options / frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.",
  },
  {
    title: "Public exposure",
    body: "/.env and /.git/HEAD reachability (status + file type only), robots.txt, sitemap.xml, security.txt, Server / X-Powered-By version leaks.",
  },
  {
    title: "App & game builds (.apk / .zip)",
    body: "Unpacked locally in your browser — nothing is uploaded. Debuggable / cleartext / backup flags in AndroidManifest.xml, bundled keystores, .env and service-account files, source maps, insecure Electron settings and leaked keys.",
  },
  {
    title: "Frontend integrity",
    body: "Publicly downloadable source maps, mixed content (http:// assets on https:// pages) and third-party scripts without Subresource Integrity.",
  },
  {
    title: "CORS & cookies",
    body: "Wildcard or reflected origins with credentials, and Secure / HttpOnly / SameSite on every cookie.",
  },
  {
    title: "Client bundle secrets",
    body: "HTML + up to 5 same-origin scripts scanned for Stripe, AWS, OpenAI, Anthropic, GitHub and Supabase service_role keys. Supabase / Firebase configs get an RLS reminder.",
  },
];

const NEVER = [
  "No attack payloads, fuzzing, logins or form submissions — standard GET/HEAD requests only.",
  "File contents are never displayed or stored; secrets are masked (sk_live_****1234).",
  "Private, loopback and internal addresses are blocked (SSRF protection), with 4s per request and 12s total.",
];

export function HowItWorks() {
  return (
    <section id="docs" aria-labelledby="docs-title" className="scroll-mt-20 border-t border-line pt-12">
      <h2 id="docs-title" className="text-sm font-medium uppercase tracking-wide text-muted">
        What ShipSafe checks
      </h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CHECKS.map((check, index) => (
          <div key={check.title} className="reveal surface rounded-lg p-4" style={revealStyle(index + 4)}>
            <h3 className="text-sm font-medium">{check.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{check.body}</p>
          </div>
        ))}
        <div className="reveal rounded-lg border border-dashed border-line p-4" style={revealStyle(CHECKS.length + 4)}>
          <h3 className="text-sm font-medium">What it never does</h3>
          <ul className="mt-1.5 space-y-1.5">
            {NEVER.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
