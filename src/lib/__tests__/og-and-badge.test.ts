import { describe, expect, it } from "vitest";
import { auditOfferFor, BUILD_AUDIT_OFFER, WEB_AUDIT_OFFER } from "../audit-offer";
import { buildBadgeMarkdown, buildBadgeUrl, renderBadgeSvg } from "../badge";
import {
  API_PARAM_KEYS,
  ogImagePath,
  parseGrade,
  parseScore,
  parseScoreCardParams,
  sanitizeTarget,
  scoreUpgrade,
  SHARE_PARAM_KEYS,
} from "../og-params";
import { buildTarget, displayTarget, isBuildTarget } from "../scan-target";
import type { Finding, Severity } from "../scanner/types";
import { buildShareLink, buildShareText, buildXIntentUrl } from "../share";
import { defaultSocialMetadata, landingPageMetadata } from "../site-metadata";

const SITE = "https://shipsafe-six-iota.vercel.app";
const query = (values: Record<string, string>) => (key: string) => values[key];

describe("/api/og parameter validation", () => {
  it.each([
    ["0", 0],
    ["94", 94],
    ["100", 100],
  ])("accepts score %s", (raw, expected) => {
    expect(parseScore(raw)).toBe(expected);
  });

  it.each(["101", "-1", "9.5", "1e2", " 94", "94 ", "", "abc", "0x10", "1000"])("rejects score %j", (raw) => {
    expect(parseScore(raw)).toBeNull();
  });

  it("accepts only grades A–F, case-sensitive", () => {
    for (const grade of ["A", "B", "C", "D", "F"]) expect(parseGrade(grade)).toBe(grade);
    for (const bad of ["E", "a", "AA", "", "A<script>"]) expect(parseGrade(bad)).toBeNull();
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseScore(["88", "12"])).toBe(88);
    expect(parseGrade(["B", "F"])).toBe("B");
  });

  it("requires both score and grade, and treats prev/target as optional", () => {
    expect(parseScoreCardParams(query({ score: "94", grade: "A" }))).toEqual({ score: 94, grade: "A", prev: null, target: null });
    expect(parseScoreCardParams(query({ score: "94" }))).toBeNull();
    expect(parseScoreCardParams(query({ grade: "A" }))).toBeNull();
    expect(parseScoreCardParams(query({ score: "94", grade: "A", prev: "62", target: "my-app.com" }))).toEqual({
      score: 94,
      grade: "A",
      prev: 62,
      target: "my-app.com",
    });
    expect(parseScoreCardParams(query({ score: "94", grade: "A", prev: "999" }))?.prev).toBeNull();
  });

  it("reads the short share keys (?s=&g=&p=)", () => {
    expect(parseScoreCardParams(query({ s: "70", g: "C", p: "40" }), SHARE_PARAM_KEYS)).toMatchObject({ score: 70, grade: "C", prev: 40 });
    expect(parseScoreCardParams(query({ s: "70", g: "C" }), API_PARAM_KEYS)).toBeNull();
  });

  it("sanitizes target to ≤ 40 safe ASCII characters (no HTML, quotes or control chars)", () => {
    expect(sanitizeTarget('<script>alert("x")</script>')).toBe("scriptalertx/script");
    expect(sanitizeTarget("my-app.com")).toBe("my-app.com");
    expect(sanitizeTarget("Game Build v1.2.zip")).toBe("Game Build v1.2.zip");
    expect(sanitizeTarget("a".repeat(100))).toHaveLength(40);
    expect(sanitizeTarget("ünïcödé\u0000\n\t&;'\"`")).toBe("ncd");
    expect(sanitizeTarget("<<>>")).toBeNull();
    expect(sanitizeTarget(undefined)).toBeNull();
  });

  it("shows an upgrade badge only when the score went up", () => {
    expect(scoreUpgrade({ score: 94, grade: "A", prev: 62, target: null })).toEqual({ from: 62, to: 94, delta: 32 });
    expect(scoreUpgrade({ score: 62, grade: "D", prev: 94, target: null })).toBeNull();
    expect(scoreUpgrade({ score: 80, grade: "B", prev: 80, target: null })).toBeNull();
    expect(scoreUpgrade({ score: 80, grade: "B", prev: null, target: null })).toBeNull();
  });

  it("builds /api/og URLs with prev only for upgrades and an encoded target", () => {
    expect(ogImagePath({ score: 94, grade: "A", prev: 62, target: "my app.com" })).toBe("/api/og?score=94&grade=A&prev=62&target=my+app.com");
    expect(ogImagePath({ score: 50, grade: "F", prev: 90, target: null })).toBe("/api/og?score=50&grade=F");
  });
});

