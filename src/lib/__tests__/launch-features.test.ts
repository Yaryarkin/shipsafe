import { describe, expect, it } from "vitest";
import { createDemoReport } from "../demo-report";
import { buildFixQueue, queueByTier, ruleFor, sortByPriority } from "../fix-queue";
import { reportToMarkdown } from "../markdown";
import { assessReadiness } from "../readiness";
import { analyzeBuildArchive } from "../scanner/build-analyzer";
import { enrichFinding, enrichFindings, orderSnippets } from "../scanner/fixes";
import { scoreFindings } from "../scanner/scoring";
import { describeDetections, detectBuildStack, detectWebStack, snippetStacksFor } from "../scanner/stack";
import { scanResultSchema, type Finding, type ScanResult } from "../scanner/types";
import { finding } from "../scanner/utils";

const f = (id: string, severity: Finding["severity"], title = `Title ${id}`): Finding =>
  finding({ id, category: "headers", severity, title, description: `${title} is a problem.`, evidence: "x" });

function resultWith(findings: Finding[], overrides: Partial<ScanResult> = {}): ScanResult {
  const { score, grade, summary } = scoreFindings(findings);
  return {
    target: "https://shop.example.com/",
    finalUrl: "https://shop.example.com/",
    scannedAt: "2026-11-20T10:00:00.000Z",
    overallScore: score,
    grade,
    scanDurationMs: 900,
    summary,
    findings,
    ...overrides,
  };
}

describe("web stack detection", () => {
  it("recognizes Next.js on Vercel from headers, markup and assets, most specific first", () => {
    const found = detectWebStack({
      headers: { "x-vercel-id": "iad1::abc", server: "Vercel", "x-powered-by": "Next.js" },
      html: '<html><body><div id="__next"></div><script src="/_next/static/chunks/a.js"></script></body></html>',
      scriptUrls: ["https://shop.example.com/_next/static/chunks/a.js"],
    });
    expect(found.map((item) => item.id)).toEqual(["nextjs", "vercel"]);
    expect(found.every((item) => item.confidence === "high")).toBe(true);
    expect(found[0]?.signals).toContain("x-powered-by: Next.js");
  });

  it("recognizes Nginx, Express, Netlify, Cloudflare, Apache and WordPress", () => {
    expect(detectWebStack({ headers: { server: "nginx/1.25.3" }, html: "" }).map((item) => item.id)).toEqual(["nginx"]);
    expect(detectWebStack({ headers: { "x-powered-by": "Express" }, html: "" }).map((item) => item.id)).toEqual(["express"]);
    expect(detectWebStack({ headers: { "x-nf-request-id": "1" }, html: "" }).map((item) => item.id)).toEqual(["netlify"]);
    expect(detectWebStack({ headers: { "cf-ray": "abc", server: "cloudflare" }, html: "" }).map((item) => item.id)).toEqual(["cloudflare"]);
    expect(detectWebStack({ headers: { server: "Apache/2.4" }, html: "" }).map((item) => item.id)).toEqual(["apache"]);
    expect(detectWebStack({ headers: {}, html: '<link href="/wp-content/themes/x/style.css">' }).map((item) => item.id)).toEqual(["wordpress"]);
  });

  it("reports a single clue as medium confidence and nothing when there is no clue", () => {
    expect(detectWebStack({ headers: { server: "nginx" }, html: "" })[0]?.confidence).toBe("medium");
    expect(detectWebStack({ headers: {}, html: "<html></html>" })).toEqual([]);
    expect(() => detectWebStack({ headers: {}, html: "\u0000".repeat(500_000) })).not.toThrow();
  });

  it("maps detections to snippet stacks in detection order without duplicates", () => {
    const found = detectWebStack({ headers: { "x-vercel-id": "1", "x-powered-by": "Next.js", server: "nginx" }, html: "" });
    expect(snippetStacksFor(found)).toEqual(["nextjs", "vercel", "nginx"]);
    expect(snippetStacksFor([{ id: "wordpress" }, { id: "cloudflare" }])).toEqual([]);
    expect(snippetStacksFor(undefined)).toEqual([]);
    expect(describeDetections(found)).toBe("Next.js, Vercel, Nginx");
  });
});

