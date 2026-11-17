import { describe, expect, it } from "vitest";
import {
  computeScanDiff,
  describeScanDiff,
  HISTORY_STORAGE_KEY,
  historyKey,
  isMeaningfulDiff,
  loadHistory,
  MAX_HISTORY_ENTRIES,
  recordScanAndDiff,
  toStoredScan,
  type KeyValueStorage,
} from "../scan-history";
import { scoreFindings } from "../scanner/scoring";
import type { Finding, ScanResult, Severity } from "../scanner/types";
import { buildShareText } from "../share";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function scan(findings: Array<[string, Severity]>, options: { url?: string; at?: string } = {}): ScanResult {
  const list: Finding[] = findings.map(([id, severity]) => ({
    id,
    category: "headers",
    severity,
    title: id,
    description: id,
    evidence: "",
    fixPrompt: "",
  }));
  const { score, grade, summary } = scoreFindings(list);
  const url = options.url ?? "https://my-app.com/";
  return {
    target: url,
    finalUrl: url,
    scannedAt: options.at ?? "2026-11-17T10:00:00.000Z",
    overallScore: score,
    grade,
    scanDurationMs: 1_000,
    summary,
    findings: list,
  };
}

// Before: 1 critical + 3 warnings → 100 - 20 - 18 = 62 → capped stays 62 (D)
const BEFORE = scan(
  [
    ["secrets.stripe-live", "critical"],
    ["headers.csp", "warning"],
    ["transport.hsts", "warning"],
    ["cookies.httponly", "warning"],
    ["headers.nosniff", "passed"],
  ],
  { at: "2026-11-17T10:00:00.000Z" },
);

// After: stripe fixed (gone), HSTS + cookies fixed (passed), CSP still warning, new frame warning
const AFTER = scan(
  [
    ["headers.csp", "warning"],
    ["transport.hsts", "passed"],
    ["cookies.httponly", "passed"],
    ["headers.nosniff", "passed"],
    ["headers.framing", "warning"],
  ],
  { at: "2026-11-17T11:00:00.000Z" },
);

describe("computeScanDiff", () => {
  it("computes score delta, previous score/grade, fixed and new issues", () => {
    expect(BEFORE.overallScore).toBe(62);
    expect(AFTER.overallScore).toBe(88);
    expect(computeScanDiff(toStoredScan(BEFORE), AFTER)).toEqual({
      previousScore: 62,
      previousGrade: "D",
      previousScannedAt: "2026-11-17T10:00:00.000Z",
      scoreDelta: 26,
      fixedCount: 3, // stripe (gone) + hsts + cookies (now passed)
      newIssuesCount: 1, // framing
    });
  });

  it("does not count a warning that only became info as fixed, nor as new", () => {
    const before = scan([["headers.csp", "warning"]]);
    const after = scan([["headers.csp", "info"]]);
    const diff = computeScanDiff(toStoredScan(before), after);
    expect(diff.fixedCount).toBe(0);
    expect(diff.newIssuesCount).toBe(0);
    expect(diff.scoreDelta).toBe(6);
  });

  it("reports regressions with a negative delta", () => {
    const diff = computeScanDiff(toStoredScan(AFTER), BEFORE);
    expect(diff.scoreDelta).toBe(-26);
    expect(diff.newIssuesCount).toBe(3);
  });

  it("is not meaningful when nothing changed", () => {
    const diff = computeScanDiff(toStoredScan(AFTER), AFTER);
    expect(diff).toMatchObject({ scoreDelta: 0, fixedCount: 0, newIssuesCount: 0 });
    expect(isMeaningfulDiff(diff)).toBe(false);
    expect(isMeaningfulDiff(null)).toBe(false);
    expect(isMeaningfulDiff({ ...diff, fixedCount: 1 })).toBe(true);
  });
});

describe("describeScanDiff", () => {
  it("renders the compact badge text", () => {
    expect(describeScanDiff(computeScanDiff(toStoredScan(BEFORE), AFTER), AFTER.overallScore, AFTER.grade)).toBe(
      "62 (D) → 88 (B) · +26 pts · 3 issues fixed · 1 new issue",
    );
  });

  it("handles singulars, negative deltas and omits zero parts", () => {
    const diff = { previousScore: 94, previousGrade: "A" as const, previousScannedAt: "x", scoreDelta: -6, fixedCount: 1, newIssuesCount: 0 };
    expect(describeScanDiff(diff, 88, "B")).toBe("94 (A) → 88 (B) · -6 pts · 1 issue fixed");
    expect(describeScanDiff({ ...diff, scoreDelta: 0, fixedCount: 0, newIssuesCount: 2 }, 94, "A")).toBe("94 (A) → 94 (A) · 2 new issues");
  });
});