describe("landing page metadata (generateMetadata)", () => {
  it("uses the static card by default", () => {
    const meta = defaultSocialMetadata();
    expect(JSON.stringify(meta.openGraph)).toContain("/opengraph-image");
    expect(JSON.stringify(meta.twitter)).toContain("/twitter-image");
    expect(landingPageMetadata(null)).toEqual(meta);
  });

  it("points OG and Twitter images at /api/og for a valid shared score", () => {
    const meta = landingPageMetadata({ score: 94, grade: "A", prev: 62, target: null });
    expect(JSON.stringify(meta.openGraph)).toContain("/api/og?score=94&grade=A&prev=62");
    expect(JSON.stringify(meta.twitter)).toContain("/api/og?score=94&grade=A&prev=62");
    expect(JSON.stringify(meta.twitter)).toContain("summary_large_image");
    expect(JSON.stringify(meta.openGraph)).toContain("Scored 94/100 (Grade A) on ShipSafe");
  });
});

describe("/api/badge SVG", () => {
  it("renders grade and score in a shields-style badge", () => {
    const svg = renderBadgeSvg({ score: 94, grade: "A" });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(">ShipSafe<");
    expect(svg).toContain(">Grade A · 94/100<");
    expect(svg).toContain("#059669");
    expect(svg).toContain('aria-label="ShipSafe: Grade A · 94/100"');
  });

  it.each([
    ["B", "#059669"],
    ["C", "#b45309"],
    ["D", "#b45309"],
    ["F", "#dc2626"],
  ] as const)("colors grade %s with %s", (grade, color) => {
    expect(renderBadgeSvg({ score: 50, grade })).toContain(`fill="${color}"`);
  });

  it("renders a neutral badge for missing or invalid parameters", () => {
    const cases: Array<Record<string, string>> = [{}, { grade: "Z", score: "94" }, { grade: "A", score: "101" }, { grade: "A" }];
    for (const values of cases) {
      const params = parseScoreCardParams(query(values));
      const svg = renderBadgeSvg(params ? { score: params.score, grade: params.grade } : null);
      expect(svg).toContain(">Check Security<");
      expect(svg).not.toContain("Grade");
    }
  });

  it("never lets user input reach the SVG (XSS)", () => {
    const attacks = ['A"><script>alert(1)</script>', "A' onload='alert(1)", "<svg/onload=alert(1)>", "A&lt;", "javascript:alert(1)"];
    for (const attack of attacks) {
      const params = parseScoreCardParams(query({ grade: attack, score: `94${attack}` }));
      expect(params).toBeNull();
      const svg = renderBadgeSvg(params);
      expect(svg).not.toContain("script");
      expect(svg).not.toContain("onload");
      expect(svg).not.toContain("javascript:");
    }
    // Even the valid path contains only fixed text, a single grade letter and digits.
    const svg = renderBadgeSvg({ score: 94, grade: "A" });
    expect(svg.match(/<text[^>]*>([^<]*)<\/text>/g)?.every((text) => /(ShipSafe|Grade [A-F] · \d{1,3}\/100)/.test(text))).toBe(true);
  });

  it("builds the README badge markdown", () => {
    expect(buildBadgeUrl(94, "A", SITE)).toBe(`${SITE}/api/badge?grade=A&score=94`);
    expect(buildBadgeMarkdown(94, "A", SITE)).toBe(`[![ShipSafe Security Check](${SITE}/api/badge?grade=A&score=94)](${SITE})`);
  });
});

