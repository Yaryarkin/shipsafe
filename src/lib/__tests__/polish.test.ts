import { describe, expect, it } from "vitest";
import { buildStackConfigs, configCoverage, HSTS_VALUE, STARTER_CSP } from "../config-generator";
import { createDemoReport } from "../demo-report";
import { createDemoTarget, DEMO_TARGETS, type DemoKind } from "../demo-targets";
import { buildFixQueue } from "../fix-queue";
import { reportToMarkdown } from "../markdown";
import { assessReadiness } from "../readiness";
import { analyzeSecrets, isPlaceholderSecret } from "../scanner/checks/secret-patterns";
import { scoreFindings } from "../scanner/scoring";
import { scanResultSchema, type Finding, type ScanResult } from "../scanner/types";
import { finding } from "../scanner/utils";

/** Dummy keys are assembled from fragments, so this file holds nothing a secret scanner would flag. */
const j = (...parts: string[]) => parts.join("");
const SITE = "https://example.com";
const scan = (text: string): Finding[] => analyzeSecrets(SITE, [{ label: "/app.js", text }]);
const ids = (findings: Finding[]) => findings.map((item) => item.id);

describe("demo targets", () => {
  const kinds: DemoKind[] = ["vibe", "api", "hardened"];

  it("offers three presets with distinct hosts, all valid reports", () => {
    expect(DEMO_TARGETS.map((target) => target.id)).toEqual(kinds);
    expect(new Set(DEMO_TARGETS.map((target) => target.host)).size).toBe(3);
    for (const kind of kinds) {
      const report = createDemoTarget(kind);
      expect(scanResultSchema.safeParse(report).success, kind).toBe(true);
      expect(report.target).toContain(DEMO_TARGETS.find((target) => target.id === kind)?.host ?? "never");
      expect(report.target).toMatch(/\.example\/$/);
      expect(report.detectedStack?.length).toBeGreaterThan(0);
      expect(report.scoreBreakdown?.total).toBe(report.overallScore);
    }
  });

  it("keeps the original sample as the exposed web app", () => {
    expect(createDemoTarget("vibe").target).toBe(createDemoReport().target);
    expect(createDemoTarget("vibe").summary.critical).toBe(1);
  });

  it("scores the three presets as bad, worse and good, with matching readiness verdicts", () => {
    const vibe = createDemoTarget("vibe");
    const api = createDemoTarget("api");
    const hardened = createDemoTarget("hardened");
    expect(hardened.grade).toBe("A");
    expect(vibe.grade).toBe("D");
    expect(api.grade).toBe("F");
    expect(assessReadiness(hardened).status).toBe("ready");
    expect(assessReadiness(vibe).status).toBe("blocked");
    expect(assessReadiness(api).status).toBe("blocked");
    expect(api.summary.critical).toBe(2);
  });

  it("detects a different stack for each preset and fills the fix queue", () => {
    expect(createDemoTarget("api").detectedStack?.map((item) => item.id)).toEqual(["express", "nginx"]);
    expect(createDemoTarget("hardened").detectedStack?.map((item) => item.id)).toEqual(["nextjs", "vercel"]);
    expect(buildFixQueue(createDemoTarget("api").findings)[0]?.id).toBe("secrets.supabase-service-role");
    expect(buildFixQueue(createDemoTarget("hardened").findings).every((entry) => entry.tier === "later")).toBe(true);
  });

  it("lists the detected stack's snippets first for the API preset", () => {
    const tech = createDemoTarget("api").findings.find((item) => item.id === "exposure.tech-disclosure");
    expect(tech?.snippets?.slice(0, 2).map((item) => item.stack)).toEqual(["express", "nginx"]);
  });
});

