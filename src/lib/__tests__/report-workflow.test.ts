import { describe, expect, it } from "vitest";
import {
  BADGE_FORMATS,
  buildBadgeSnippet,
  buildBadgeUrl,
  parseBadgeOptions,
  renderBadgeSvg,
} from "../badge";
import { createDemoReport } from "../demo-report";
import { buildLaunchUrl, normalizeLaunchUrl, parseLaunchParams, parseLaunchMode, stripLaunchParams } from "../launch-params";
import { markdownFileName, reportToMarkdown } from "../markdown";
import { buildDeveloperBrief, buildOwnerSummary, extractFixSteps, extractVerifyHint, firstSentence, plainImpact, priorityFindings, severityRows } from "../report-summary";
import { HISTORY_STORAGE_KEY, loadHistory, recordScanAndDiff, type KeyValueStorage } from "../scan-history";
import {
  buildHistoryRows,
  clearAllHistory,
  INSIGHTS_STORAGE_KEY,
  loadInsights,
  MAX_TREND_POINTS,
  recordInsights,
  statusOf,
  verifyFixes,
} from "../scan-insights";
import { scoreFindings } from "../scanner/scoring";
import type { Finding, ScanResult } from "../scanner/types";
import { finding } from "../scanner/utils";

const SITE = "https://shipsafe.example";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

function resultWith(findings: Finding[], overrides: Partial<ScanResult> = {}): ScanResult {
  const { score, grade, summary } = scoreFindings(findings);
  return {
    target: "https://shop.example.com/",
    finalUrl: "https://shop.example.com/",
    scannedAt: "2026-11-20T10:00:00.000Z",
    overallScore: score,
    grade,
    scanDurationMs: 1500,
    summary,
    findings,
    ...overrides,
  };
}

const f = (id: string, severity: Finding["severity"], title = `Title ${id}`): Finding =>
  finding({ id, category: "headers", severity, title, description: `${title} is a problem. More detail follows here.`, evidence: "Header: (not set)" });

describe("launch parameters", () => {
  it("normalizes a bare domain and a full URL", () => {
    expect(normalizeLaunchUrl("my-app.com")).toBe("https://my-app.com");
    expect(normalizeLaunchUrl("  https://My-App.com/docs?x=1  ")).toBe("https://my-app.com/docs?x=1");
    expect(normalizeLaunchUrl("http://example.com:8080/")).toBe("http://example.com:8080");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com",
    "https://user:pass@example.com",
    "localhost",
    "http://intranet",
    "",
    "   ",
    "https://" + "a".repeat(2100) + ".com",
  ])("rejects unsafe or unusable value %j", (value) => {
    expect(normalizeLaunchUrl(value)).toBeNull();
  });

  it("strips control characters", () => {
    expect(normalizeLaunchUrl("my-app.com\u0000\n")).toBe("https://my-app.com");
  });

  it("maps mode aliases and rejects unknown ones", () => {
    expect(parseLaunchMode("website")).toBe("url");
    expect(parseLaunchMode("APK")).toBe("build");
    expect(parseLaunchMode("game")).toBe("build");
    expect(parseLaunchMode("hack")).toBeNull();
    expect(parseLaunchMode(null)).toBeNull();
  });

  const get = (query: string) => {
    const params = new URLSearchParams(query);
    return (key: string) => params.get(key);
  };

  it("prefills the url and implies website mode", () => {
    expect(parseLaunchParams(get("url=my-app.com"))).toEqual({ url: "https://my-app.com", mode: "url", autoScan: false });
    expect(parseLaunchParams(get("site=my-app.com"))).toMatchObject({ url: "https://my-app.com" });
  });

  it("auto-scans only with scan=1 and a valid website url", () => {
    expect(parseLaunchParams(get("url=my-app.com&scan=1")).autoScan).toBe(true);
    expect(parseLaunchParams(get("url=my-app.com&scan=true")).autoScan).toBe(true);
    expect(parseLaunchParams(get("url=my-app.com&scan=0")).autoScan).toBe(false);
    expect(parseLaunchParams(get("scan=1")).autoScan).toBe(false);
    expect(parseLaunchParams(get("url=javascript:alert(1)&scan=1")).autoScan).toBe(false);
  });

  it("build mode never auto-scans and ignores a url", () => {
    expect(parseLaunchParams(get("mode=build&url=my-app.com&scan=1"))).toEqual({ url: null, mode: "build", autoScan: false });
  });

  it("returns nothing for unrelated queries", () => {
    expect(parseLaunchParams(get("s=94&g=A&utm_source=telegram"))).toEqual({ url: null, mode: null, autoScan: false });
  });

  it("removes only the launch keys and keeps share and tracking parameters", () => {
    expect(stripLaunchParams("?url=my-app.com&scan=1&s=94&g=A&utm_source=telegram")).toBe("?s=94&g=A&utm_source=telegram");
    expect(stripLaunchParams("?url=my-app.com&mode=url&scan=1")).toBe("");
    expect(stripLaunchParams("")).toBe("");
    expect(stripLaunchParams("?start=pay_quick")).toBe("?start=pay_quick");
  });

  it("builds a shareable, correctly encoded link", () => {
    expect(buildLaunchUrl(`${SITE}/`, { url: "https://my-app.com/a?b=1&c=2", autoScan: true })).toBe(
      `${SITE}/?url=https%3A%2F%2Fmy-app.com%2Fa%3Fb%3D1%26c%3D2&scan=1`,
    );
    expect(buildLaunchUrl(SITE, { url: "https://my-app.com" })).toBe(`${SITE}/?url=https%3A%2F%2Fmy-app.com`);
  });

  it("round-trips through the parser", () => {
    const link = new URL(buildLaunchUrl(SITE, { url: "https://my-app.com/x?y=1", autoScan: true }));
    expect(parseLaunchParams((key) => link.searchParams.get(key))).toEqual({ url: "https://my-app.com/x?y=1", mode: "url", autoScan: true });
  });
});

