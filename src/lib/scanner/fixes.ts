/**
 * Stack-aware remediation: for each finding id this adds (1) a plain-language business / security
 * impact and (2) copy-paste snippets for the common stacks (Next.js, Vercel, Nginx, Express,
 * Android). Pure and browser-safe. Findings are never dropped or reordered, only extended.
 */
import type { Finding, FixSnippet, Stack } from "./types";

type Snippets = FixSnippet[];

const snippet = (stack: Stack, label: string, language: string, code: string): FixSnippet => ({ stack, label, language, code: code.trim() });

// ------------------------------------------------------------------------------------ header sets

function headerSnippets(name: string, value: string): Snippets {
  return [
    snippet(
      "nextjs",
      "Next.js · next.config.ts",
      "ts",
      `const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "${name}", value: "${value}" }],
      },
    ];
  },
};
export default nextConfig;`,
    ),
    snippet(
      "vercel",
      "Vercel · vercel.json",
      "json",
      `{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [{ "key": "${name}", "value": "${value}" }]
    }
  ]
}`,
    ),
    snippet("nginx", "Nginx · server block", "nginx", `add_header ${name} "${value}" always;`),
    snippet(
      "express",
      "Node / Express",
      "js",
      `app.use((req, res, next) => {
  res.setHeader("${name}", "${value}");
  next();
});`,
    ),
  ];
}

const CSP_VALUE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function cspSnippets(): Snippets {
  return [
    ...headerSnippets("Content-Security-Policy", CSP_VALUE),
    snippet(
      "express",
      "Express · helmet (alternative)",
      "js",
      `import helmet from "helmet";

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);`,
    ),
  ];
}

