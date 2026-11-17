# ShipSafe

**Pre-launch security & config audit for builders and vibe-coders.**

### 👉 [Try it live in 15 seconds — no signup required](https://shipsafe-six-iota.vercel.app)

`https://shipsafe-six-iota.vercel.app` · click **Load Demo Report** to see a full report instantly.

Shipping fast with Cursor, Claude, Lovable or by hand makes it easy to leave a key in a JS bundle, a `.env` file on the server, or security headers missing. Paste your URL and ShipSafe runs a **strictly passive** audit (standard GET/HEAD requests only) and gives you a score, a grade, and a ready-to-paste AI fix prompt for every issue.

![ShipSafe Open Graph card](https://shipsafe-six-iota.vercel.app/opengraph-image)

---

## What it checks

| Area | Checks |
| --- | --- |
| **Transport & TLS** | HTTPS availability, certificate validity/expiry/protocol, HTTP → HTTPS redirect, **HSTS** |
| **Security headers** | **CSP** (missing, report-only, `unsafe-inline` / `unsafe-eval` / wildcards), `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| **Public exposure** | Exposed **`/.env`** and **`/.git/HEAD`** (status + file type only — contents are never shown), **`/.well-known/security.txt`**, `robots.txt`, `sitemap.xml`, `Server` / `X-Powered-By` version leaks |
| **Frontend integrity** | Public **source maps (`*.js.map`)** and inline `data:` maps, **mixed content** (`http://` assets on `https://` pages), third-party scripts without **SRI** |
| **CORS & cookies** | Wildcard or reflected origins with credentials, `null` origin, `Secure` / `HttpOnly` / `SameSite` on every cookie |
| **Client-bundle secrets** | HTML + same-origin JS scanned for Stripe, AWS, OpenAI, Anthropic, GitHub, Slack, SendGrid, Google OAuth, PEM private keys and Supabase `service_role` / `sb_secret_` keys (always masked, e.g. `sk_live_****1234`). Supabase / Firebase public configs get an RLS / Security Rules reminder |

## Features

- **Copy Fix Prompt** — every finding has a tailored prompt you paste into Cursor, Claude Code or Copilot to fix that exact issue in your stack.
- **Re-scan Diff** — fix things, hit **Re-scan**, and see `62 (D) → 94 (A) · +32 pts · 4 issues fixed`. History stays in your browser (`localStorage`, last 20 sites) — no database, no account.
- **Score & grade** — 0–100, A–F. Any critical finding caps the grade at D.
- **Share your score** — Copy Share Text / Post on X, with an "Upgraded my site from 62 to 94" variant after a re-scan.
- **Markdown export** of the full report.
- **Safe by design** — passive checks only, hard time and size limits, and two-layer SSRF protection (below).
- **Well tested** — 269 Vitest unit tests covering SSRF guards, scoring, every check, secret masking, payments and the Telegram bot.

## Safety model

ShipSafe only inspects passively, so it is safe to point at production:

- **Standard GET/HEAD only** — no payloads, fuzzing, logins or form submissions.
- **Two-layer SSRF protection** (`src/lib/scanner/ssrf.ts`):
  1. **URL validation** on the input *and on every redirect hop*: only `http:`/`https:`, ports 80/443/8080/8443, no credentials in URLs, no `localhost` / `*.local` / `*.internal` / cloud-metadata hosts, and no private or reserved IP literals (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, CGNAT, multicast, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6, decimal/hex/octal forms …).
  2. **Socket-level `safeLookup`** — a custom DNS `lookup` hook on every outbound socket validates the address that is *actually connected to*, which defeats DNS rebinding. If any resolved address is private, the connection is refused.
- **Hard limits:** 4 s per request (including redirects), 12 s per scan, 2 MB page cap, 1 MB per script, 4 KB for exposure / source-map / `security.txt` probes.
- **No secret handling:** matches are masked before they leave the scanner; file contents are never returned, logged or stored.
- **Rate limiting:** 10 scans per IP per minute (`429` + `Retry-After`).

## Quick start

Requires **Node.js 20.9+** (production runs on Node 22).

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 269 Vitest unit tests
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck` (`tsc --noEmit`, strict), `npm run lint`.

### Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Yaryarkin/shipsafe)

Or from the CLI: `npx vercel --prod`. The scanner runs on the Node.js runtime (`maxDuration = 20`).

### Environment variables (all optional)

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public URL used for metadata, sitemap and share text |
| `NEXT_PUBLIC_PRO_CHECKOUT_URL` | Stripe Payment Link / Gumroad URL; replaces the crypto order form with a checkout button |
| `NEXT_PUBLIC_DOCS_URL` | Target of the "GitHub / Docs" link in the top bar |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Bot used for Telegram Stars payments (default `shipsafe_orders_bot`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Server-only. Order notifications + the bot's payment flow |
| `TELEGRAM_WEBHOOK_SECRET` | Server-only, recommended. Verified against Telegram's `X-Telegram-Bot-Api-Secret-Token` header |

Never prefix server secrets with `NEXT_PUBLIC_`.

## Need a human audit?

The free scan sees what the public sees. For a look inside your code and database rules, order a review on the [live site](https://shipsafe-six-iota.vercel.app) (**Pro Audit** button) or directly in Telegram via **[@shipsafe_orders_bot](https://t.me/shipsafe_orders_bot)**:

| | Quick Config & Fix Review | Full Repo & RLS Audit |
| --- | --- | --- |
| **Price** | **$10** or 500 ⭐ | **$49** or 3,500 ⭐ |
| **Delivered** | within a few hours | within 24 hours |
| **Includes** | Expert review of your scan, ready-to-paste headers / CSP / CORS for your stack, Supabase RLS / Firebase rules checklist | Manual review of your codebase and every API route, RLS / Security Rules check, secret hygiene (env, bundles, git history), prioritized fixes |

Pay with USDT/USDC on Solana or Tron, or with Telegram Stars (card / Apple Pay) right inside the bot — `/start` opens the payment menu.

---

## API

### `POST /api/scan`

```json
{ "url": "https://your-app.com" }
```

Returns `{ target, finalUrl, scannedAt, overallScore, grade, scanDurationMs, summary, findings[] }` (validated with zod). Each finding has `id`, `category`, `severity` (`critical | warning | info | passed`), `title`, `description`, `evidence` and `fixPrompt`.

Errors are always `{ "error": { "code", "message" } }`: `400` invalid input / blocked target, `422` DNS failure / unreachable, `429` rate limited, `504` timeout, `500` internal.

### `POST /api/waitlist`

Order and inquiry intake from the Pro modal: `{ email, scannedUrl?, txHash?, tier?: "quick" | "full" }` → `{ ok, delivered, orderId: "SS-XXXXXX" }`. Zod-validated, 5 requests/IP/min, honeypot field. Every order is logged before the Telegram notification is attempted (with retry), so none are lost.

### `POST /api/telegram/webhook`

Telegram bot webhook: `/start` payment menu (inline buttons), `/start pay_quick | pay_full` → Stars (`XTR`) invoice, `pre_checkout_query` validation (currency + exact amount), `successful_payment` → order ID + buyer confirmation + owner alert, `/status` (owner only), buyer messages forwarded to the owner (rate limited).

## Project structure

```
src/
├── app/
│   ├── api/scan/route.ts              # Scanner API
│   ├── api/waitlist/route.ts          # Orders & inquiries
│   ├── api/telegram/webhook/route.ts  # Telegram bot (Stars payments, alerts)
│   ├── opengraph-image.tsx, twitter-image.tsx, robots.ts, sitemap.ts
│   └── layout.tsx, page.tsx, globals.css
├── components/                        # ShipSafeApp, ScoreCard, FindingCard, ProAuditModal, …
└── lib/
    ├── scanner/                       # engine, SSRF-safe http client, checks/, scoring, types
    ├── scan-history.ts                # Re-scan Diff (localStorage)
    ├── payments.ts, waitlist.ts, receipt.ts, order-id.ts, order-notifications.ts
    ├── telegram.ts, telegram-webhook.ts
    └── share.ts, markdown.ts, rate-limit.ts, …
```

Tests live next to the code in `__tests__/` folders.

ShipSafe ships the headers it audits for (CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) and disables `X-Powered-By`.

## Disclaimer

Only scan domains you own or have permission to check. ShipSafe is a passive configuration check. It does not replace a professional penetration test or code review.
