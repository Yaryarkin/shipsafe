/**
 * Pure, environment-neutral secret detection (no Node `Buffer`, no cheerio), so it runs both in the
 * server scanner and in the browser (client-side APK / ZIP build analysis). Matches are masked
 * before they are stored, so raw secrets never reach a finding.
 */
import type { Finding, Severity } from "../types";
import { buildFixPrompt, finding, formatBytes, maskSecret } from "../utils";

export const MAX_SCRIPTS = 5;
const MAX_MATCHES_PER_PATTERN = 25;
const MAX_EVIDENCE_LINES = 5;

export interface SecretSource {
  label: string;
  text: string;
}

interface SecretPattern {
  id: string;
  name: string;
  severity: Exclude<Severity, "passed" | "info">;
  regex: RegExp;
  /** Keep the literal visible (e.g. PEM headers) instead of masking. */
  literal?: boolean;
  rotate: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "stripe-live",
    name: "Stripe live secret key",
    severity: "critical",
    regex: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,247}\b/g,
    rotate: "Roll the key in Stripe Dashboard → Developers → API keys, and review recent API logs for unknown activity.",
  },
  {
    id: "stripe-webhook",
    name: "Stripe webhook signing secret",
    severity: "critical",
    regex: /\bwhsec_[0-9A-Za-z]{32,}\b/g,
    rotate: "Roll the signing secret for that webhook endpoint in the Stripe Dashboard.",
  },
  {
    id: "aws-access-key",
    name: "AWS access key ID",
    severity: "critical",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    rotate: "Deactivate and delete the access key in IAM, create a new one stored only server-side, and check CloudTrail for misuse.",
  },
  {
    id: "anthropic",
    name: "Anthropic API key",
    severity: "critical",
    regex: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}/g,
    rotate: "Revoke the key in the Anthropic Console and create a new one used only from your server.",
  },
  {
    id: "openai",
    name: "OpenAI API key",
    severity: "critical",
    regex: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g,
    rotate: "Revoke the key at platform.openai.com → API keys, set a usage limit, and create a new server-only key.",
  },
  {
    id: "private-key",
    name: "Private key block",
    severity: "critical",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    literal: true,
    rotate: "Generate a new key pair, replace it wherever the old public key/certificate is trusted, and revoke the old one.",
  },
  {
    id: "github-token",
    name: "GitHub token",
    severity: "critical",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/g,
    rotate: "Revoke the token in GitHub → Settings → Developer settings and audit the security log.",
  },
  {
    id: "slack-token",
    name: "Slack token",
    severity: "critical",
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
    rotate: "Revoke the token in your Slack app settings and reinstall the app to issue a new one.",
  },
  {
    id: "sendgrid",
    name: "SendGrid API key",
    severity: "critical",
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    rotate: "Delete the key in SendGrid → Settings → API Keys and create a new restricted key.",
  },
  {
    id: "google-oauth-secret",
    name: "Google OAuth client secret",
    severity: "critical",
    regex: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g,
    rotate: "Reset the client secret in Google Cloud Console → APIs & Services → Credentials.",
  },
  {
    id: "supabase-secret",
    name: "Supabase secret key",
    severity: "critical",
    regex: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
    rotate: "Delete the secret key in Supabase → Project Settings → API Keys and create a new one used only server-side.",
  },
  {
    id: "stripe-test",
    name: "Stripe test secret key",
    severity: "warning",
    regex: /\b(?:sk|rk)_test_[0-9A-Za-z]{20,247}\b/g,
    rotate: "Roll the test key in the Stripe Dashboard and make sure the live key is never handled the same way.",
  },
];

const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SUPABASE_URL_REGEX = /https:\/\/[a-z0-9]{20}\.supabase\.co/g;
const SUPABASE_PUBLISHABLE_REGEX = /\bsb_publishable_[A-Za-z0-9_-]{20,}/g;
const FIREBASE_REGEX = /\b[a-z0-9-]+\.firebaseapp\.com\b|\b[a-z0-9-]+\.firebaseio\.com\b|\b[a-z0-9-]+-default-rtdb\.[a-z0-9-]+\.firebasedatabase\.app\b/g;
const GOOGLE_API_KEY_REGEX = /\bAIza[0-9A-Za-z_-]{35}\b/g;

const SERVICE_ROLE_PATTERN: SecretPattern = {
  id: "supabase-service-role",
  name: "Supabase service_role key",
  severity: "critical",
  regex: JWT_REGEX,
  rotate:
    "Rotate the JWT secret / service_role key in Supabase → Project Settings → API immediately. The service_role key bypasses Row-Level Security, so anyone with it has full read/write access to your database.",
};