describe("historyKey", () => {
  it("ignores protocol, www, case, query, hash and trailing slash", () => {
    const key = historyKey("https://my-app.com/");
    for (const url of ["http://my-app.com", "https://WWW.My-App.com/", "https://my-app.com/?ref=x#top", "https://my-app.com//"]) {
      expect(historyKey(url)).toBe(key);
    }
  });

  it("keeps distinct paths and ports apart", () => {
    expect(historyKey("https://my-app.com/app")).not.toBe(historyKey("https://my-app.com/"));
    expect(historyKey("https://my-app.com:8443/")).not.toBe(historyKey("https://my-app.com/"));
  });
});

describe("recordScanAndDiff (localStorage)", () => {
  it("returns null on the first scan and stores a baseline", () => {
    const storage = memoryStorage();
    expect(recordScanAndDiff(BEFORE, storage)).toBeNull();
    const stored = loadHistory(storage)[historyKey(BEFORE.finalUrl)];
    expect(stored).toEqual({
      score: 62,
      grade: "D",
      findingIds: ["secrets.stripe-live", "headers.csp", "transport.hsts", "cookies.httponly", "headers.nosniff"],
      issueIds: ["secrets.stripe-live", "headers.csp", "transport.hsts", "cookies.httponly"],
      scannedAt: "2026-11-17T10:00:00.000Z",
    });
  });

  it("diffs against the previous scan of the same site, then overwrites it", () => {
    const storage = memoryStorage();
    recordScanAndDiff(BEFORE, storage);
    const diff = recordScanAndDiff({ ...AFTER, finalUrl: "http://www.my-app.com" }, storage);
    expect(diff).toMatchObject({ previousScore: 62, scoreDelta: 26, fixedCount: 3 });
    expect(loadHistory(storage)[historyKey(BEFORE.finalUrl)]?.score).toBe(88);
  });

  it("keeps different sites separate", () => {
    const storage = memoryStorage();
    recordScanAndDiff(BEFORE, storage);
    expect(recordScanAndDiff({ ...AFTER, finalUrl: "https://other.dev/" }, storage)).toBeNull();
  });

  it(`caps history at the ${MAX_HISTORY_ENTRIES} most recently scanned sites`, () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 5; index += 1) {
      const at = new Date(Date.UTC(2026, 10, 17, 0, index)).toISOString();
      recordScanAndDiff(scan([["headers.csp", "warning"]], { url: `https://site-${index}.dev/`, at }), storage);
    }
    const keys = Object.keys(loadHistory(storage));
    expect(keys).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(keys).not.toContain("site-0.dev");
    expect(keys).toContain(`site-${MAX_HISTORY_ENTRIES + 4}.dev`);
  });

  it("treats corrupted or tampered storage as empty", () => {
    for (const raw of ["not json", "[]", JSON.stringify({ "my-app.com": { score: "hacked" } })]) {
      const storage = memoryStorage({ [HISTORY_STORAGE_KEY]: raw });
      expect(loadHistory(storage)).toEqual({});
      expect(recordScanAndDiff(BEFORE, storage)).toBeNull();
    }
  });

  it("never throws when storage is unavailable or full", () => {
    expect(recordScanAndDiff(BEFORE, null)).toBeNull();
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => recordScanAndDiff(BEFORE, broken)).not.toThrow();
  });
});

describe("buildShareText with a scan diff", () => {
  const SITE = "https://shipsafe-six-iota.vercel.app";

  it("highlights the upgrade when the score improved", () => {
    expect(buildShareText(94, "A", SITE, { scoreDelta: 32, previousScore: 62 })).toBe(
      "Upgraded my site from 62 to 94/100 (Grade A) on ShipSafe's 15-second pre-launch security check: https://shipsafe-six-iota.vercel.app",
    );
  });

  it.each([
    ["no diff", null],
    ["unchanged score", { scoreDelta: 0, previousScore: 94 }],
    ["regression", { scoreDelta: -6, previousScore: 100 }],
  ])("falls back to the normal text for %s", (_, diff) => {
    expect(buildShareText(94, "A", SITE, diff)).toBe(
      "My site scored 94/100 (Grade A) on ShipSafe's 15-second pre-launch security check: https://shipsafe-six-iota.vercel.app",
    );
  });

  it("still fits in one X post", () => {
    expect(buildShareText(100, "A", SITE, { scoreDelta: 100, previousScore: 0 }).length).toBeLessThanOrEqual(280);
  });
});