describe("build stack detection", () => {
  it("recognizes an Android APK", () => {
    const found = detectBuildStack(["AndroidManifest.xml", "classes.dex", "res/layout/a.xml"], "game.apk");
    expect(found[0]).toMatchObject({ id: "android", confidence: "high" });
    expect(snippetStacksFor(found)).toEqual(["android"]);
  });

  it("recognizes React Native and Flutter inside an APK", () => {
    expect(detectBuildStack(["AndroidManifest.xml", "assets/index.android.bundle"], "app.apk").map((item) => item.id)).toEqual(["android", "react-native"]);
    expect(detectBuildStack(["lib/arm64-v8a/libflutter.so", "assets/flutter_assets/x"], "app.apk").map((item) => item.id)).toContain("flutter");
  });

  it("recognizes Unity WebGL, Godot and Electron exports", () => {
    expect(detectBuildStack(["index.html", "Build/game.framework.js.unityweb", "StreamingAssets/a"], "web.zip").map((item) => item.id)).toEqual(["unity"]);
    expect(detectBuildStack(["index.html", "index.pck", "index.wasm"], "godot.zip").map((item) => item.id)).toEqual(["godot"]);
    expect(detectBuildStack(["resources/app.asar", "electron.exe"], "win.zip").map((item) => item.id)).toEqual(["electron"]);
  });

  it("calls a plain index.html with bundles a static web build, and an empty archive nothing", () => {
    expect(detectBuildStack(["index.html", "assets/app.js", "assets/app.css"], "site.zip")[0]).toMatchObject({ id: "static-web", confidence: "high" });
    expect(detectBuildStack(["readme.txt"], "x.zip")).toEqual([]);
    expect(detectBuildStack([], "")).toEqual([]);
  });

  it("is attached to an analyzed archive", () => {
    const result = analyzeBuildArchive({ "index.html": "<html></html>", "app.js": "console.log(1)" }, "site.zip", { now: new Date("2026-11-20T10:00:00Z") });
    expect(result.detectedStack?.map((item) => item.id)).toEqual(["static-web"]);
    expect(scanResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("tailored fixes", () => {
  it("lists the detected stack's snippets first and marks them recommended", () => {
    const plain = enrichFinding(f("headers.nosniff", "warning"), "https://x.com");
    expect(plain.snippets?.map((item) => item.stack)).toEqual(["nextjs", "vercel", "nginx", "express"]);

    const tailored = enrichFinding(f("headers.nosniff", "warning"), "https://x.com", ["nginx"]);
    expect(tailored.snippets?.map((item) => item.stack)).toEqual(["nginx", "nextjs", "vercel", "express"]);
    expect(tailored.snippets?.map((item) => Boolean(item.recommended))).toEqual([true, false, false, false]);
  });

  it("keeps the order of several detected stacks and does not drop or duplicate anything", () => {
    const tailored = enrichFinding(f("headers.nosniff", "warning"), "https://x.com", ["vercel", "nextjs"]);
    expect(tailored.snippets?.map((item) => item.stack).slice(0, 2)).toEqual(["vercel", "nextjs"]);
    expect(tailored.snippets).toHaveLength(plainLength());
  });

  it("changes nothing when no stack was detected or the stack has no snippets", () => {
    const snippets = enrichFinding(f("headers.nosniff", "warning"), "https://x.com").snippets ?? [];
    expect(orderSnippets(snippets, [])).toBe(snippets);
    expect(orderSnippets(snippets, ["android"]).map((item) => item.stack)).toEqual(snippets.map((item) => item.stack));
    expect(enrichFindings([f("headers.nosniff", "passed")], "https://x.com", ["nginx"])[0]?.snippets).toBeUndefined();
  });
});

function plainLength() {
  return enrichFinding(f("headers.nosniff", "warning"), "https://x.com").snippets?.length ?? 0;
}

describe("fix priority queue", () => {
  const findings = [
    f("headers.referrer-policy", "info"),
    f("headers.csp", "warning"),
    f("exposure.env", "critical"),
    f("headers.nosniff", "warning"),
    f("transport.hsts", "warning"),
    f("secrets.stripe-live", "critical"),
    f("cors.policy", "critical"),
    f("x.ok", "passed"),
  ];

  it("orders by severity, then impact, then effort", () => {
    const queue = buildFixQueue(findings);
    expect(queue.map((item) => item.id)).toEqual([
      "exposure.env",
      "secrets.stripe-live",
      "cors.policy",
      "transport.hsts",
      "headers.csp",
      "headers.nosniff",
      "headers.referrer-policy",
    ]);
    expect(queue.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts every critical in 'now', warnings in 'next' and info in 'later', and skips passed findings", () => {
    const queue = buildFixQueue(findings);
    expect(queue.filter((item) => item.tier === "now")).toHaveLength(3);
    expect(queue.find((item) => item.id === "headers.csp")?.tier).toBe("next");
    expect(queue.find((item) => item.id === "headers.referrer-policy")?.tier).toBe("later");
    expect(queue.some((item) => item.id === "x.ok")).toBe(false);
    expect(queueByTier(queue).map((group) => group.tier)).toEqual(["now", "next", "later"]);
  });

  it("puts a quick win ahead of a slow fix with the same impact, and is stable for ties", () => {
    const queue = buildFixQueue([f("unknown.b", "warning"), f("unknown.a", "warning")]);
    expect(queue.map((item) => item.id)).toEqual(["unknown.b", "unknown.a"]);
    expect(ruleFor({ id: "cors.policy", severity: "critical" }).effort).toBe("minutes");
    expect(ruleFor({ id: "never.seen", severity: "warning" })).toMatchObject({ impact: 40, effort: "hour" });
  });

  it("sorts findings by the queue and keeps passed checks last in their original order", () => {
    const sorted = sortByPriority(findings.concat(f("x.ok2", "passed")));
    expect(sorted.slice(0, 3).map((item) => item.id)).toEqual(["exposure.env", "secrets.stripe-live", "cors.policy"]);
    expect(sorted.slice(-2).map((item) => item.id)).toEqual(["x.ok", "x.ok2"]);
    expect(sorted).toHaveLength(findings.length + 1);
  });

  it("is empty for a clean scan", () => {
    expect(buildFixQueue([f("a", "passed")])).toEqual([]);
    expect(sortByPriority([])).toEqual([]);
  });
});

describe("pre-launch readiness gate", () => {
  it("is blocked by any critical finding, with the titles and what unlocks it", () => {
    const gate = assessReadiness(resultWith([f("a", "critical", "Leaked key"), f("b", "warning", "No CSP"), f("c", "passed")]));
    expect(gate.status).toBe("blocked");
    expect(gate.label).toBe("Blocked by critical");
    expect(gate.reasons[0]).toContain("Leaked key");
    expect(gate.holding).toEqual(["Leaked key", "No CSP"]);
    expect(gate.unlock).toContain("Needs attention");
  });

  it("needs attention for warnings only, and is ready when there are none", () => {
    const attention = assessReadiness(resultWith([f("b", "warning", "No CSP"), f("c", "passed")]));
    expect(attention).toMatchObject({ status: "attention", label: "Needs attention" });
    expect(attention.unlock).toContain("Ready to ship");

    const ready = assessReadiness(resultWith([f("c", "passed"), f("d", "info")]));
    expect(ready).toMatchObject({ status: "ready", label: "Ready to ship", unlock: "", holding: [] });
    expect(ready.reasons.join(" ")).toContain("1 optional note");
  });

  it("never says ready when checks did not finish", () => {
    const gate = assessReadiness(resultWith([f("transport.incomplete", "info", "Transport check did not complete"), f("c", "passed")]));
    expect(gate.status).toBe("attention");
    expect(gate.reasons.join(" ")).toContain("did not complete");
    expect(gate.unlock).toContain("Re-scan");
  });

  it("uses singular and plural wording and speaks about builds", () => {
    expect(assessReadiness(resultWith([f("a", "critical")])).headline).toContain("1 critical issue ");
    expect(assessReadiness(resultWith([f("a", "critical"), f("b", "critical")])).headline).toContain("2 critical issues");
    const build = assessReadiness(resultWith([f("c", "passed")], { target: "build:game.apk", finalUrl: "build:game.apk" }));
    expect(build.headline).toContain("This build");
  });

  it("truncates a long list of titles", () => {
    const many = Array.from({ length: 8 }, (_, index) => f(`w${index}`, "warning", `Warning ${index}`));
    const gate = assessReadiness(resultWith(many));
    expect(gate.holding).toHaveLength(5);
    expect(gate.reasons.join(" ")).toContain("+5 more");
  });
});

describe("report integration", () => {
  it("the demo report carries a detected stack and Next.js / Vercel fixes first", () => {
    const report = createDemoReport();
    expect(scanResultSchema.safeParse(report).success).toBe(true);
    expect(report.detectedStack?.map((item) => item.id)).toEqual(["nextjs", "vercel"]);
    const withSnippets = report.findings.find((item) => item.id === "headers.csp");
    expect(withSnippets?.snippets?.slice(0, 2).map((item) => item.stack)).toEqual(["nextjs", "vercel"]);
    expect(withSnippets?.snippets?.[0]?.recommended).toBe(true);
  });

  it("the Markdown export includes readiness, stack and the tiered queue", () => {
    const md = reportToMarkdown(createDemoReport());
    expect(md).toContain("| Launch readiness | **Blocked by critical** |");
    expect(md).toContain("| Detected stack | Next.js, Vercel |");
    expect(md).toContain("## Pre-launch readiness");
    expect(md).toContain("### Fix now");
    expect(md).toContain("### Fix next");
    expect(md).toMatch(/- \[ \] \*\*CRITICAL\*\*: .+ · ~/);
    expect(md.indexOf("## Pre-launch readiness")).toBeLessThan(md.indexOf("## Priority fix list"));
    // The findings follow the queue: the critical one is numbered first.
    expect(md).toMatch(/### 1\. \[CRITICAL\]/);
  });

  it("old results without a detected stack still validate", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoReport())) as Record<string, unknown>;
    delete legacy.detectedStack;
    expect(scanResultSchema.safeParse(legacy).success).toBe(true);
  });
});
