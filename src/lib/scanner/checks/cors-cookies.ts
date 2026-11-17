import type { SafeResponse, ScanContext } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding } from "../utils";

/** Reserved TLD (RFC 2606) – guaranteed never to be a real allowed origin. */
const PROBE_ORIGIN = "https://shipsafe-cors-probe.example";

const SENSITIVE_COOKIE = /(sess|sid|token|auth|jwt|login|remember|refresh|access|account|user_id|uid)/i;
const CSRF_COOKIE = /(csrf|xsrf)/i;

interface ParsedCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

function parseCookie(header: string): ParsedCookie | null {
  const [pair, ...attributes] = header.split(";");
  const name = pair?.split("=")[0]?.trim();
  if (!name) return null;
  const attrs = attributes.map((attribute) => attribute.trim().toLowerCase());
  const sameSite = attrs.find((attribute) => attribute.startsWith("samesite="))?.split("=")[1] ?? null;
  return {
    name,
    secure: attrs.includes("secure"),
    httpOnly: attrs.includes("httponly"),
    sameSite,
  };
}

function checkCors(site: string, main: SafeResponse, probe: SafeResponse | null): Finding {
  const id = "cors.policy";
  const source = probe ?? main;
  const acao = source.headers["access-control-allow-origin"]?.trim();
  const credentials = source.headers["access-control-allow-credentials"]?.trim().toLowerCase() === "true";
  const evidence = `Request Origin: ${probe ? PROBE_ORIGIN : "(none)"} → Access-Control-Allow-Origin: ${acao ?? "(not set)"} · Access-Control-Allow-Credentials: ${credentials ? "true" : "(not set)"}`;
  const fixPrompt = buildFixPrompt({
    site,
    issue: `My CORS configuration is too permissive (${evidence}).`,
    goal: "Only explicitly trusted origins may make credentialed cross-origin requests; never reflect arbitrary Origin headers.",
    steps: [
      "Find where CORS headers are set (cors() middleware, Next.js route handlers/middleware, vercel.json/netlify headers, API gateway, Supabase/Firebase function config).",
      "Replace wildcard or reflected origins with a fixed allow-list (e.g. my production domain and localhost in development only).",
      "Only send `Access-Control-Allow-Credentials: true` for allow-listed origins, and add `Vary: Origin`.",
    ],
    verify: `Run \`curl -sI -H "Origin: https://evil.example" ${site}\` and confirm the Origin is NOT echoed back.`,
  });

  if (acao === "*" && credentials) {
    return finding({
      id,
      category: "cors-cookies",
      severity: "critical",
      title: "Wildcard CORS combined with credentials",
      description:
        "Your server allows any origin and also allows credentials. Browsers reject this exact combination, which usually means someone is 'fixing' CORS by trial and error — and the next step is often reflecting the Origin, which lets any website read your users' private data.",
      evidence,
      fixPrompt,
    });
  }
  if (probe && acao === PROBE_ORIGIN && credentials) {
    return finding({
      id,
      category: "cors-cookies",
      severity: "critical",
      title: "CORS trusts any website with credentials",
      description:
        "Your server echoes back whatever Origin it receives and allows credentials. Any malicious website a logged-in user visits can call your API as that user and read the responses.",
      evidence,
      fixPrompt,
    });
  }
  if (probe && acao === PROBE_ORIGIN) {
    return finding({
      id,
      category: "cors-cookies",
      severity: "warning",
      title: "CORS reflects arbitrary origins",
      description:
        "Your server echoes back any Origin header. Without credentials this is limited, but it usually signals a catch-all CORS config that can become dangerous once cookies or auth headers are added.",
      evidence,
      fixPrompt,
    });
  }
  if (acao === "null") {
    return finding({
      id,
      category: "cors-cookies",
      severity: "warning",
      title: "CORS allows the 'null' origin",
      description: "Sandboxed iframes and local files send Origin: null, so allowing it effectively lets attackers bypass your CORS allow-list.",
      evidence,
      fixPrompt,
    });
  }
  if (acao === "*") {
    return finding({
      id,
      category: "cors-cookies",
      severity: "info",
      title: "Wildcard CORS on the main page",
      description: "Any site can read this response. That's fine for genuinely public content, but make sure authenticated API routes don't share this config.",
      evidence,
      fixPrompt,
    });
  }
  return finding({
    id,
    category: "cors-cookies",
    severity: "passed",
    title: "CORS is not overly permissive",
    description: "Untrusted origins are not granted access to your responses.",
    evidence,
  });
}

