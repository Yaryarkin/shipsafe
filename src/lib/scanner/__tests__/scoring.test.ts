import { describe, expect, it } from "vitest";
import { gradeFor, scoreFindings, sortFindings } from "../scoring";
import type { Finding, Severity } from "../types";
import { finding } from "../utils";

function make(severity: Severity, index = 0): Finding {
  return finding({
    id: `test.${severity}.${index}`,
    category: "headers",
    severity,
    title: `${severity} ${index}`,
    description: "test finding",
  });
}

function many(severity: Severity, count: number): Finding[] {
  return Array.from({ length: count }, (_, index) => make(severity, index));
}

describe("scoreFindings", () => {
  it("scores 100 / A with no findings", () => {
    const result = scoreFindings([]);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.summary).toEqual({ critical: 0, warning: 0, info: 0, passed: 0 });
  });

  it("deducts 6 per warning and nothing for info or passed", () => {
    const result = scoreFindings([...many("warning", 2), ...many("info", 5), ...many("passed", 10)]);
    expect(result.score).toBe(88);
    expect(result.grade).toBe("B");
    expect(result.summary).toEqual({ critical: 0, warning: 2, info: 5, passed: 10 });
  });

  it("deducts 20 per critical", () => {
    expect(scoreFindings(many("critical", 2)).score).toBe(60);
    expect(scoreFindings(many("critical", 3)).score).toBe(40);
  });

  it("caps the score at 69 when any critical finding is present", () => {
    const result = scoreFindings([make("critical"), ...many("passed", 20)]);
    expect(result.score).toBe(69);
    expect(result.grade).toBe("D");
  });

  it("never goes below 0", () => {
    const result = scoreFindings(many("critical", 10));
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });

  it("combines critical and warning deductions below the cap", () => {
    // 100 - 20 - 3*6 = 62
    expect(scoreFindings([make("critical"), ...many("warning", 3)]).score).toBe(62);
  });
});

describe("gradeFor", () => {
  it.each([
    [100, "A"],
    [90, "A"],
    [89, "B"],
    [80, "B"],
    [79, "C"],
    [70, "C"],
    [69, "D"],
    [60, "D"],
    [59, "F"],
    [0, "F"],
  ] as const)("score %i → grade %s", (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });
});

describe("sortFindings", () => {
  it("orders critical → warning → info → passed without mutating the input", () => {
    const input = [make("passed"), make("info"), make("critical"), make("warning")];
    const sorted = sortFindings(input);
    expect(sorted.map((item) => item.severity)).toEqual(["critical", "warning", "info", "passed"]);
    expect(input[0]?.severity).toBe("passed");
  });
});