function hstsSnippets(): Snippets {
  return headerSnippets("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
}

function permissionsSnippets(): Snippets {
  return headerSnippets("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
}

// ----------------------------------------------------------------------------------- other fixes

function redirectSnippets(): Snippets {
  return [
    snippet(
      "nginx",
      "Nginx · redirect to HTTPS",
      "nginx",
      `server {
  listen 80;
  server_name your-domain.com www.your-domain.com;
  return 301 https://$host$request_uri;
}`,
    ),
    snippet(
      "express",
      "Node / Express (behind a proxy)",
      "js",
      `app.set("trust proxy", 1);
app.use((req, res, next) => {
  if (req.secure) return next();
  res.redirect(301, \`https://\${req.headers.host}\${req.originalUrl}\`);
});`,
    ),
    snippet("vercel", "Vercel", "text", "Vercel redirects HTTP to HTTPS automatically. If you still see HTTP, check that the domain is attached to the project and has no external proxy in front."),
  ];
}

function corsSnippets(site: string): Snippets {
  const origin = safeOrigin(site);
  return [
    snippet(
      "express",
      "Node / Express · cors",
      "js",
      `import cors from "cors";

const allowed = ["${origin}"];
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed"));
    },
    credentials: true,
  }),
);`,
    ),
    snippet(
      "nextjs",
      "Next.js · route handler",
      "ts",
      `const ALLOWED = new Set(["${origin}"]);

export function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !ALLOWED.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}`,
    ),
    snippet(
      "nginx",
      "Nginx · allow-list",
      "nginx",
      `map $http_origin $cors_origin {
  default "";
  "${origin}" $http_origin;
}
add_header Access-Control-Allow-Origin $cors_origin always;
add_header Vary Origin always;`,
    ),
  ];
}

function cookieSnippets(): Snippets {
  return [
    snippet(
      "express",
      "Node / Express",
      "js",
      `res.cookie("session", token, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
});`,
    ),
    snippet(
      "nextjs",
      "Next.js · server action / route handler",
      "ts",
      `import { cookies } from "next/headers";

(await cookies()).set("session", token, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 7,
  path: "/",
});`,
    ),
  ];
}

function blockFilesSnippets(): Snippets {
  return [
    snippet(
      "nginx",
      "Nginx · block dotfiles and backups",
      "nginx",
      `location ~ /\\.(?!well-known/) { return 404; }
location ~* \\.(?:env|bak|sql|zip|tar|gz|old|orig|swp)$ { return 404; }`,
    ),
    snippet(
      "express",
      "Node / Express",
      "js",
      `app.use((req, res, next) => {
  if (/^\\/\\.(?!well-known\\/)/.test(req.path) || /\\.(?:env|bak|sql|zip|tar|gz)$/i.test(req.path)) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static("dist", { dotfiles: "ignore" }));`,
    ),
    snippet("vercel", "Vercel · .vercelignore", "text", `.env*\n.git\n*.sql\n*.zip\n*.tar.gz\n*.bak`),
    snippet("nextjs", "Next.js", "text", "Never place secrets, dumps or archives in `public/`: everything inside it is served as-is. Keep .env* out of the repository and rotate any value that was exposed."),
  ];
}

function techSnippets(): Snippets {
  return [
    snippet("nextjs", "Next.js · next.config.ts", "ts", `const nextConfig = { poweredByHeader: false };\nexport default nextConfig;`),
    snippet("nginx", "Nginx", "nginx", `server_tokens off;\nproxy_hide_header X-Powered-By;`),
    snippet("express", "Node / Express", "js", `app.disable("x-powered-by");\n// or: app.use(helmet());`),
  ];
}

function sourceMapSnippets(): Snippets {
  return [
    snippet("nextjs", "Next.js · next.config.ts", "ts", `const nextConfig = { productionBrowserSourceMaps: false };\nexport default nextConfig;`),
    snippet("nginx", "Nginx · hide maps", "nginx", `location ~* \\.map$ { return 404; }`),
    snippet("generic", "Vite / Webpack", "js", `// vite.config.ts\nexport default { build: { sourcemap: false } };\n// webpack.config.js\nmodule.exports = { devtool: false };`),
  ];
}

function secretSnippets(): Snippets {
  return [
    snippet(
      "nextjs",
      "Next.js · keep the secret on the server",
      "ts",
      `// lib/stripe.ts
import "server-only";
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); // no NEXT_PUBLIC_ prefix

// app/api/checkout/route.ts
export async function POST(request: Request) {
  // the browser calls this route; only the server touches the secret
}`,
    ),
    snippet(
      "express",
      "Node / Express",
      "js",
      `// Keep secrets in process.env on the server and never send them to the client.
app.post("/api/charge", requireAuth, async (req, res) => {
  const result = await provider.charge(req.body, { apiKey: process.env.PROVIDER_SECRET });
  res.json({ ok: result.ok });
});`,
    ),
    snippet("generic", "Rotate first", "text", "1. Revoke the leaked key at the provider.\n2. Create a new one and store it only in server environment variables.\n3. Rebuild and confirm the old value no longer appears in the client bundle."),
  ];
}

function mixedContentSnippets(): Snippets {
  return [
    snippet("generic", "HTML", "html", `<!-- use https:// and pin third-party scripts -->\n<script src="https://cdn.example.com/lib@1.2.3/lib.min.js"\n        integrity="sha384-REPLACE_WITH_HASH" crossorigin="anonymous"></script>`),
    ...headerSnippets("Content-Security-Policy", "upgrade-insecure-requests"),
  ];
}

function securityTxtSnippets(): Snippets {
  return [
    snippet(
      "generic",
      "public/.well-known/security.txt",
      "text",
      `Contact: mailto:security@your-domain.com
Expires: 2027-12-31T23:59:59.000Z
Preferred-Languages: en
Canonical: https://your-domain.com/.well-known/security.txt`,
    ),
  ];
}

// --------------------------------------------------------------------------------------- android

function debuggableSnippets(): Snippets {
  return [
    snippet("android", "app/build.gradle.kts", "kotlin", `android {\n  buildTypes {\n    release {\n      isDebuggable = false\n      isMinifyEnabled = true\n      isShrinkResources = true\n    }\n  }\n}`),
    snippet("android", "AndroidManifest.xml", "xml", `<!-- remove android:debuggable entirely; the build type decides -->\n<application android:label="@string/app_name">`),
  ];
}

function cleartextSnippets(): Snippets {
  return [
    snippet("android", "res/xml/network_security_config.xml", "xml", `<network-security-config>\n  <base-config cleartextTrafficPermitted="false" />\n</network-security-config>`),
    snippet("android", "AndroidManifest.xml", "xml", `<application\n  android:networkSecurityConfig="@xml/network_security_config"\n  android:usesCleartextTraffic="false">`),
  ];
}

function backupSnippets(): Snippets {
  return [snippet("android", "AndroidManifest.xml", "xml", `<application\n  android:allowBackup="false"\n  android:fullBackupContent="false"\n  android:dataExtractionRules="@xml/data_extraction_rules">`)];
}

function permissionSnippets(): Snippets {
  return [
    snippet("android", "AndroidManifest.xml · remove a library's permission", "xml", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n  xmlns:tools="http://schemas.android.com/tools">\n  <uses-permission android:name="android.permission.READ_SMS" tools:node="remove" />\n</manifest>`),
  ];
}

// ------------------------------------------------------------------------------------- the catalog

interface CatalogEntry {
  /** Matches a finding id exactly (string) or by pattern. */
  match: string | RegExp;
  impact: string;
  snippets?: (site: string) => Snippets;
}

const CATALOG: CatalogEntry[] = [
  {
    match: "headers.csp",
    impact: "Without a strict CSP one injected script, from a comment box, a hacked npm package or a third-party widget, can steal logins and payments from every visitor.",
    snippets: cspSnippets,
  },
  { match: "headers.csp-hardening", impact: "Gaps in the CSP are what attackers use after they find an injection point: plugin content, base-tag hijacking and open form targets.", snippets: cspSnippets },
  {
    match: "headers.framing",
    impact: "Another site can load yours in a hidden frame and trick logged-in users into clicking buttons such as Pay, Delete or Grant access (clickjacking).",
    snippets: () => headerSnippets("X-Frame-Options", "DENY"),
  },
  {
    match: "headers.nosniff",
    impact: "A user-uploaded file such as an avatar can be treated as a script by the browser, turning an upload form into a way to run code on your domain.",
    snippets: () => headerSnippets("X-Content-Type-Options", "nosniff"),
  },
  {
    match: "headers.referrer-policy",
    impact: "Full page URLs, including reset tokens and private IDs in the query string, can leak to every third-party site your pages load or link to.",
    snippets: () => headerSnippets("Referrer-Policy", "strict-origin-when-cross-origin"),
  },
  {
    match: /^headers\.permissions-policy/,
    impact: "A compromised third-party script or embedded frame can ask for the camera, microphone or location of your visitors under your brand.",
    snippets: permissionsSnippets,
  },
  {
    match: "headers.coop",
    impact: "Sites opened from yours can keep a handle on your window and probe it for private information (cross-window leaks).",
    snippets: () => headerSnippets("Cross-Origin-Opener-Policy", "same-origin"),
  },
  {
    match: /^transport\.hsts/,
    impact: "On public Wi-Fi an attacker can downgrade a visitor's first request to HTTP and read or change the session, with no visible warning.",
    snippets: hstsSnippets,
  },
  {
    match: "transport.http-redirect",
    impact: "Visitors who type your domain without https:// stay on an unencrypted connection and can be intercepted.",
    snippets: redirectSnippets,
  },
  {
    match: "transport.https",
    impact: "Without HTTPS everything, passwords, tokens and payment details, travels in plain text. Browsers also label the site Not secure, which costs sign-ups.",
    snippets: redirectSnippets,
  },
  {
    match: "transport.certificate",
    impact: "An expired or weak certificate shows a full-page browser warning that most visitors will not click through. Your site is effectively down.",
    snippets: () => [snippet("generic", "Renew automatically", "text", "Use managed certificates (Vercel, Cloudflare, Netlify) or certbot with a renewal timer:\n  certbot renew --deploy-hook \"systemctl reload nginx\"")],
  },
  {
    match: "cors.policy",
    impact: "Any website a logged-in user visits can call your API as that user and read the answers, including private data, with no phishing needed.",
    snippets: corsSnippets,
  },
  {
    match: /^cookies\./,
    impact: "Session cookies without Secure, HttpOnly and SameSite can be stolen by scripts, sent over plain HTTP or abused for cross-site request forgery, which means account takeover.",
    snippets: cookieSnippets,
  },
  {
    match: "exposure.env",
    impact: "Your database password and secret API keys are downloadable by anyone. Attackers scan for this file all day, so treat every value as already stolen.",
    snippets: blockFilesSnippets,
  },
  {
    match: "exposure.git",
    impact: "The whole source code and commit history can be rebuilt from your server, including any secret that was ever committed, even if you deleted it later.",
    snippets: blockFilesSnippets,
  },
  {
    match: /^exposure\.file\./,
    impact: "A forgotten backup, dump or dotfile hands attackers source code, user data or credentials without any hacking.",
    snippets: blockFilesSnippets,
  },
  {
    match: "exposure.tech-disclosure",
    impact: "Exact software versions let attackers look up known vulnerabilities for your stack and fire the matching exploit.",
    snippets: techSnippets,
  },
  {
    match: /^exposure\.(?:robots|sitemap-sensitive)$/,
    impact: "These public files act as a map to your admin and internal pages. Hiding a URL is not protection; only authentication is.",
    snippets: () => headerSnippets("X-Robots-Tag", "noindex, nofollow"),
  },
  { match: "exposure.security-txt", impact: "Researchers who find a bug have no private way to tell you, so it gets sold, posted publicly or never reported.", snippets: securityTxtSnippets },
  {
    match: "frontend.source-maps",
    impact: "Public source maps publish your original source code, comments and internal API routes, which speeds up every attack against you.",
    snippets: sourceMapSnippets,
  },
  {
    match: "frontend.mixed-content",
    impact: "Insecure http:// resources on an https page can be swapped by an attacker on the network to inject code into your site.",
    snippets: mixedContentSnippets,
  },
  {
    match: "frontend.sri",
    impact: "If a third-party CDN is hacked, its script runs on your site with full access. A pinned hash makes the browser refuse a tampered file.",
    snippets: mixedContentSnippets,
  },
  {
    match: /^secrets\.(?!none$|supabase-public$|firebase-public$|public-keys$)/,
    impact: "Anyone can open DevTools, copy this key and run up your bill, read your data or impersonate your app. Removing it from the code is not enough, because it is already public.",
    snippets: secretSnippets,
  },
  {
    match: "secrets.public-keys",
    impact: "Public keys are meant to be seen. The risk is reuse: an unrestricted key can be copied to another site and billed to you.",
    snippets: () => [snippet("generic", "Restrict the key", "text", "Google / Mapbox: add HTTP referrer restrictions for your domains.\nStripe / Clerk: publishable keys only work for your account; keep the matching sk_ key on the server.\nSentry: enable allowed domains for the DSN.")],
  },
  {
    match: "secrets.supabase-public",
    impact: "The anon key is public by design, so Row-Level Security is the only thing between the internet and your tables.",
    snippets: () => [snippet("generic", "Supabase · SQL", "sql", `alter table public.profiles enable row level security;\n\ncreate policy "own rows" on public.profiles\n  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`)],
  },
  {
    match: "secrets.firebase-public",
    impact: "Firebase config is public by design, so Security Rules are the only protection. Test-mode rules leave the whole database open.",
    snippets: () => [snippet("generic", "firestore.rules", "text", `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /users/{uid} {\n      allow read, write: if request.auth != null && request.auth.uid == uid;\n    }\n  }\n}`)],
  },
  {
    match: "build.android-debuggable",
    impact: "Anyone can attach a debugger, read memory, change values (coins, health, unlocks) and bypass license and purchase checks. Google Play also rejects the build.",
    snippets: debuggableSnippets,
  },
  {
    match: "build.android-cleartext",
    impact: "Traffic over plain HTTP can be read or changed by anyone on the same network, including tokens and game state.",
    snippets: cleartextSnippets,
  },
  {
    match: "build.android-backup",
    impact: "App data, including tokens and saves, can be copied off a device with a single adb command.",
    snippets: backupSnippets,
  },
  {
    match: "build.android-permissions",
    impact: "Each extra permission is more access for malware that hijacks the app, and Google Play restricts the riskiest ones.",
    snippets: permissionSnippets,
  },
  {
    match: /^build\.(?:signing-keys|credentials-file|env-file|google-services)$/,
    impact: "Whoever unpacks the build gets the keys: they can publish updates as you, access your cloud accounts or read your backend.",
    snippets: secretSnippets,
  },
  {
    match: /^build\.(?:cleartext-endpoints|internal-endpoints|api-endpoints|hardcoded-tokens|debug-flags)$/,
    impact: "Everything inside a build is readable. Hard-coded endpoints and tokens let anyone call your backend directly, skipping the app and its checks.",
    snippets: () => [
      snippet(
        "android",
        "Per-environment config · build.gradle.kts",
        "kotlin",
        `android {
  buildTypes {
    release { buildConfigField("String", "API_BASE", "\\"https://api.your-domain.com\\"") }
    debug   { buildConfigField("String", "API_BASE", "\\"https://staging.your-domain.com\\"") }
  }
}`,
      ),
    ],
  },
];

const DEFAULT_IMPACT = {
  critical: "This is exploitable today and can lead to data theft or account takeover. Fix it before launch.",
  warning: "Attackers use gaps like this to make other attacks easier. Fix it soon.",
  info: "Not dangerous by itself, but closing it reduces your attack surface.",
} as const;

function safeOrigin(site: string): string {
  try {
    return new URL(site).origin;
  } catch {
    return "https://your-domain.com";
  }
}

function lookup(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => (typeof entry.match === "string" ? entry.match === id : entry.match.test(id)));
}

/** Adds an impact explanation and stack snippets to one finding. Passed findings are returned unchanged. */
/** Puts the snippets for the detected stacks first (in detection order) and marks them recommended. */
export function orderSnippets(snippets: FixSnippet[], preferred: readonly Stack[]): FixSnippet[] {
  if (preferred.length === 0) return snippets;
  const rank = (stack: Stack) => {
    const index = preferred.indexOf(stack);
    return index === -1 ? preferred.length : index;
  };
  return snippets
    .map((snippet, index) => ({ snippet, index }))
    .sort((a, b) => rank(a.snippet.stack) - rank(b.snippet.stack) || a.index - b.index)
    .map(({ snippet }) => (preferred.includes(snippet.stack) ? { ...snippet, recommended: true } : snippet));
}

export function enrichFinding(item: Finding, site: string, preferred: readonly Stack[] = []): Finding {
  if (item.severity === "passed") return item;
  const entry = lookup(item.id);
  const impact = entry?.impact ?? DEFAULT_IMPACT[item.severity];
  const snippets = entry?.snippets ? orderSnippets(entry.snippets(site), preferred) : undefined;
  return { ...item, impact, ...(snippets && snippets.length > 0 ? { snippets } : {}) };
}

export function enrichFindings(findings: Finding[], site: string, preferred: readonly Stack[] = []): Finding[] {
  return findings.map((item) => enrichFinding(item, site, preferred));
}