describe("scan insights and fix verification", () => {
  const before = resultWith([f("headers.csp", "warning", "CSP missing"), f("exposure.env", "critical", ".env exposed"), f("x.ok", "passed")], { scannedAt: "2026-11-18T10:00:00.000Z" });

  it("returns null on a first scan and stores a snapshot", () => {
    const storage = memoryStorage();
    expect(recordInsights(before, storage)).toBeNull();
    const stored = loadInsights(storage)["shop.example.com"];
    expect(stored?.current).toMatchObject({ score: before.overallScore, critical: 1, warning: 1 });
    expect(stored?.previous).toBeNull();
    expect(stored?.trend).toEqual([before.overallScore]);
    expect(stored?.openIssues).toEqual({ "headers.csp": "CSP missing", "exposure.env": ".env exposed" });
  });

  it("lists what was fixed, improved, still open and newly added", () => {
    const storage = memoryStorage();
    recordInsights(before, storage);
    const after = resultWith([f("headers.csp", "info", "CSP missing"), f("exposure.env", "passed"), f("cors.policy", "warning", "CORS reflects origins")], { scannedAt: "2026-11-20T10:00:00.000Z" });
    const verification = recordInsights(after, storage);
    expect(verification).toEqual({
      previousScannedAt: "2026-11-18T10:00:00.000Z",
      fixed: [".env exposed"],
      improved: ["CSP missing"],
      stillOpen: [],
      added: ["CORS reflects origins"],
    });
  });

  it("flags issues that are still open", () => {
    const verification = verifyFixes({ "headers.csp": "CSP missing" }, "2026-11-18T10:00:00.000Z", resultWith([f("headers.csp", "warning", "CSP missing")]));
    expect(verification.stillOpen).toEqual(["CSP missing"]);
    expect(verification.fixed).toEqual([]);
  });

  it("keeps a bounded score trend and a scan counter", () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_TREND_POINTS + 4; index += 1) {
      recordInsights(resultWith([f("a", index % 2 === 0 ? "warning" : "passed")], { scannedAt: `2026-11-${String(10 + index).padStart(2, "0")}T10:00:00.000Z` }), storage);
    }
    const stored = loadInsights(storage)["shop.example.com"];
    expect(stored?.trend).toHaveLength(MAX_TREND_POINTS);
    expect(stored?.scans).toBe(MAX_TREND_POINTS + 4);
  });

  it("does not touch the baseline history format", () => {
    const storage = memoryStorage();
    recordScanAndDiff(before, storage);
    const baseline = storage.data.get(HISTORY_STORAGE_KEY);
    recordInsights(before, storage);
    expect(storage.data.get(HISTORY_STORAGE_KEY)).toBe(baseline);
  });

  it("survives missing, corrupt or throwing storage", () => {
    expect(recordInsights(before, null)).toBeNull();
    expect(loadInsights(null)).toEqual({});
    const corrupt = memoryStorage();
    corrupt.data.set(INSIGHTS_STORAGE_KEY, "{not json");
    expect(loadInsights(corrupt)).toEqual({});
    expect(() => recordInsights(before, corrupt)).not.toThrow();
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => recordInsights(before, broken)).not.toThrow();
    expect(() => clearAllHistory(broken)).not.toThrow();
  });

  it("builds history rows with delta, trend and status", () => {
    const storage = memoryStorage();
    recordScanAndDiff(before, storage);
    recordInsights(before, storage);
    const better = resultWith([f("x", "passed")], { scannedAt: "2026-11-20T10:00:00.000Z" });
    recordScanAndDiff(better, storage);
    recordInsights(better, storage);
    const [row] = buildHistoryRows(loadHistory(storage), loadInsights(storage));
    expect(row).toMatchObject({ site: "shop.example.com", score: 100, delta: 100 - before.overallScore, status: "clear", scans: 2 });
    expect(row?.trend).toEqual([before.overallScore, 100]);
  });

  it("still lists sites scanned before insights existed", () => {
    const storage = memoryStorage();
    recordScanAndDiff(before, storage);
    const [row] = buildHistoryRows(loadHistory(storage), loadInsights(storage));
    expect(row).toMatchObject({ site: "shop.example.com", delta: null, scans: 1 });
    expect(row?.trend).toEqual([before.overallScore]);
  });

  it("classifies site status and clears everything", () => {
    expect(statusOf(1, 5)).toBe("critical");
    expect(statusOf(0, 2)).toBe("needs-work");
    expect(statusOf(0, 0)).toBe("clear");
    const storage = memoryStorage();
    recordScanAndDiff(before, storage);
    recordInsights(before, storage);
    clearAllHistory(storage);
    expect(loadHistory(storage)).toEqual({});
    expect(loadInsights(storage)).toEqual({});
  });
});