describe("unified stack config", () => {
  const vibe = createDemoTarget("vibe");

  it("generates next.config, vercel.json and nginx.conf, the detected stack first", () => {
    const configs = buildStackConfigs(vibe);
    expect(configs.map((config) => config.stack)).toEqual(["nextjs", "vercel", "nginx"]);
    expect(configs.map((config) => config.recommended)).toEqual([true, true, false]);
    expect(configs[0]?.filename).toBe("next.config.ts");
    const api = buildStackConfigs(createDemoTarget("api"));
    expect(api.map((config) => config.stack)).toEqual(["nginx", "nextjs", "vercel"]);
    expect(api[0]?.recommended).toBe(true);
  });

  it("only includes headers whose findings are open", () => {
    const vercel = buildStackConfigs(vibe).find((config) => config.stack === "vercel");
    const parsed = JSON.parse(vercel?.code ?? "{}") as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    const keys = parsed.headers[0]?.headers.map((header) => header.key) ?? [];
    // The demo has open CSP, HSTS and Permissions-Policy findings; framing, nosniff and referrer already pass.
    expect(keys).toEqual(["Content-Security-Policy", "Strict-Transport-Security", "Permissions-Policy"]);
    expect(parsed.headers[0]?.source).toBe("/(.*)");
  });

  it("covers exactly the open header and server findings and nothing else", () => {
    const configs = buildStackConfigs(vibe);
    const open = new Set(vibe.findings.filter((item) => item.severity !== "passed").map((item) => item.id));
    for (const id of configs[0]?.covers ?? []) expect(open.has(id)).toBe(true);
    expect(configs[0]?.covers).not.toContain("secrets.stripe-live");
    expect(configs[0]?.covers).not.toContain("cors.policy");
    expect(configCoverage(vibe)).toBe(configs[0]?.covers.length);
  });

  it("writes Next.js, Vercel and Nginx output that matches the open findings", () => {
    const [nginx, nextjs, vercel] = buildStackConfigs(createDemoTarget("api"));
    // The API preset detected nginx, so it comes first.
    expect(nginx?.stack).toBe("nginx");
    expect(nginx?.code).toContain('add_header Strict-Transport-Security "' + HSTS_VALUE + '" always;');
    expect(nginx?.code).toContain("server_tokens off;");
    expect(nginx?.code.trim().endsWith("}")).toBe(true);
    expect(nextjs?.stack).toBe("nextjs");
    expect(nextjs?.code).toContain("poweredByHeader: false,");
    expect(nextjs?.code).toContain('{ key: "X-Content-Type-Options", value: "nosniff" },');
    expect(nextjs?.code).toContain("async headers()");
    expect(nextjs?.code.trim().endsWith("export default nextConfig;")).toBe(true);
    expect(vercel?.stack).toBe("vercel");
    expect(() => JSON.parse(vercel?.code ?? "")).not.toThrow();

    const vibeNext = buildStackConfigs(vibe)[0];
    expect(vibeNext?.code).toContain('{ key: "Content-Security-Policy", value: "' + STARTER_CSP + '" },');
    expect(vibeNext?.code).not.toContain("productionBrowserSourceMaps");
  });

  it("adds the redirect block and source map rule only when those findings are open", () => {
    const open = (id: string, category: Finding["category"]) => finding({ id, category, severity: "warning", title: id, description: id });
    const result: ScanResult = { ...vibe, findings: [open("transport.http-redirect", "transport"), open("frontend.source-maps", "frontend"), open("headers.nosniff", "headers")] };
    const [first] = buildStackConfigs({ ...result, detectedStack: [{ id: "nginx", label: "Nginx", confidence: "high", signals: ["server: nginx"] }] });
    expect(first?.stack).toBe("nginx");
    expect(first?.code).toContain("return 301 https://$host$request_uri;");
    expect(first?.code).toContain("location ~* \\.map$ { return 404; }");
    const next = buildStackConfigs(result).find((config) => config.stack === "nextjs");
    expect(next?.code).toContain("productionBrowserSourceMaps: false,");
    expect(next?.notes.join(" ")).toContain("Redirect HTTP to HTTPS at your host");

    const plain = buildStackConfigs(vibe).find((config) => config.stack === "nginx");
    expect(plain?.code).not.toContain("return 301");
    expect(plain?.code).not.toContain(".map");
  });

  it("keeps notes honest: CSP is a starter, HSTS affects subdomains, Vercel cannot hide X-Powered-By", () => {
    const configs = buildStackConfigs(vibe);
    expect(configs[0]?.notes.join(" ")).toContain("starter policy");
    expect(configs[0]?.notes.join(" ")).toContain("includeSubDomains");
    expect(configs.find((config) => config.stack === "vercel")?.notes.join(" ")).toContain("X-Powered-By");
  });

  it("returns nothing when no finding can be fixed with configuration", () => {
    const result: ScanResult = {
      ...createDemoTarget("hardened"),
      findings: [finding({ id: "secrets.stripe-live", category: "secrets", severity: "critical", title: "Key", description: "x" }), finding({ id: "ok", category: "headers", severity: "passed", title: "ok", description: "ok" })],
    };
    expect(buildStackConfigs(result)).toEqual([]);
    expect(configCoverage(result)).toBe(0);
  });

  it("is carried into the Markdown export for developers and left out of the owner export", () => {
    expect(reportToMarkdown(vibe)).toContain("## Fix it all in one file: Next.js");
    expect(reportToMarkdown(vibe, { audience: "developer" })).toContain("next.config.ts");
    expect(reportToMarkdown(vibe, { audience: "owner" })).not.toContain("Fix it all in one file");
    expect(reportToMarkdown(createDemoTarget("hardened"))).toContain("COOP");
  });

  it("never produces a config that claims to fix a passed check", () => {
    const hardened = buildStackConfigs(createDemoTarget("hardened"));
    const vercel = hardened.find((config) => config.stack === "vercel");
    const keys = (JSON.parse(vercel?.code ?? "{}") as { headers: Array<{ headers: Array<{ key: string }> }> }).headers[0]?.headers.map((header) => header.key);
    expect(keys).toEqual(["Cross-Origin-Opener-Policy"]);
  });
});

