import { describe, expect, it } from "vitest";
import { buildFixPrompt, formatBytes, maskSecret, truncate } from "../utils";

// Dummy values are assembled at runtime so no secret-shaped literal exists in the source.
const live = ["sk", "live", ""].join("_");
const test = ["rk", "test", ""].join("_");

describe("maskSecret", () => {
  it("keeps the provider prefix and last 4 characters of Stripe-style keys", () => {
    expect(maskSecret(`${live}${"A".repeat(20)}1234`)).toBe(`${live}****1234`);
    expect(maskSecret(`${test}${"b".repeat(24)}9f3A`)).toBe(`${test}****9f3A`);
  });

  it("shows at most 8 leading characters for generic secrets", () => {
    const value = `ghp_${"x".repeat(32)}WXYZ`;
    const masked = maskSecret(value);
    expect(masked).toBe(`ghp_xxxx****WXYZ`);
  });

  it("uses a shorter prefix for shorter secrets", () => {
    expect(maskSecret(["AK", "IA", "ABCDEFGHIJKLMNOP"].join(""))).toBe("AKIAA****MNOP");
  });

  it("hides almost everything for very short values", () => {
    expect(maskSecret("short")).toBe("sh****");
    expect(maskSecret("0123456789")).toBe("01****");
  });

  it("never returns the full input", () => {
    for (const value of [`${live}${"Z".repeat(30)}`, "abcdefghijklmnopqrstuvwxyz", "1234567890ab"]) {
      const masked = maskSecret(value);
      expect(masked).not.toBe(value);
      expect(masked).toContain("****");
      expect(masked.length).toBeLessThan(value.length);
    }
  });
});

describe("helpers", () => {
  it("truncates long strings with an ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });

  it("builds numbered fix prompts that start with stack detection", () => {
    const prompt = buildFixPrompt({
      site: "https://example.com",
      issue: "Issue X",
      goal: "Goal Y",
      steps: ["Do A", "Do B"],
      verify: "Check Z",
    });
    expect(prompt).toContain("(https://example.com)");
    expect(prompt).toContain("Issue: Issue X");
    expect(prompt).toMatch(/1\. First, detect how this project is built/);
    expect(prompt).toContain("2. Do A");
    expect(prompt).toContain("3. Do B");
    expect(prompt).toContain("How I'll verify: Check Z");
  });
});
