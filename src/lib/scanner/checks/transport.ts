import { errorCode, TLS_ERROR_CODES, type SafeResponse } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding } from "../utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const HSTS_RECOMMENDED_MAX_AGE = 15_552_000; // 180 days

export interface TransportInput {
  site: string;
  main: SafeResponse;
  httpsError: unknown;
  httpProbe: PromiseSettledResult<SafeResponse>;
}

function describeError(error: unknown): string {
  const code = errorCode(error);
  if (code) return code;
  return error instanceof Error ? error.message : "unknown error";
}

function checkHttpsAvailability({ site, main, httpsError }: TransportInput): Finding {
  const id = "transport.https";
  if (httpsError) {
    const code = errorCode(httpsError);
    if (code && TLS_ERROR_CODES.has(code)) {
      return finding({
        id,
        category: "transport",
        severity: "critical",
        title: "TLS certificate is invalid",
        description:
          "Browsers will show a full-page security warning and most visitors will leave. Invalid certificates also train users to click through warnings, which is exactly what attackers performing man-in-the-middle attacks rely on.",
        evidence: `HTTPS handshake failed: ${code}`,
        fixPrompt: buildFixPrompt({
          site,
          issue: `The TLS certificate for ${site} is rejected by browsers (${code}).`,
          goal: "Serve a valid, publicly trusted certificate that matches every hostname I use (apex and www) and renews automatically.",
          steps: [
            "Check where TLS is terminated (Vercel/Netlify/Cloudflare automatic certs, a load balancer, or Nginx/Caddy on a VM).",
            "If self-managed, set up automatic issuance and renewal with Let's Encrypt (certbot or Caddy) and include the full certificate chain.",
            "Make sure the certificate's Subject Alternative Names cover every domain that serves the app.",
          ],
          verify: `Run \`curl -vI ${site}\` and confirm the handshake succeeds without -k, then re-run the ShipSafe scan.`,
        }),
      });
    }
    return finding({
      id,
      category: "transport",
      severity: "critical",
      title: "Site is not available over HTTPS",
      description:
        "Without HTTPS, everything between your users and your server (passwords, session cookies, API keys, form data) travels in plain text and can be read or modified by anyone on the same network.",
      evidence: `HTTPS request failed (${describeError(httpsError)}); the page was only reachable over plain HTTP.`,
      fixPrompt: buildFixPrompt({
        site,
        issue: `${site} is not reachable over HTTPS.`,
        goal: "Serve the whole site over HTTPS with a valid certificate and redirect every HTTP request to HTTPS.",
        steps: [
          "Enable HTTPS at the hosting/CDN layer (Vercel, Netlify and Cloudflare do this automatically once the domain is verified) or install a Let's Encrypt certificate on the server.",
          "Add a permanent (301/308) redirect from http:// to https:// for every path.",
          "Update any hard-coded http:// URLs (API base URLs, OAuth callback URLs, asset URLs) to https://.",
        ],
        verify: `Run \`curl -I ${site.replace(/^http:/, "https:")}\` and confirm it returns 200 over HTTPS.`,
      }),
    });
  }

  if (main.url.startsWith("http:")) {
    return finding({
      id,
      category: "transport",
      severity: "critical",
      title: "HTTPS redirects back to plain HTTP",
      description:
        "Your HTTPS endpoint sends visitors to an insecure http:// URL, so the final page and its cookies are served without encryption.",
      evidence: main.redirects.map((hop) => `${hop.status} ${hop.from} → ${hop.to}`).join("\n") || main.url,
      fixPrompt: buildFixPrompt({
        site,
        issue: "Requests to the HTTPS version of my site are redirected to an http:// URL.",
        goal: "All redirects must stay on https:// and the final page must be served over HTTPS.",
        steps: [
          "Find the redirect rule or middleware that builds the http:// Location header (often a reverse proxy that doesn't trust X-Forwarded-Proto, or a hard-coded base URL).",
          "Fix it so redirects preserve or force the https scheme.",
        ],
        verify: `Run \`curl -sIL ${site}\` and confirm every Location header starts with https://.`,
      }),
    });
  }

  return finding({
    id,
    category: "transport",
    severity: "passed",
    title: "Site is served over HTTPS",
    description: "The page loads over an encrypted HTTPS connection with a certificate browsers trust.",
    evidence: `Final URL: ${main.url}${main.tls?.protocol ? ` (${main.tls.protocol})` : ""}`,
  });
}