describe("buildShareText with shareable score links", () => {
  it("links to /?s=&g= so previews show the personal score card", () => {
    expect(buildShareText(94, "A", SITE)).toBe(`My site scored 94/100 (Grade A) on ShipSafe's 15-second pre-launch security check: ${SITE}/?s=94&g=A`);
  });

  it("adds &p= and upgrade wording only when the score improved", () => {
    expect(buildShareText(94, "A", SITE, { scoreDelta: 32, previousScore: 62 })).toBe(
      `Upgraded my site from 62 to 94/100 (Grade A) on ShipSafe's 15-second pre-launch security check: ${SITE}/?s=94&g=A&p=62`,
    );
    expect(buildShareLink(60, "D", SITE, { scoreDelta: -10, previousScore: 70 })).toBe(`${SITE}/?s=60&g=D`);
  });

  it("says 'app build' for build scans", () => {
    expect(buildShareText(88, "B", SITE, null, buildTarget("game.apk"))).toBe(
      `My app build scored 88/100 (Grade B) on ShipSafe's 15-second pre-launch security check: ${SITE}/?s=88&g=B`,
    );
  });

  it("always fits in one X post (≤ 280 characters), even in the longest variant", () => {
    const longest = buildShareText(100, "A", SITE, { scoreDelta: 100, previousScore: 0 }, buildTarget("x".repeat(500)));
    expect(longest.length).toBeLessThanOrEqual(280);
    expect(decodeURIComponent(new URL(buildXIntentUrl(longest)).searchParams.get("text") ?? "")).toBe(longest);
  });

  it("produces share links that parse back into the same score card", () => {
    const link = new URL(buildShareLink(94, "A", SITE, { scoreDelta: 32, previousScore: 62 }));
    expect(parseScoreCardParams((key) => link.searchParams.get(key), SHARE_PARAM_KEYS)).toEqual({ score: 94, grade: "A", prev: 62, target: null });
  });
});

describe("build targets", () => {
  it("encodes build file names as valid build: URLs and decodes them for display", () => {
    const target = buildTarget("C:\\Games\\My Game v1.2.apk");
    expect(target).toBe("build:My%20Game%20v1.2.apk");
    expect(isBuildTarget(target)).toBe(true);
    expect(displayTarget(target)).toBe("My Game v1.2.apk");
    expect(() => new URL(target)).not.toThrow();
    expect(displayTarget("https://my-app.com/")).toBe("my-app.com");
    expect(isBuildTarget("https://my-app.com/")).toBe(false);
  });
});

describe("contextual audit offers", () => {
  const make = (id: string, severity: Severity): Finding => ({
    id,
    category: "secrets",
    severity,
    title: id,
    description: id,
    evidence: "",
    fixPrompt: "",
  });

  it("offers help on every critical finding, with web or build wording", () => {
    expect(auditOfferFor(make("headers.csp", "critical"), false)).toBe(WEB_AUDIT_OFFER);
    expect(auditOfferFor(make("build.android-debuggable", "critical"), true)).toBe(BUILD_AUDIT_OFFER);
    expect(WEB_AUDIT_OFFER).toBe("Need help locking down RLS rules, keys & server routes? Get a human audit from $10 →");
    expect(BUILD_AUDIT_OFFER).toBe("Shipping a game or mobile app? We manually audit builds, APIs & anti-cheat endpoints from $10 →");
  });

  it("also offers help on Supabase / Firebase reminders and leaked test keys", () => {
    expect(auditOfferFor(make("secrets.supabase-public", "info"), false)).toBe(WEB_AUDIT_OFFER);
    expect(auditOfferFor(make("secrets.firebase-public", "info"), false)).toBe(WEB_AUDIT_OFFER);
    expect(auditOfferFor(make("secrets.stripe-test", "warning"), false)).toBe(WEB_AUDIT_OFFER);
    expect(auditOfferFor(make("build.google-services", "info"), true)).toBe(BUILD_AUDIT_OFFER);
  });

  it("stays quiet on passed checks and ordinary warnings", () => {
    expect(auditOfferFor(make("secrets.none", "passed"), false)).toBeNull();
    expect(auditOfferFor(make("build.android-debuggable", "passed"), true)).toBeNull();
    expect(auditOfferFor(make("headers.csp", "warning"), false)).toBeNull();
    expect(auditOfferFor(make("headers.permissions-policy", "info"), false)).toBeNull();
  });
});
