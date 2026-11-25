import { describe, expect, it } from "vitest";
import { createDemoReport } from "@/lib/demo-report";
import { reportToMarkdown } from "@/lib/markdown";
import { enrichFinding, enrichFindings } from "../fixes";
import { buildScoreBreakdown, scoreFindings } from "../scoring";
import { scanResultSchema, STACKS, type Finding } from "../types";
import { finding } from "../utils";

const SITE = "https://shop.example.com";

const make = (id: string, severity: Finding["severity"], category: Finding["category"] = "headers"): Finding =>
  finding({ id, category, severity, title: `Title ${id}`, description: "Described.", evidence: "evidence" });

const KNOWN_IDS = [
  "headers.csp",
  "headers.csp-hardening",
  "headers.framing",
  "headers.nosniff",
  "headers.referrer-policy",
  "headers.permissions-policy",
  "headers.permissions-policy-wildcard",
  "headers.coop",
  "transport.hsts",
  "transport.hsts-preload",
  "transport.http-redirect",
  "transport.https",
  "transport.certificate",
  "cors.policy",
  "cookies.secure",
  "cookies.httponly",
  "cookies.samesite",
  "exposure.env",
  "exposure.git",
  "exposure.file.backup-zip",
  "exposure.tech-disclosure",
  "exposure.robots",
  "exposure.sitemap-sensitive",
  "exposure.security-txt",
  "frontend.source-maps",
  "frontend.mixed-content",
  "frontend.sri",
  "secrets.stripe-live",
  "secrets.telegram-bot-token",
  "secrets.supabase-public",
  "secrets.firebase-public",
  "build.android-debuggable",
  "build.android-cleartext",
  "build.android-backup",
  "build.android-permissions",
  "build.signing-keys",
  "build.hardcoded-tokens",
];