function checkCertificate({ site, main }: TransportInput): Finding | null {
  const tls = main.tls;
  if (!tls?.validTo) return null;
  const expiresAt = Date.parse(tls.validTo);
  if (Number.isNaN(expiresAt)) return null;

  const daysLeft = Math.floor((expiresAt - Date.now()) / DAY_MS);
  const legacyProtocol = tls.protocol === "TLSv1" || tls.protocol === "TLSv1.1";
  const evidence = `Issuer: ${tls.issuer ?? "unknown"} · Expires: ${new Date(expiresAt).toUTCString()} (${daysLeft} days) · Protocol: ${tls.protocol ?? "unknown"}`;
  const fixPrompt = buildFixPrompt({
    site,
    issue: legacyProtocol
      ? `The server negotiated a deprecated TLS protocol (${tls.protocol}).`
      : `The TLS certificate for ${site} expires in ${daysLeft} days.`,
    goal: "Certificates renew automatically well before expiry and only TLS 1.2+ is offered.",
    steps: [
      "Confirm automatic renewal is configured (managed hosting/CDN certificates, or a certbot/Caddy renewal timer).",
      "Add an expiry monitor or alert at 21 days remaining.",
      "Disable TLS 1.0 and 1.1 in the server/CDN configuration.",
    ],
    verify: `Run \`echo | openssl s_client -connect ${new URL(site).host}:443 2>/dev/null | openssl x509 -noout -dates\`.`,
  });

  if (daysLeft < 14 || legacyProtocol) {
    return finding({
      id: "transport.certificate",
      category: "transport",
      severity: "warning",
      title: legacyProtocol ? "Deprecated TLS protocol negotiated" : "TLS certificate expires very soon",
      description: legacyProtocol
        ? "TLS 1.0 and 1.1 have known weaknesses and are disabled in modern browsers. Visitors on up-to-date browsers may be unable to connect."
        : "If the certificate expires, every visitor will hit a browser security wall. Make sure renewal is automated.",
      evidence,
      fixPrompt,
    });
  }
  if (daysLeft < 30) {
    return finding({
      id: "transport.certificate",
      category: "transport",
      severity: "info",
      title: "TLS certificate renews within 30 days",
      description: "Not a problem if renewal is automated (managed hosts renew around this point). Double-check if you manage certificates yourself.",
      evidence,
      fixPrompt,
    });
  }
  return finding({
    id: "transport.certificate",
    category: "transport",
    severity: "passed",
    title: "TLS certificate is valid",
    description: "The certificate is trusted, not close to expiry, and a modern TLS protocol was negotiated.",
    evidence,
  });
}