function checkCookies(site: string, isHttps: boolean, setCookies: string[]): Finding[] {
  const byName = new Map<string, ParsedCookie>();
  for (const header of setCookies) {
    const cookie = parseCookie(header);
    if (cookie && !byName.has(cookie.name)) byName.set(cookie.name, cookie);
  }
  const cookies = [...byName.values()];

  if (cookies.length === 0) {
    return [
      finding({
        id: "cookies.none",
        category: "cors-cookies",
        severity: "passed",
        title: "No cookies set on the landing page",
        description: "Nothing to harden here. Re-check after login, since auth cookies are usually set later.",
        evidence: "Set-Cookie: (none on the scanned URL)",
      }),
    ];
  }

  const describe = (list: ParsedCookie[]) =>
    list
      .map((cookie) => `${cookie.name} [${[cookie.secure ? "Secure" : "no Secure", cookie.httpOnly ? "HttpOnly" : "no HttpOnly", cookie.sameSite ? `SameSite=${cookie.sameSite}` : "no SameSite"].join(", ")}]`)
      .join("\n");

  const results: Finding[] = [];
  const cookiePrompt = (issue: string) =>
    buildFixPrompt({
      site,
      issue,
      goal: "Every cookie uses Secure; session/auth cookies are also HttpOnly; all cookies set SameSite=Lax (or Strict) unless cross-site use is required.",
      steps: [
        "Find where each cookie is set (auth library config such as NextAuth/Auth.js, Supabase SSR, Lucia, express-session, or manual Set-Cookie calls).",
        "Set `secure: true`, `httpOnly: true` (for anything auth-related) and `sameSite: 'lax'` on each one.",
        "Cookie values are never needed by client JS for auth — if the frontend reads a token cookie, move it to an HttpOnly cookie and use a server route instead.",
      ],
      verify: `Open DevTools → Application → Cookies on ${site} and check the Secure, HttpOnly and SameSite columns.`,
    });

  const missingSecure = isHttps ? cookies.filter((cookie) => !cookie.secure) : [];
  if (missingSecure.length > 0) {
    results.push(
      finding({
        id: "cookies.secure",
        category: "cors-cookies",
        severity: "warning",
        title: "Cookies missing the Secure flag",
        description: "These cookies can be sent over unencrypted HTTP connections, where anyone on the network can read them.",
        evidence: describe(missingSecure),
        fixPrompt: cookiePrompt(`These cookies are set without the Secure attribute: ${missingSecure.map((cookie) => cookie.name).join(", ")}.`),
      }),
    );
  }

  const sensitiveNoHttpOnly = cookies.filter(
    (cookie) => !cookie.httpOnly && SENSITIVE_COOKIE.test(cookie.name) && !CSRF_COOKIE.test(cookie.name),
  );
  if (sensitiveNoHttpOnly.length > 0) {
    results.push(
      finding({
        id: "cookies.httponly",
        category: "cors-cookies",
        severity: "warning",
        title: "Session-like cookies readable by JavaScript",
        description:
          "Cookies that look like session or auth tokens are missing HttpOnly, so any XSS bug or malicious third-party script can steal them and hijack accounts.",
        evidence: describe(sensitiveNoHttpOnly),
        fixPrompt: cookiePrompt(`Session-like cookies are missing HttpOnly: ${sensitiveNoHttpOnly.map((cookie) => cookie.name).join(", ")}.`),
      }),
    );
  }

  const missingSameSite = cookies.filter((cookie) => !cookie.sameSite);
  if (missingSameSite.length > 0) {
    results.push(
      finding({
        id: "cookies.samesite",
        category: "cors-cookies",
        severity: "info",
        title: "Cookies without an explicit SameSite",
        description:
          "Modern browsers default to Lax, but being explicit protects users on older browsers against cross-site request forgery (CSRF).",
        evidence: describe(missingSameSite),
        fixPrompt: cookiePrompt(`These cookies don't set SameSite: ${missingSameSite.map((cookie) => cookie.name).join(", ")}.`),
      }),
    );
  }

  if (results.length === 0) {
    results.push(
      finding({
        id: "cookies.flags",
        category: "cors-cookies",
        severity: "passed",
        title: "Cookies use secure attributes",
        description: "All cookies on this page set Secure and SameSite, and session-like cookies are HttpOnly.",
        evidence: describe(cookies),
      }),
    );
  }
  return results;
}

export async function checkCorsAndCookies(ctx: ScanContext, site: string, main: SafeResponse): Promise<Finding[]> {
  let probe: SafeResponse | null = null;
  try {
    probe = await ctx.fetch(main.url, {
      maxBytes: 8 * 1024,
      followRedirects: false,
      headers: { origin: PROBE_ORIGIN },
    });
  } catch {
    probe = null;
  }
  const isHttps = main.url.startsWith("https:");
  return [checkCors(site, main, probe), ...checkCookies(site, isHttps, [...main.setCookies, ...(probe?.setCookies ?? [])])];
}