describe("enrichFinding", () => {
  it.each(KNOWN_IDS)("adds an impact and at least one snippet for %s", (id) => {
    const enriched = enrichFinding(make(id, "warning"), SITE);
    expect(enriched.impact?.length).toBeGreaterThan(30);
    expect(enriched.snippets?.length).toBeGreaterThan(0);
    for (const item of enriched.snippets ?? []) {
      expect(STACKS).toContain(item.stack);
      expect(item.code.trim().length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("covers every major stack for a header finding", () => {
    const stacks = new Set(enrichFinding(make("headers.nosniff", "warning"), SITE).snippets?.map((item) => item.stack));
    expect(stacks).toEqual(new Set(["nextjs", "vercel", "nginx", "express"]));
  });

  it("generates valid JSON for the Vercel snippets", () => {
    for (const id of ["headers.csp", "headers.framing", "transport.hsts", "headers.coop"]) {
      const vercel = enrichFinding(make(id, "warning"), SITE).snippets?.find((item) => item.stack === "vercel");
      expect(vercel, id).toBeDefined();
      expect(() => JSON.parse(vercel?.code ?? "")).not.toThrow();
    }
  });

  it("tailors the CORS snippets to the scanned origin", () => {
    const cors = enrichFinding(make("cors.policy", "warning", "cors-cookies"), "https://shop.example.com/some/path").snippets ?? [];
    expect(cors.length).toBeGreaterThanOrEqual(3);
    expect(cors.every((item) => item.code.includes("https://shop.example.com"))).toBe(true);
    expect(cors.some((item) => item.code.includes("/some/path"))).toBe(false);
  });

  it("falls back to a generic origin when the site is not a URL", () => {
    const cors = enrichFinding(make("cors.policy", "warning", "cors-cookies"), "not a url").snippets ?? [];
    expect(cors[0]?.code).toContain("https://your-domain.com");
  });

  it("gives unknown findings a severity-based impact and no snippets", () => {
    const critical = enrichFinding(make("something.new", "critical"), SITE);
    expect(critical.impact).toContain("exploitable");
    expect(critical.snippets).toBeUndefined();
    expect(enrichFinding(make("something.new", "info"), SITE).impact).toContain("attack surface");
  });

  it("leaves passed findings untouched and never mutates its input", () => {
    const passed = make("headers.csp", "passed");
    expect(enrichFinding(passed, SITE)).toBe(passed);
    const warning = make("headers.csp", "warning");
    const before = JSON.stringify(warning);
    enrichFinding(warning, SITE);
    expect(JSON.stringify(warning)).toBe(before);
  });

  it("does not attach secret-rotation advice to the 'no secrets' pass or to public-key notes wrongly", () => {
    expect(enrichFinding(make("secrets.none", "passed", "secrets"), SITE).impact).toBeUndefined();
    const supabase = enrichFinding(make("secrets.supabase-public", "info", "secrets"), SITE);
    expect(supabase.impact).toContain("Row-Level Security");
    expect(supabase.snippets?.[0]?.language).toBe("sql");
  });

  it("keeps order and length when enriching a list", () => {
    const list = [make("headers.csp", "warning"), make("x.y", "passed"), make("exposure.env", "critical", "exposure")];
    expect(enrichFindings(list, SITE).map((item) => item.id)).toEqual(["headers.csp", "x.y", "exposure.env"]);
  });
});

describe("buildScoreBreakdown", () => {
  it("matches scoreFindings and explains each penalty", () => {
    const findings = [make("a", "warning"), make("b", "warning"), make("c", "info"), make("d", "passed")];
    const breakdown = buildScoreBreakdown(findings);
    expect(breakdown).toEqual({
      base: 100,
      items: [{ severity: "warning", count: 2, pointsEach: 6, points: 12 }],
      criticalCap: null,
      total: 88,
    });
    expect(breakdown.total).toBe(scoreFindings(findings).score);
  });

  it("reports the critical cap only when it actually lowered the score", () => {
    const capped = buildScoreBreakdown([make("a", "critical")]);
    expect(capped.criticalCap).toBe(69);
    expect(capped.total).toBe(69);
    const naturallyLow = buildScoreBreakdown([make("a", "critical"), make("b", "critical"), make("c", "critical"), make("d", "critical")]);
    expect(naturallyLow.criticalCap).toBeNull();
    expect(naturallyLow.total).toBe(20);
  });

  it("is empty for a clean scan and never goes below zero", () => {
    expect(buildScoreBreakdown([make("p", "passed")])).toMatchObject({ items: [], criticalCap: null, total: 100 });
    const many = Array.from({ length: 12 }, (_, index) => make(`c${index}`, "critical"));
    expect(buildScoreBreakdown(many).total).toBe(0);
  });
});

describe("report integration", () => {
  it("the demo report carries impact, snippets and a breakdown and still validates", () => {
    const report = createDemoReport();
    expect(scanResultSchema.safeParse(report).success).toBe(true);
    expect(report.scoreBreakdown?.total).toBe(report.overallScore);
    const actionable = report.findings.filter((item) => item.severity !== "passed");
    expect(actionable.every((item) => Boolean(item.impact))).toBe(true);
    expect(actionable.some((item) => (item.snippets?.length ?? 0) > 0)).toBe(true);
  });

  it("old results without the new fields still parse", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoReport())) as Record<string, unknown> & { findings: Array<Record<string, unknown>> };
    delete legacy.scoreBreakdown;
    for (const item of legacy.findings) {
      delete item.impact;
      delete item.snippets;
    }
    expect(scanResultSchema.safeParse(legacy).success).toBe(true);
  });

  it("the Markdown export includes impact and fenced snippets", () => {
    const markdown = reportToMarkdown(createDemoReport());
    expect(markdown).toContain("**Impact:**");
    expect(markdown).toMatch(/\*\*Fix: .+\*\*/);
    expect(markdown).toMatch(/```(?:ts|json|nginx|js)/);
  });
});
