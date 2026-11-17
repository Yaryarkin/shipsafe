import { describe, expect, it } from "vitest";
import { analyzeSecrets, type SecretSource } from "../checks/secrets";
import type { Finding } from "../types";

/**
 * All dummy secrets are synthetic and assembled at runtime from fragments, so no real key (or
 * anything a secret scanner would flag) exists in this file.
 */
const SITE = "https://example.com";
const j = (...parts: string[]) => parts.join("");
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const fakeJwt = (payload: Record<string, unknown>) =>
  [b64url({ alg: "HS256", typ: "JWT" }), b64url(payload), "s".repeat(32)].join(".");

const DUMMY = {
  stripeLive: j("sk", "_live_", "A".repeat(24), "1234"),
  stripeTest: j("sk", "_test_", "B".repeat(24), "5678"),
  aws: j("AK", "IA", "ABCDEFGHIJKLMNOP"),
  anthropic: j("sk-", "ant-", "api03-", "c".repeat(60), "WXYZ"),
  openai: j("sk-", "proj-", "d".repeat(48), "QRST"),
  github: j("gh", "p_", "e".repeat(32), "LMNO"),
  privateKey: j("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
  serviceRole: fakeJwt({ iss: "supabase", role: "service_role", ref: "abcdefghijklmnopqrst" }),
  anon: fakeJwt({ iss: "supabase", role: "anon", ref: "abcdefghijklmnopqrst" }),
};

function scan(text: string, label = "/app.js"): Finding[] {
  const sources: SecretSource[] = [{ label, text }];
  return analyzeSecrets(SITE, sources);
}

function byId(findings: Finding[], id: string): Finding | undefined {
  return findings.find((item) => item.id === id);
}

describe("analyzeSecrets", () => {
  it.each([
    ["secrets.stripe-live", "critical", DUMMY.stripeLive],
    ["secrets.aws-access-key", "critical", DUMMY.aws],
    ["secrets.anthropic", "critical", DUMMY.anthropic],
    ["secrets.openai", "critical", DUMMY.openai],
    ["secrets.github-token", "critical", DUMMY.github],
    ["secrets.stripe-test", "warning", DUMMY.stripeTest],
    ["secrets.supabase-service-role", "critical", DUMMY.serviceRole],
  ] as const)("detects %s as %s", (id, severity, secret) => {
    const findings = scan(`const config = { key: "${secret}" };`);
    const hit = byId(findings, id);
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe(severity);
    expect(hit?.category).toBe("secrets");
    expect(hit?.evidence).toContain("****");
    expect(hit?.evidence).toContain("/app.js");
    expect(hit?.fixPrompt).toContain("Rotation first");
  });

  it("never includes a raw secret anywhere in the findings", () => {
    const secrets = [
      DUMMY.stripeLive,
      DUMMY.stripeTest,
      DUMMY.aws,
      DUMMY.anthropic,
      DUMMY.openai,
      DUMMY.github,
      DUMMY.serviceRole,
      DUMMY.anon,
    ];
    const serialized = JSON.stringify(scan(secrets.map((secret, index) => `var k${index}="${secret}";`).join("\n")));
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  });

  it("masks Stripe keys as prefix****last4", () => {
    const hit = byId(scan(`stripe(${JSON.stringify(DUMMY.stripeLive)})`), "secrets.stripe-live");
    expect(hit?.evidence.startsWith(j("sk", "_live_", "****1234"))).toBe(true);
  });

  it("reports PEM private key headers (the header only, no key material)", () => {
    const hit = byId(scan(`const pem = "${DUMMY.privateKey}\\nMIIE...";`), "secrets.private-key");
    expect(hit?.severity).toBe("critical");
    expect(hit?.evidence).toContain("PRIVATE KEY-----");
  });

  it("treats a Supabase anon key as an info-level RLS reminder, not a leak", () => {
    const findings = scan(`createClient("https://abcdefghijklmnopqrst.supabase.co", "${DUMMY.anon}")`);
    expect(byId(findings, "secrets.supabase-public")?.severity).toBe("info");
    expect(byId(findings, "secrets.supabase-service-role")).toBeUndefined();
    expect(byId(findings, "secrets.none")?.severity).toBe("passed");
  });

  it("flags Firebase config as an info-level Security Rules reminder", () => {
    const apiKey = j("AI", "za", "F".repeat(35));
    const findings = scan(`firebase.initializeApp({ apiKey: "${apiKey}", authDomain: "demo-app.firebaseapp.com" })`);
    const hit = byId(findings, "secrets.firebase-public");
    expect(hit?.severity).toBe("info");
    expect(hit?.evidence).not.toContain(apiKey);
  });

  it("returns a single passed finding for clean code", () => {
    const findings = scan("export function add(a, b) { return a + b; } // sk_live_ is mentioned in docs only");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("secrets.none");
    expect(findings[0]?.severity).toBe("passed");
  });

  it("does not flag look-alikes that are too short", () => {
    const findings = scan(`"${j("sk", "_live_", "short")}" "${j("AK", "IA", "123")}"`);
    expect(findings.map((item) => item.id)).toEqual(["secrets.none"]);
  });

  it("deduplicates the same secret across files", () => {
    const findings = analyzeSecrets(SITE, [
      { label: "/a.js", text: DUMMY.stripeLive },
      { label: "/b.js", text: DUMMY.stripeLive },
    ]);
    const hit = byId(findings, "secrets.stripe-live");
    expect(hit?.evidence.split("\n")).toHaveLength(1);
    expect(hit?.evidence).toContain("/a.js, /b.js");
  });
});
