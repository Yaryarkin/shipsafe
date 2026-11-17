import type { SafeResponse } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding, truncate } from "../utils";

const HEADER_LOCATIONS =
  "Add it globally (Next.js: `async headers()` in next.config; Vercel: `headers` in vercel.json; Netlify: `_headers`; Cloudflare: Transform Rules; Express: `helmet`; Nginx: `add_header ... always;`).";

function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (name && !directives.has(name)) directives.set(name, tokens);
  }
  return directives;
}

function checkCsp(site: string, headers: Record<string, string>): Finding {
  const id = "headers.csp";
  const csp = headers["content-security-policy"];
  const reportOnly = headers["content-security-policy-report-only"];
  const fixPrompt = buildFixPrompt({
    site,
    issue: csp ? `My Content-Security-Policy is too permissive: "${truncate(csp, 300)}".` : "My site has no Content-Security-Policy header.",
    goal: "Ship a Content-Security-Policy that blocks injected scripts without breaking the app.",
    steps: [
      "Inventory every external origin the app loads scripts, styles, images, fonts, frames and API calls from (analytics, Stripe, Supabase, fonts, etc.).",
      "Write a policy starting from `default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` and allow-list only those origins per directive.",
      "Avoid 'unsafe-inline' and 'unsafe-eval' for scripts; use nonces or hashes (Next.js supports nonces via middleware).",
      "Roll it out as Content-Security-Policy-Report-Only first, check the browser console for violations, then enforce it.",
      HEADER_LOCATIONS,
    ],
    verify: `Run \`curl -sI ${site} | grep -i content-security-policy\` and load the site with DevTools open to confirm no CSP violations.`,
  });

  if (!csp) {
    if (reportOnly) {
      return finding({
        id,
        category: "headers",
        severity: "info",
        title: "CSP is in report-only mode",
        description: "A Content-Security-Policy-Report-Only header is set, which only reports violations and blocks nothing. Switch to enforcing mode once the reports are clean.",
        evidence: `Content-Security-Policy-Report-Only: ${truncate(reportOnly)}`,
        fixPrompt,
      });
    }
    return finding({
      id,
      category: "headers",
      severity: "warning",
      title: "Content-Security-Policy is missing",
      description:
        "CSP is your main defense against cross-site scripting (XSS). Without it, a single injected <script> (from user content, a compromised npm package or a third-party widget) can steal sessions and tokens.",
      evidence: "Content-Security-Policy: (not set)",
      fixPrompt,
    });
  }

  const directives = parseCsp(csp);
  const scriptSources = directives.get("script-src") ?? directives.get("default-src");
  const weaknesses: string[] = [];
  if (!scriptSources) {
    weaknesses.push("no script-src or default-src directive");
  } else {
    const usesNonceOrHash = scriptSources.some((source) => /^'(nonce-|sha256-|sha384-|sha512-|strict-dynamic')/i.test(source));
    if (scriptSources.includes("'unsafe-inline'") && !usesNonceOrHash) weaknesses.push("'unsafe-inline' scripts allowed");
    if (scriptSources.includes("'unsafe-eval'")) weaknesses.push("'unsafe-eval' allowed");
    if (scriptSources.some((source) => source === "*" || source === "https:" || source === "http:" || source === "data:")) {
      weaknesses.push("scripts allowed from any origin");
    }
  }

  if (weaknesses.length > 0) {
    return finding({
      id,
      category: "headers",
      severity: "info",
      title: "Content-Security-Policy is permissive",
      description: `A CSP is present, which is great, but it would not stop most XSS payloads: ${weaknesses.join(", ")}.`,
      evidence: `Content-Security-Policy: ${truncate(csp, 240)}`,
      fixPrompt,
    });
  }

  return finding({
    id,
    category: "headers",
    severity: "passed",
    title: "Content-Security-Policy is set",
    description: "A CSP restricts where scripts can load from, limiting the damage of injected code.",
    evidence: `Content-Security-Policy: ${truncate(csp, 240)}`,
  });
}