function* limitedMatches(text: string, regex: RegExp): Generator<string> {
  let count = 0;
  for (const match of text.matchAll(regex)) {
    yield match[0];
    count += 1;
    if (count >= MAX_MATCHES_PER_PATTERN) return;
  }
}


/** base64url → UTF-8 without Node's Buffer (atob exists in browsers and Node 16+). */
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

type Hits = Map<string, Map<string, Set<string>>>; // patternId -> masked value -> source labels

function record(hits: Hits, patternId: string, masked: string, label: string): void {
  let byValue = hits.get(patternId);
  if (!byValue) {
    byValue = new Map();
    hits.set(patternId, byValue);
  }
  let labels = byValue.get(masked);
  if (!labels) {
    labels = new Set();
    byValue.set(masked, labels);
  }
  labels.add(label);
}

function addHint(target: Map<string, Set<string>>, value: string, label: string): void {
  const labels = target.get(value) ?? new Set<string>();
  labels.add(label);
  target.set(value, labels);
}

function evidenceFor(byValue: Map<string, Set<string>>): string {
  const lines = [...byValue.entries()].map(([masked, labels]) => `${masked}  in ${[...labels].slice(0, 3).join(", ")}`);
  const extra = lines.length > MAX_EVIDENCE_LINES ? `\n+${lines.length - MAX_EVIDENCE_LINES} more` : "";
  return lines.slice(0, MAX_EVIDENCE_LINES).join("\n") + extra;
}

/**
 * Pure secret analysis over already-fetched text. Matched secrets are masked before they are
 * stored anywhere, so raw values never reach a finding.
 */
