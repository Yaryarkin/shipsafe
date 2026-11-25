# ShipSafe

**15-second passive pre-launch security & config scanner for websites, APIs, and `.apk` / `.zip` game & app builds — with one-click AI fix prompts.**

### 👉 [Try it live in 15 seconds — no signup required](https://shipsafe-six-iota.vercel.app)

`https://shipsafe-six-iota.vercel.app` · no site handy? Click **Load Demo Report** to explore a full report instantly.

Shipping fast with Cursor, Claude, Lovable, Unity or Godot makes it easy to leave a key in a JS bundle, a `.env` on the server, a debuggable flag in your APK, or source maps in your game build. ShipSafe finds these in seconds and gives you a ready-to-paste AI prompt to fix each one.

![ShipSafe score card](https://shipsafe-six-iota.vercel.app/api/og?score=94&grade=A&prev=62)

---

## Two ways to scan

### 1. Website & API Security Scan

Paste a URL. ShipSafe runs **strictly passive** checks (standard GET/HEAD only — no payloads, fuzzing or logins):

| Area | Checks |
| --- | --- |
| **Transport & TLS** | HTTPS availability, certificate validity / expiry / protocol, HTTP → HTTPS redirect, **HSTS** (max-age, `includeSubDomains`, **preload readiness**) |
| **Security headers** | **CSP** (missing, report-only, `unsafe-inline` / `unsafe-eval` / wildcards), `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (incl. wildcard grants), **CSP hardening** (`object-src`, `base-uri`, wildcard / `http:` sources), `Cross-Origin-Opener-Policy` |
| **Public exposure** | Exposed **`/.env`** and **`/.git/HEAD`** (status + file type only — contents are never shown), **`/.well-known/security.txt`**, `robots.txt`, `sitemap.xml`, `Server` / `X-Powered-By` version leaks, **leftover files** (`.env.local` / `.env.production`, `/.git/config`, `.DS_Store`, `.htpasswd`, backup archives and SQL dumps — confirmed by file signature, so SPA fallbacks never false-positive), sensitive paths listed in `sitemap.xml` |
| **Frontend integrity** | Public **source maps** (`*.js.map`, inline `data:` maps), **mixed content**, third-party scripts without **SRI** |
| **CORS & cookies** | Wildcard / reflected origins with credentials, `null` origin, `Secure` / `HttpOnly` / `SameSite` on every cookie |
| **Client-bundle secrets** | Stripe, AWS, OpenAI, Anthropic, GitHub, Slack, SendGrid, Google OAuth, PEM private keys, Supabase `service_role` / `sb_secret_`, **Telegram bot tokens, database URLs with passwords, Firebase / FCM server keys, Google service-account keys, npm, Mailgun, Twilio, DigitalOcean, Mapbox, Discord, AWS secret keys** — always masked (`sk_live_****1234`). Supabase / Firebase public configs get an RLS / Security Rules reminder |

### 2. Client-Side App & Game Build Scan (`.apk` / `.zip`)

Drop an **Android APK** or a **WebGL / HTML5 / Electron / Unity / Godot** build. The archive is unpacked **locally in your browser** with JSZip — **0% server upload**, nothing leaves your device, results in ~0.5–2 s.

| Check | Severity |
| --- | --- |
| `android:debuggable="true"` in `AndroidManifest.xml` — parsed from the **compiled binary XML (AXML)** with typed values and resource IDs, so no false positives | critical |
| Signing keystores bundled in the build (`*.jks`, `*.keystore`, `*.p12`, …) | critical |
| `.env` files and server credentials (service-account keys, OAuth `client_secret`) inside the archive | critical |
| Insecure Electron `webPreferences` (`nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false`) | critical |
| Hard-coded API keys in packaged JS / JSON / XML / `.properties` (same detector as the web scan) | critical |
| `android:usesCleartextTraffic="true"` | warning |
| Source maps (`*.js.map`) shipped in the production build | warning |
| **Risky Android permissions** (SMS, call log, accessibility, install packages, all-files, overlay …) · hard-coded **cleartext `http://`**, local / staging and API endpoints · **high-entropy tokens** (hex / base64) assigned to `apiKey` / `secret` / `token` names · **debug flags** in config files | warning / info |
| `android:allowBackup` enabled (or left at its default) · public `google-services.json` → verify Firebase rules | info |

Limits keep the tab fast: archives up to **150 MB**, only text/config files are read (max **80 files**, **1 MB** each), media and binaries are never decompressed.

---

## Features

- **One-Click AI Fix Prompts** — every finding has a tailored prompt to paste into **Cursor, Claude Code or Copilot** (e.g. how to turn off `debuggable` in `build.gradle`, drop `.map` files from Vite / Unity WebGL, or move a key behind your backend).
- **One-click demo targets and one-file fixes** — three offline demo reports (an exposed vibe-coded app, a leaky API, a hardened A site) open the full report in one click. For the detected stack, **Fix it all in one file** generates a single `next.config.ts`, `vercel.json` or `nginx.conf` that resolves every open header and policy finding. Public client keys (Stripe `pk_`, Mapbox, Sentry DSN, Google API keys) are reported as an expected note, never as a leak; `sk_`, `service_role` and `.env` dumps stay critical.
- **Pre-launch gate, fix queue and stack-aware fixes** — every report opens with one verdict (Ready to ship, Needs attention, Blocked by critical) and the reasons behind it, an ordered queue of what to patch now, next and later (with effort), and the detected stack (Next.js, Vercel, Nginx, Express, Android, Unity, Godot, Electron, static builds and more) so that stack's copy-paste fixes come first. The design is a solid, flat, monochrome engineering interface: no blur, gradients or glow.
- **Adapts to the device** — mobile (< 768px) gets a bottom tab bar and one column with 44px+ targets, tablet (768–1024px) a balanced 2-column layout (sidebar in landscape, side-by-side summary in portrait), desktop (> 1024px) a multi-panel workspace with a sticky filter rail and code fixes beside the evidence. Layout is pure CSS; a hydration-safe `useDeviceType` hook only drives behavior (autofocus on desktop, tap-first wording on touch).
- **Four views, one state** — `/` Scanner, `/report` Report & fixes, `/history` History & badges, `/order` Bot & orders. The scan result survives navigation, links keep `utm_*`, share-card and Telegram parameters, and `/order?tier=quick` preselects an audit. A finished scan opens the report automatically.
- **Stack-aware fixes** — every issue explains its business impact and ships copy-paste snippets for **Next.js, Vercel, Nginx, Express** (and Android for builds), plus a **score breakdown** showing exactly where every point went.
- **Re-scan Diff (no database)** — fix things, hit **Re-scan**, and see `62 (D) → 94 (A) · +32 pts · 4 issues fixed`. History lives in your browser's `localStorage` (last 20 sites).
- **Dynamic Score OG Cards** — shared result links (`/?s=94&g=A&p=62`) show your real score in X / Discord / Telegram previews, rendered by `/api/og`.
- **Embeddable README SVG Badges** — `/api/badge?grade=A&score=94` gives you a shields-style badge for your repo or itch.io page. Pick `style=flat|flat-square` and `variant=full|grade|score`, then copy it as **Markdown, HTML, reStructuredText or a plain image URL**.
- **Share your score** — Copy Share Text / Post on X ("Upgraded my site from 62 to 94/100 …").
- **Owner / Developer view** — flip the report between plain-language business impact (with a one-click brief to forward to your developer) and the technical view with evidence, stack snippets and the AI prompt. Your choice is remembered.
- **Markdown export & print / PDF** — summary metrics, severity breakdown, priority checklist and remediation steps, for owners, developers or both; **Print / PDF** opens a clean light document with no decoration.
- **Verify your fixes** — history keeps a score trend per site; re-scan and see which issues are fixed, improved, still open or new.
- **Prefilled links** — `/?url=my-app.com&scan=1` opens the scanner with the site filled in (and starts the scan with `scan=1`); `mode=build` opens the build drop zone. Other parameters (share cards, `utm_*`, Telegram `start`) are left untouched.
- **Score & grade** — 0–100, A–F; any critical finding caps the grade at D.

```markdown
[![ShipSafe Security Check](https://shipsafe-six-iota.vercel.app/api/badge?grade=A&score=94)](https://shipsafe-six-iota.vercel.app)
```

[![ShipSafe Security Check](https://shipsafe-six-iota.vercel.app/api/badge?grade=A&score=94)](https://shipsafe-six-iota.vercel.app)

## Safety model

- **Passive by design** — website scans use standard GET/HEAD requests only; build scans never leave the browser.
- **Two-layer SSRF protection** (`src/lib/scanner/ssrf.ts`):
  1. **URL validation** on the input *and every redirect hop*: only `http:` / `https:`, ports 80 / 443 / 8080 / 8443, no credentials, no `localhost` / `*.local` / `*.internal` / cloud-metadata hosts, no private or reserved IPs (incl. decimal / hex / octal and IPv4-mapped IPv6 forms).
  2. **Socket-level `safeLookup`** — a DNS hook on every outbound socket validates the address actually connected to, defeating DNS rebinding.
- **Hard limits** — 4 s per request, 12 s per scan, 2 MB page cap, 1 MB per script; 10 scans / IP / minute (`429` + `Retry-After`).
- **No secret handling** — matches are masked before leaving the scanner; file contents are never returned, logged or stored.
- **Untrusted input never reaches images** — `/api/og` and `/api/badge` accept only a validated grade (`A–F`) and integer score (`0–100`); the badge SVG contains no user text at all.

## Need a human audit?

The free scan sees what the public sees. For a look inside your code, database rules and builds, order on the [live site](https://shipsafe-six-iota.vercel.app) (**Pro Audit** button) or directly in Telegram via **[@shipsafe_orders_bot](https://t.me/shipsafe_orders_bot)** — `/start` opens the payment menu.

| | Quick Review | Code & Config Fix Pack | Full Repo & Game Audit |
| --- | --- | --- | --- |
| **Price** | **$10** or 500 ⭐ | **$20** or 1,200 ⭐ | **$49** or 3,500 ⭐ |
| **Delivered** | within a few hours | within 12 hours | within 24 hours |
| **Includes** | Expert review of your scan, ready-to-paste headers / CSP / CORS, RLS / Firebase rules checklist | Everything in Quick Review + the actual fixes written for your stack (headers, CSP, CORS, cookies, RLS policies / Security Rules) | Manual review of your codebase, API routes, RLS / Security Rules, APK / WebGL / Electron builds, backend & anti-cheat endpoints, secret hygiene, prioritized fixes |

**Pay with** USDT / USDC on **Solana**, USDT on **Tron (TRC-20)**, or **Telegram Stars** (card / Apple Pay) right inside the bot.

---

## GitHub Action — fail the build on a leak

Add ShipSafe to CI so a leaked key or an exposed `.env` never reaches your users unnoticed. The action scans your deployed site and fails the job on critical issues. It writes a summary to the job page, annotates each finding, and exposes `score`, `grade`, `critical`, `warnings` and `passed` as outputs.

```yaml
- uses: Yaryarkin/shipsafe@main
  with:
    url: https://your-app.com
    fail-on: critical   # critical (default) | warning | none
    min-score: "80"     # optional: also fail below this score
```

A ready-made workflow (scan after each deployment, plus a daily run) lives in [`examples/shipsafe-check.yml`](examples/shipsafe-check.yml).

- **Privacy:** only the URL you pass is sent to the ShipSafe API; the scan is passive (GET / HEAD requests). Inputs go through environment variables, never into a shell script. Scan only sites you own.
- **Reliable on shared runners:** a rate-limited (`429`) or failed call is retried, and a scan that can't run fails the job instead of silently passing.
- **Self-hosted:** set `api-url` to your own deployment of this repository.
- **Pinning:** for stricter supply-chain hygiene, reference a commit SHA instead of `@main`.

---

## Quick start

Requires **Node.js 20.9+** (production runs on Node 22).

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 613 Vitest unit tests
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck` (`tsc --noEmit`, strict + `noUncheckedIndexedAccess`), `npm run lint`.

### Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Yaryarkin/shipsafe)

Or `npx vercel --prod`. API routes run on the Node.js runtime.

### Environment variables (all optional)

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public URL for metadata, share links, OG cards and badges |
| `NEXT_PUBLIC_PRO_CHECKOUT_URL` | Stripe Payment Link / Gumroad URL; replaces the crypto order form |
| `NEXT_PUBLIC_DOCS_URL` | Target of the "GitHub / Docs" link |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Bot for Telegram Stars payments (default `shipsafe_orders_bot`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Server-only. Order notifications and the bot's payment flow |
| `TELEGRAM_WEBHOOK_SECRET` | Server-only, recommended. Checked against Telegram's `X-Telegram-Bot-Api-Secret-Token` header |

Never prefix server secrets with `NEXT_PUBLIC_`.

## API

| Endpoint | Description |
| --- | --- |
| `POST /api/scan` | `{ "url": "https://your-app.com" }` → `{ target, finalUrl, scannedAt, overallScore, grade, scanDurationMs, summary, findings[] }` (zod-validated). Errors: `{ error: { code, message } }` with `400` / `422` / `429` / `504` / `500` |
| `GET /api/og` | `?score=0..100&grade=A..F[&prev=0..100][&target=…]` → 1200×630 PNG score card (falls back to the default card) |
| `GET /api/badge` | `?grade=A..F&score=0..100` → SVG badge (`image/svg+xml`, cached 1 h); invalid params → neutral "Check Security" badge |
| `POST /api/waitlist` | Orders & inquiries from the Pro modal: `{ email, scannedUrl?, txHash?, tier?: "quick" \| "fix" \| "full" }` → `{ ok, delivered, orderId: "SS-XXXXXX" }`; 5 req / IP / min; logged before the Telegram notification (with retry) |
| `POST /api/telegram/webhook` | Bot webhook: `/start` payment menu, Stars (`XTR`) invoices, `pre_checkout_query` validation (currency + exact amount), `successful_payment` → order ID + alerts, `/status` (owner only) |

## Project structure

```
action.yml                                             # GitHub Action (composite) — see "GitHub Action" above
action/check.mjs                                       # the action's scan + pass/fail logic (dependency-free)
examples/shipsafe-check.yml                            # copy-paste workflow
src/
├── app/
│   ├── api/scan, api/waitlist, api/telegram/webhook   # server routes
│   ├── api/og/route.tsx                               # dynamic score OG cards
│   ├── api/badge/route.ts                             # README SVG badges
│   ├── opengraph-image/, twitter-image/               # default social cards
│   └── page.tsx (generateMetadata for shared scores), layout.tsx, robots.ts, sitemap.ts
├── components/                                        # ShipSafeApp, ScannerForm (URL / build tabs), ScoreCard,
│                                                      # FindingCard (fix prompts + audit offers), ExportBar, ProAuditModal, …
└── lib/
    ├── scanner/
    │   ├── engine.ts, http.ts, ssrf.ts                # website scanner + SSRF-safe client
    │   ├── checks/                                    # transport, headers, exposure, cors-cookies, secrets, frontend
    │   ├── checks/secret-patterns.ts                  # browser-safe secret detection (shared by both scanners)
    │   ├── build-analyzer.ts                          # .apk / .zip build analysis (pure, DOM-free)
    │   └── axml.ts                                    # Android binary XML (AndroidManifest) parser
    ├── build-extract.ts                               # in-browser JSZip extraction with limits
    ├── og-params.ts, og-card.tsx, badge.ts, share.ts, site-metadata.ts
    ├── scan-history.ts, scan-target.ts, audit-offer.ts, markdown.ts
    └── payments.ts, waitlist.ts, receipt.ts, order-id.ts, order-notifications.ts, telegram.ts, telegram-webhook.ts
```

Tests live next to the code in `__tests__/` folders — **613 Vitest tests** covering SSRF guards, scoring, every web and build check (including a binary-manifest fixture encoder), secret masking, OG / badge parameter validation and XSS safety, share links, payments and the Telegram bot.

ShipSafe ships the headers it audits for (CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) and disables `X-Powered-By`.

## Disclaimer

Only scan domains and builds you own or have permission to check. ShipSafe is a passive configuration check. It does not replace a professional penetration test or code review.