function checkHttpRedirect({ site, httpProbe, httpsError }: TransportInput): Finding | null {
  const id = "transport.http-redirect";
  const fixPrompt = buildFixPrompt({
    site,
    issue: "Plain http:// requests to my site are not redirected to https://.",
    goal: "Every http:// request gets a permanent 301/308 redirect to the same path on https://.",
    steps: [
      "Add the redirect at the edge if possible (Vercel/Netlify/Cloudflare 'Always use HTTPS', or an Nginx `return 301 https://$host$request_uri;` server block).",
      "If the app is behind a proxy, make sure the app trusts X-Forwarded-Proto so it doesn't create redirect loops.",
    ],
    verify: `Run \`curl -I ${site.replace(/^https:/, "http:")}\` and confirm a 301/308 with a Location starting with https://.`,
  });

  if (httpProbe.status === "rejected") {
    if (httpsError) return null;
    return finding({
      id,
      category: "transport",
      severity: "passed",
      title: "Plain HTTP is not served",
      description: "Port 80 did not serve the site, so there is no unencrypted version of your pages to fall back to.",
      evidence: `http:// request failed: ${describeError(httpProbe.reason)}`,
    });
  }

  const probe = httpProbe.value;
  const location = probe.headers.location ?? "";
  if (probe.status >= 300 && probe.status < 400 && location) {
    let target: URL | null = null;
    try {
      target = new URL(location, probe.url);
    } catch {
      target = null;
    }
    if (target?.protocol === "https:") {
      return finding({
        id,
        category: "transport",
        severity: "passed",
        title: "HTTP redirects to HTTPS",
        description: "Visitors who type your domain without https:// are sent to the encrypted version automatically.",
        evidence: `GET ${probe.url} → ${probe.status} Location: ${target.href}`,
      });
    }
    return finding({
      id,
      category: "transport",
      severity: "warning",
      title: "HTTP redirect does not go straight to HTTPS",
      description:
        "The first redirect from http:// stays on plain HTTP. Each unencrypted hop is a chance for an attacker on the network to tamper with the redirect.",
      evidence: `GET ${probe.url} → ${probe.status} Location: ${location}`,
      fixPrompt,
    });
  }

  if (probe.status >= 200 && probe.status < 300) {
    if (httpsError) return null; // already reported as critical
    return finding({
      id,
      category: "transport",
      severity: "warning",
      title: "HTTP version does not redirect to HTTPS",
      description:
        "Your site also answers on plain http:// without redirecting. Anyone following an old link or typing the domain gets an unencrypted page that can be modified in transit.",
      evidence: `GET ${probe.url} → ${probe.status} (no redirect)`,
      fixPrompt,
    });
  }

  return finding({
    id,
    category: "transport",
    severity: "info",
    title: "Unexpected response on plain HTTP",
    description: "The http:// version neither redirects to HTTPS nor serves the page. Usually harmless, but a 301 to HTTPS is friendlier for users and crawlers.",
    evidence: `GET ${probe.url} → ${probe.status}`,
    fixPrompt,
  });
}

function checkHsts({ site, main }: TransportInput): Finding | null {
  if (!main.url.startsWith("https:")) return null;
  const id = "transport.hsts";
  const value = main.headers["strict-transport-security"];
  const fixPrompt = buildFixPrompt({
    site,
    issue: value
      ? `The Strict-Transport-Security header is weak: "${value}".`
      : "My site does not send a Strict-Transport-Security (HSTS) header.",
    goal: "Send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` on every HTTPS response.",
    steps: [
      "Add the header globally (Next.js: `headers()` in next.config; Vercel: vercel.json `headers`; Netlify: `_headers`; Express: `helmet.hsts()`; Nginx: `add_header ... always;`).",
      "Only add `includeSubDomains` if every subdomain supports HTTPS.",
      "Do not send HSTS on plain HTTP responses.",
    ],
    verify: `Run \`curl -sI ${site} | grep -i strict-transport-security\`.`,
  });

  if (!value) {
    return finding({
      id,
      category: "transport",
      severity: "warning",
      title: "HSTS header is missing",
      description:
        "Without HSTS, a visitor's first request can be silently downgraded to HTTP on hostile Wi-Fi (SSL stripping). HSTS tells browsers to always use HTTPS for your domain.",
      evidence: "Strict-Transport-Security: (not set)",
      fixPrompt,
    });
  }

  const maxAge = Number(/max-age\s*=\s*"?(\d+)"?/i.exec(value)?.[1] ?? "0");
  if (maxAge < HSTS_RECOMMENDED_MAX_AGE) {
    return finding({
      id,
      category: "transport",
      severity: "info",
      title: "HSTS max-age is short",
      description: `HSTS is enabled but max-age is ${maxAge} seconds. Use at least 180 days (15552000) — ideally 2 years — so browsers keep enforcing HTTPS between visits.`,
      evidence: `Strict-Transport-Security: ${value}`,
      fixPrompt,
    });
  }

  return finding({
    id,
    category: "transport",
    severity: "passed",
    title: "HSTS is enabled",
    description: "Browsers will refuse to load your site over plain HTTP after the first visit.",
    evidence: `Strict-Transport-Security: ${value}`,
  });
}

export function checkTransport(input: TransportInput): Finding[] {
  return [checkHttpsAvailability(input), checkCertificate(input), checkHttpRedirect(input), checkHsts(input)].filter(
    (item): item is Finding => item !== null,
  );
}