describe("report summary helpers", () => {
  const report = resultWith([f("a", "critical", "Leaked key"), f("b", "warning", "No CSP"), f("c", "info"), f("d", "passed")]);

  it("takes the first sentence and truncates long ones", () => {
    expect(firstSentence("First one. Second one.")).toBe("First one.");
    expect(firstSentence("no punctuation here")).toBe("no punctuation here");
    expect(firstSentence("x".repeat(400), 50)).toHaveLength(50);
  });

  it("prefers the explicit impact and falls back to the description", () => {
    expect(plainImpact({ ...f("a", "critical"), impact: "Attackers can do X." })).toBe("Attackers can do X.");
    expect(plainImpact(f("a", "critical", "Leaked key"))).toBe("Leaked key is a problem.");
  });

  it("builds severity rows with the points each severity cost", () => {
    expect(severityRows(report).map((row) => [row.severity, row.count, row.points])).toEqual([
      ["critical", 1, 20],
      ["warning", 1, 6],
      ["info", 1, 0],
      ["passed", 1, 0],
    ]);
  });

  it("orders the priority list critical first and skips info and passed", () => {
    expect(priorityFindings(report).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("writes a headline that matches the worst severity", () => {
    expect(buildOwnerSummary(report).headline).toContain("1 critical problem must be fixed");
    expect(buildOwnerSummary(resultWith([f("b", "warning"), f("c", "warning")])).headline).toContain("2 warnings need attention");
    expect(buildOwnerSummary(resultWith([f("d", "passed")])).headline).toBe("No critical problems or warnings found");
    expect(buildOwnerSummary(report).risks.map((risk) => risk.title)).toEqual(["Leaked key", "No CSP"]);
  });

  it("speaks about a build when the target is a build", () => {
    const build = resultWith([f("a", "warning")], { target: "build:game.apk", finalUrl: "build:game.apk" });
    expect(buildOwnerSummary(build).verdict).toContain("This build");
  });

  it("extracts concrete steps and the verify hint from a fix prompt, dropping boilerplate", () => {
    const prompt = createDemoReport().findings.find((item) => item.fixPrompt)?.fixPrompt ?? "";
    const steps = extractFixSteps(prompt);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.join(" ")).not.toContain("detect how this project is built");
    expect(steps.join(" ")).not.toContain("Keep the change minimal");
    expect(extractVerifyHint(prompt)).toBeTruthy();
    expect(extractFixSteps("")).toEqual([]);
    expect(extractVerifyHint("nothing here")).toBeNull();
  });

  it("builds a developer brief with the essentials", () => {
    const item = createDemoReport().findings.find((candidate) => candidate.severity === "critical");
    expect(item).toBeDefined();
    if (!item) return;
    const brief = buildDeveloperBrief(item, "https://shop.example.com");
    expect(brief).toContain("CRITICAL");
    expect(brief).toContain(item.title);
    expect(brief).toContain("What to do:");
    expect(brief).toContain("https://shop.example.com");
  });
});

describe("Markdown export", () => {
  const report = createDemoReport();

  it("includes summary metrics, severity breakdown, priority list and remediation steps", () => {
    const md = reportToMarkdown(report);
    expect(md).toContain("## Summary");
    expect(md).toContain(`**${report.overallScore}/100** (Grade ${report.grade})`);
    expect(md).toContain("### Severity breakdown");
    expect(md).toContain("| Critical | 1 | -20 |");
    expect(md).toContain("## Executive summary");
    expect(md).toContain("## Priority fix list");
    expect(md).toMatch(/- \[ \] \*\*CRITICAL\*\*: .+/);
    expect(md).toContain("**Remediation steps**");
    expect(md).toContain("**How to verify:**");
    expect(md).toContain("## Passed checks");
    expect(md).toContain("![ShipSafe Security Check]");
  });

  it("the owner export drops technical detail", () => {
    const md = reportToMarkdown(report, { audience: "owner" });
    expect(md).toContain("## Executive summary");
    expect(md).toContain("**What it means:**");
    expect(md).not.toContain("**Evidence**");
    expect(md).not.toContain("**Remediation steps**");
    expect(md).not.toContain("**AI fix prompt**");
    expect(md).not.toMatch(/\*\*Fix: /);
  });

  it("the developer export drops the executive summary but keeps the details", () => {
    const md = reportToMarkdown(report, { audience: "developer" });
    expect(md).not.toContain("## Executive summary");
    expect(md).toContain("**Evidence**");
    expect(md).toContain("**Remediation steps**");
    expect(md).toMatch(/\*\*Fix: .+\*\*/);
  });

  it("escapes pipes in table cells and never embeds raw secrets", () => {
    const hostile = resultWith([f("a", "critical", "Bad | title\nwith newline")]);
    const md = reportToMarkdown(hostile);
    expect(md).toContain("Bad \\| title with newline");
    expect(md).not.toMatch(/^\| .*Bad \| title/m);
  });

  it("handles a clean scan and a scan without findings", () => {
    expect(reportToMarkdown(resultWith([f("d", "passed")]))).not.toContain("## Priority fix list");
    expect(reportToMarkdown(resultWith([]))).toContain("No critical, warning or informational findings.");
  });

  it("builds file names that include the audience", () => {
    expect(markdownFileName(report)).toMatch(/^shipsafe-report-launchpad-demo\.example-\d{4}-\d{2}-\d{2}\.md$/);
    expect(markdownFileName(report, "owner")).toMatch(/-owner\.md$/);
  });
});

describe("badge options and snippets", () => {
  it("parses style and variant from allow-lists only", () => {
    expect(parseBadgeOptions(() => null)).toEqual({ style: "flat", variant: "full" });
    const values: Record<string, string> = { style: "flat-square", variant: "grade" };
    expect(parseBadgeOptions((key) => values[key])).toEqual({ style: "flat-square", variant: "grade" });
    const hostile: Record<string, string> = { style: '"><script>', variant: "javascript:1" };
    expect(parseBadgeOptions((key) => hostile[key])).toEqual({ style: "flat", variant: "full" });
  });

  it("renders the three variants and the square style", () => {
    expect(renderBadgeSvg({ score: 94, grade: "A" }, { variant: "grade" })).toContain(">Grade A<");
    expect(renderBadgeSvg({ score: 94, grade: "A" }, { variant: "score" })).toContain(">94/100<");
    const square = renderBadgeSvg({ score: 94, grade: "A" }, { style: "flat-square" });
    expect(square).toContain('rx="0"');
    expect(square).not.toContain('fill="url(#s)"');
    expect(renderBadgeSvg({ score: 94, grade: "A" })).toContain('rx="3"');
  });

  it("keeps default badge URLs unchanged and adds only non-default options", () => {
    expect(buildBadgeUrl(94, "A", SITE)).toBe(`${SITE}/api/badge?grade=A&score=94`);
    expect(buildBadgeUrl(94, "A", SITE, { style: "flat", variant: "full" })).toBe(`${SITE}/api/badge?grade=A&score=94`);
    expect(buildBadgeUrl(94, "A", SITE, { style: "flat-square", variant: "grade" })).toBe(`${SITE}/api/badge?grade=A&score=94&style=flat-square&variant=grade`);
  });

  it("builds a copy-ready snippet for every format", () => {
    const image = `${SITE}/api/badge?grade=B&score=88`;
    expect(buildBadgeSnippet("markdown", 88, "B", SITE)).toBe(`[![ShipSafe Security Check](${image})](${SITE})`);
    expect(buildBadgeSnippet("html", 88, "B", SITE)).toBe(`<a href="${SITE}"><img src="${image}" alt="ShipSafe Security Check: Grade B, 88/100" height="20"></a>`);
    expect(buildBadgeSnippet("rst", 88, "B", SITE)).toBe(`.. image:: ${image}\n   :target: ${SITE}\n   :alt: ShipSafe Security Check`);
    expect(buildBadgeSnippet("url", 88, "B", SITE)).toBe(image);
    expect(BADGE_FORMATS).toHaveLength(4);
  });
});