export function analyzeSecrets(
  site: string,
  sources: SecretSource[],
  meta: { failedScripts?: number; scriptLimitReached?: boolean } = {},
): Finding[] {
  const secretHits: Hits = new Map();
  const supabaseHints = new Map<string, Set<string>>();
  const firebaseHints = new Map<string, Set<string>>();

  for (const source of sources) {
    for (const pattern of SECRET_PATTERNS) {
      for (const match of limitedMatches(source.text, pattern.regex)) {
        record(secretHits, pattern.id, pattern.literal ? match : maskSecret(match), source.label);
      }
    }

    for (const token of limitedMatches(source.text, JWT_REGEX)) {
      const payload = decodeJwtPayload(token);
      if (!payload) continue;
      const role = typeof payload.role === "string" ? payload.role : null;
      const issuer = typeof payload.iss === "string" ? payload.iss : "";
      if (role === "service_role") {
        record(secretHits, SERVICE_ROLE_PATTERN.id, maskSecret(token), source.label);
      } else if (role === "anon" || issuer.includes("supabase")) {
        addHint(supabaseHints, `anon key ${maskSecret(token)}`, source.label);
      }
    }
    for (const match of limitedMatches(source.text, SUPABASE_URL_REGEX)) addHint(supabaseHints, match, source.label);
    for (const match of limitedMatches(source.text, SUPABASE_PUBLISHABLE_REGEX)) {
      addHint(supabaseHints, `publishable key ${maskSecret(match)}`, source.label);
    }
    for (const match of limitedMatches(source.text, FIREBASE_REGEX)) addHint(firebaseHints, match, source.label);
    if (/firebase/i.test(source.text)) {
      for (const match of limitedMatches(source.text, GOOGLE_API_KEY_REGEX)) {
        addHint(firebaseHints, `apiKey ${maskSecret(match)}`, source.label);
      }
    }
  }

  const findings: Finding[] = [];
  for (const pattern of [...SECRET_PATTERNS, SERVICE_ROLE_PATTERN]) {
    const byValue = secretHits.get(pattern.id);
    if (!byValue || byValue.size === 0) continue;
    const isCritical = pattern.severity === "critical";
    const locations = [...new Set([...byValue.values()].flatMap((labels) => [...labels]))].slice(0, 3).join(", ");
    findings.push(
      finding({
        id: `secrets.${pattern.id}`,
        category: "secrets",
        severity: pattern.severity,
        title: `${pattern.name} exposed in client code`,
        description: isCritical
          ? `A ${pattern.name} is shipped to every visitor's browser. Anyone can open DevTools, copy it and use it to run up your bill, read your data or impersonate your app. Rotate it now — removing it from the code is not enough, because it is already public.`
          : `A ${pattern.name} is shipped to the browser. Test keys can't move real money, but they expose your test data and suggest live keys may be handled the same way.`,
        evidence: evidenceFor(byValue),
        fixPrompt: buildFixPrompt({
          site,
          issue: `A ${pattern.name} is exposed in my client-side JavaScript/HTML (found in ${locations}).`,
          goal: "The secret must only exist on the server, and the leaked one must be revoked.",
          steps: [
            `Rotation first: ${pattern.rotate}`,
            "Search the codebase for where this key is read. In Next.js, any env var prefixed NEXT_PUBLIC_ (Vite: VITE_, CRA: REACT_APP_, Expo: EXPO_PUBLIC_) is inlined into the browser bundle — rename it without the public prefix.",
            "Move every call that needs the secret into a server-only API route / server action / edge function, and have the frontend call that route instead.",
            "Add a guard (e.g. `import 'server-only'` in Next.js) to the module that reads the secret so it can never be bundled for the client again.",
            "Redeploy, then search the built client bundle (e.g. `grep -r \"<key prefix>\" .next/static`) to confirm the key is gone.",
          ],
          verify: "Re-run the ShipSafe scan and confirm this finding is gone; check the provider dashboard shows the old key as revoked.",
        }),
      }),
    );
  }

  if (supabaseHints.size > 0) {
    findings.push(
      finding({
        id: "secrets.supabase-public",
        category: "secrets",
        severity: "info",
        title: "Supabase client config detected — verify Row-Level Security",
        description:
          "The Supabase URL and anon/publishable key are meant to be public. That's safe ONLY if Row-Level Security is enabled with correct policies on every table; otherwise anyone can read or modify your data using these values.",
        evidence: evidenceFor(supabaseHints),
        fixPrompt: buildFixPrompt({
          site,
          issue: "My app uses Supabase from the browser with the public anon/publishable key. I need to verify that Row-Level Security protects all data.",
          goal: "Every table in exposed schemas has RLS enabled with least-privilege policies, and storage buckets are locked down.",
          steps: [
            "List every table in the `public` schema (and any other exposed schema) and show whether RLS is enabled; enable it on all of them.",
            "For each table, write explicit SELECT/INSERT/UPDATE/DELETE policies scoped to `auth.uid()` (or the correct tenant/org column). Remove any `using (true)` policies on private data.",
            "Review storage buckets: private buckets must have policies; public buckets must contain only public files.",
            "Check views and RPC functions — mark functions SECURITY INVOKER where possible and revoke EXECUTE from anon where not needed.",
            "Write a short test that uses the anon key (logged out) and a second user's session to prove they cannot read another user's rows.",
          ],
          verify: "Run the Supabase Security Advisor (Dashboard → Advisors) and confirm zero RLS warnings.",
        }),
      }),
    );
  }

  if (firebaseHints.size > 0) {
    findings.push(
      finding({
        id: "secrets.firebase-public",
        category: "secrets",
        severity: "info",
        title: "Firebase client config detected — verify Security Rules",
        description:
          "Firebase web config (apiKey, authDomain, projectId) is public by design. Your data is only protected by Firestore / Realtime Database / Storage Security Rules — test-mode rules (`allow read, write: if true`) leave everything open.",
        evidence: evidenceFor(firebaseHints),
        fixPrompt: buildFixPrompt({
          site,
          issue: "My app uses the Firebase client SDK. I need to verify that Security Rules protect all data.",
          goal: "Firestore, Realtime Database and Storage rules deny by default and only allow authenticated, owner-scoped access.",
          steps: [
            "Open firestore.rules, database.rules.json and storage.rules (create them if missing) and remove any `if true` or expired test-mode rules.",
            "Write rules that check `request.auth != null` and that `request.auth.uid` matches the document owner field; validate written fields.",
            "Restrict the browser API key in Google Cloud Console (HTTP referrer restrictions + only the needed APIs) and enable App Check.",
            "Add rules unit tests with the Firebase Emulator Suite proving a logged-out user and a different user cannot read/write others' data.",
          ],
          verify: "Deploy rules with `firebase deploy --only firestore:rules,storage` and run the emulator tests.",
        }),
      }),
    );
  }

  const hasSecretFinding = findings.some((item) => item.severity === "critical" || item.severity === "warning");
  if (!hasSecretFinding) {
    const totalBytes = sources.reduce((sum, source) => sum + byteLength(source.text), 0);
    const failed = meta.failedScripts ?? 0;
    findings.push(
      finding({
        id: "secrets.none",
        category: "secrets",
        severity: "passed",
        title: "No private keys found in client bundles",
        description:
          "The HTML and same-origin JavaScript bundles don't contain known secret-key formats (Stripe, AWS, OpenAI, Anthropic, GitHub, Supabase service_role, private keys).",
        evidence: `Scanned ${sources.length} file(s), ${formatBytes(totalBytes)}${failed ? ` · ${failed} script(s) could not be fetched` : ""}${meta.scriptLimitReached ? ` · limited to the first ${MAX_SCRIPTS} scripts` : ""}`,
      }),
    );
  }

  return findings;
}