function checkFraming(site: string, headers: Record<string, string>): Finding {
  const xfo = headers["x-frame-options"];
  const csp = headers["content-security-policy"];
  const frameAncestors = csp ? parseCsp(csp).get("frame-ancestors") : undefined;
  const protectedByXfo = xfo ? /^(deny|sameorigin)$/i.test(xfo.trim()) : false;

  if (protectedByXfo || frameAncestors) {
    return finding({
      id: "headers.framing",
      category: "headers",
      severity: "passed",
      title: "Clickjacking protection is enabled",
      description: "Other sites cannot embed your pages in an invisible iframe to trick users into clicking buttons.",
      evidence: [xfo ? `X-Frame-Options: ${xfo}` : null, frameAncestors ? `CSP frame-ancestors ${frameAncestors.join(" ")}` : null]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return finding({
    id: "headers.framing",
    category: "headers",
    severity: "warning",
    title: "Clickjacking protection is missing",
    description:
      "Any website can load your app inside a hidden iframe and trick logged-in users into clicking 'Delete account', 'Pay' or 'Grant access'. One header prevents it.",
    evidence: `X-Frame-Options: ${xfo ?? "(not set)"} · CSP frame-ancestors: (not set)`,
    fixPrompt: buildFixPrompt({
      site,
      issue: "My site can be embedded in iframes by any other website (no X-Frame-Options or CSP frame-ancestors).",
      goal: "Send `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (or 'self' if I embed my own pages).",
      steps: ["Check whether any legitimate page needs to be embedded elsewhere (e.g. a widget) and scope exceptions to that route only.", HEADER_LOCATIONS],
      verify: `Run \`curl -sI ${site} | grep -iE "x-frame-options|frame-ancestors"\`.`,
    }),
  });
}

function checkNoSniff(site: string, headers: Record<string, string>): Finding {
  const value = headers["x-content-type-options"];
  if (value?.trim().toLowerCase() === "nosniff") {
    return finding({
      id: "headers.nosniff",
      category: "headers",
      severity: "passed",
      title: "MIME sniffing is disabled",
      description: "Browsers will not reinterpret uploaded or served files as executable scripts.",
      evidence: `X-Content-Type-Options: ${value}`,
    });
  }
  return finding({
    id: "headers.nosniff",
    category: "headers",
    severity: "warning",
    title: "X-Content-Type-Options is missing",
    description:
      "Without `nosniff`, browsers may guess a file's type and execute a user-uploaded file (an avatar, a PDF) as JavaScript or HTML.",
    evidence: `X-Content-Type-Options: ${value ?? "(not set)"}`,
    fixPrompt: buildFixPrompt({
      site,
      issue: "My site does not send `X-Content-Type-Options: nosniff`.",
      goal: "Send `X-Content-Type-Options: nosniff` on every response, including static assets and API routes.",
      steps: [HEADER_LOCATIONS, "Make sure static files and uploads are served with correct Content-Type headers."],
      verify: `Run \`curl -sI ${site} | grep -i x-content-type-options\`.`,
    }),
  });
}

function checkReferrerPolicy(site: string, headers: Record<string, string>): Finding {
  const value = headers["referrer-policy"];
  const fixPrompt = buildFixPrompt({
    site,
    issue: value ? `My Referrer-Policy is "${value}", which leaks full URLs to other sites.` : "My site does not set a Referrer-Policy header.",
    goal: "Send `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` for sensitive apps).",
    steps: [
      HEADER_LOCATIONS,
      "Check that no URLs contain tokens, emails or reset codes in query strings, since those leak through the Referer header.",
    ],
    verify: `Run \`curl -sI ${site} | grep -i referrer-policy\`.`,
  });

  if (!value) {
    return finding({
      id: "headers.referrer-policy",
      category: "headers",
      severity: "info",
      title: "Referrer-Policy is not set",
      description:
        "Modern browsers default to a safe policy, but setting it explicitly protects older browsers and prevents full URLs (which may contain tokens or IDs) from leaking to third parties.",
      evidence: "Referrer-Policy: (not set)",
      fixPrompt,
    });
  }

  const policies = value.toLowerCase().split(",").map((policy) => policy.trim());
  const effective = policies[policies.length - 1] ?? "";
  if (effective === "unsafe-url" || effective === "no-referrer-when-downgrade") {
    return finding({
      id: "headers.referrer-policy",
      category: "headers",
      severity: "warning",
      title: "Referrer-Policy leaks full URLs",
      description:
        "Your policy sends the complete URL, including path and query string, to every external site users navigate to or load resources from. Password-reset tokens and private IDs can leak this way.",
      evidence: `Referrer-Policy: ${value}`,
      fixPrompt,
    });
  }

  return finding({
    id: "headers.referrer-policy",
    category: "headers",
    severity: "passed",
    title: "Referrer-Policy is set",
    description: "Full URLs are not leaked to third-party sites via the Referer header.",
    evidence: `Referrer-Policy: ${value}`,
  });
}

function checkPermissionsPolicy(site: string, headers: Record<string, string>): Finding {
  const value = headers["permissions-policy"] ?? headers["feature-policy"];
  if (value) {
    return finding({
      id: "headers.permissions-policy",
      category: "headers",
      severity: "passed",
      title: "Permissions-Policy is set",
      description: "Powerful browser features (camera, microphone, geolocation) are explicitly restricted.",
      evidence: `Permissions-Policy: ${truncate(value)}`,
    });
  }
  return finding({
    id: "headers.permissions-policy",
    category: "headers",
    severity: "info",
    title: "Permissions-Policy is not set",
    description:
      "This header lets you switch off browser features you don't use (camera, microphone, geolocation, payment), so a compromised third-party script can't request them.",
    evidence: "Permissions-Policy: (not set)",
    fixPrompt: buildFixPrompt({
      site,
      issue: "My site does not send a Permissions-Policy header.",
      goal: "Send a Permissions-Policy that disables every powerful feature the app doesn't use, e.g. `camera=(), microphone=(), geolocation=(), payment=(), usb=()`.",
      steps: ["Search the codebase for getUserMedia, geolocation, PaymentRequest, etc. and keep only those features enabled for 'self'.", HEADER_LOCATIONS],
      verify: `Run \`curl -sI ${site} | grep -i permissions-policy\`.`,
    }),
  });
}

export function checkHeaders(site: string, main: SafeResponse): Finding[] {
  const { headers } = main;
  return [
    checkCsp(site, headers),
    checkFraming(site, headers),
    checkNoSniff(site, headers),
    checkReferrerPolicy(site, headers),
    checkPermissionsPolicy(site, headers),
  ];
}