describe("public keys versus secrets", () => {
  const stripePublic = j("pk", "_live_", "A".repeat(10), "b".repeat(14));
  const stripeSecret = j("sk", "_live_", "A".repeat(10), "b".repeat(14));
  const stripeTestSecret = j("sk", "_test_", "C".repeat(10), "d".repeat(14));

  it("reports a Stripe publishable key as an informational note, never as a leak", () => {
    const result = scan(`const stripe = Stripe("${stripePublic}");`);
    expect(ids(result)).toEqual(expect.arrayContaining(["secrets.none", "secrets.public-keys"]));
    expect(result.find((item) => item.id === "secrets.public-keys")?.severity).toBe("info");
    expect(result.some((item) => item.severity === "critical" || item.severity === "warning")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(stripePublic);
  });

  it("still treats a Stripe secret key as critical and a test secret key as a warning", () => {
    expect(scan(`k="${stripeSecret}"`).find((item) => item.id === "secrets.stripe-live")?.severity).toBe("critical");
    expect(scan(`k="${stripeTestSecret}"`).find((item) => item.id === "secrets.stripe-test")?.severity).toBe("warning");
  });

  it("separates the public and secret key when both are present", () => {
    const result = scan(`a="${stripePublic}"; b="${stripeSecret}"`);
    expect(result.find((item) => item.id === "secrets.stripe-live")?.severity).toBe("critical");
    expect(result.find((item) => item.id === "secrets.public-keys")?.evidence).toContain("Publishable key");
    expect(result.find((item) => item.id === "secrets.stripe-live")?.evidence).not.toContain("pk_");
  });

  it("recognizes other public client keys: Mapbox, Sentry DSN, PostHog, Google API key without Firebase", () => {
    const mapbox = j("pk", ".eyJ", "a".repeat(30), ".", "b".repeat(30));
    const sentry = j("https://", "a1".repeat(16), "@o123456.ingest.sentry.io/456");
    const posthog = j("phc", "_", "Z".repeat(36));
    const google = j("AI", "za", "S".repeat(35));
    const result = scan([mapbox, sentry, posthog, google].map((value) => `x="${value}"`).join(";"));
    const evidence = result.find((item) => item.id === "secrets.public-keys")?.evidence ?? "";
    expect(evidence).toContain("Mapbox public token");
    expect(evidence).toContain("Sentry DSN");
    expect(evidence).toContain("PostHog project key");
    expect(evidence).toContain("Google API key");
    expect(result.some((item) => item.severity === "critical" || item.severity === "warning")).toBe(false);
  });

  it("keeps a Google API key with Firebase config under the Firebase note, not the public-keys note", () => {
    const google = j("AI", "za", "S".repeat(35));
    const result = scan(`firebase.initializeApp({ apiKey: "${google}", authDomain: "demo.firebaseapp.com" })`);
    expect(ids(result)).toContain("secrets.firebase-public");
    expect(ids(result)).not.toContain("secrets.public-keys");
  });

  it("ignores placeholder keys in docs and templates", () => {
    expect(isPlaceholderSecret(j("sk", "_live_", "X".repeat(24)))).toBe(true);
    expect(isPlaceholderSecret(j("sk", "_live_", "your_key_here"))).toBe(true);
    expect(isPlaceholderSecret("sk_live_<YOUR_KEY>")).toBe(true);
    expect(isPlaceholderSecret(stripeSecret)).toBe(false);
    expect(ids(scan(`// sk_live_${"X".repeat(24)}\nconst key = "${j("sk", "_live_", "X".repeat(24))}"`))).toEqual(["secrets.none"]);
    expect(ids(scan(`STRIPE=${j("sk", "_live_", "your_key_here_please")}`))).toEqual(["secrets.none"]);
  });

  it("gives the public-keys note the lowest priority in the fix queue", () => {
    const note = finding({ id: "secrets.public-keys", category: "secrets", severity: "info", title: "Public keys", description: "x" });
    const queue = buildFixQueue([note, finding({ id: "secrets.stripe-live", category: "secrets", severity: "critical", title: "Live key", description: "x" })]);
    expect(queue.map((entry) => entry.id)).toEqual(["secrets.stripe-live", "secrets.public-keys"]);
    expect(queue[1]?.impact).toBe(12);
    expect(scoreFindings([note]).score).toBe(100);
  });
});
