import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_URL,
  escapeCommandData,
  escapeMarkdownCell,
  evaluate,
  main,
  oneLine,
  parseInputs,
  renderSummary,
  runScan,
  type ScanResultLike,
} from "../../../action/check.mjs";

const clean: ScanResultLike = {
  target: "https://my-app.com/",
  overallScore: 96,
  grade: "A",
  summary: { critical: 0, warning: 0, info: 1, passed: 12 },
  findings: [],
};

const dirty: ScanResultLike = {
  target: "https://my-app.com/",
  overallScore: 42,
  grade: "F",
  summary: { critical: 2, warning: 1, info: 0, passed: 8 },
  findings: [
    { severity: "critical", title: "Exposed /.env file", category: "exposure" },
    { severity: "critical", title: "Stripe key in bundle", category: "secrets" },
    { severity: "warning", title: "CSP is missing", category: "headers" },
  ],
};

const noSleep = async () => {};

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("parseInputs", () => {
  it("requires a url and applies defaults", () => {
    expect(parseInputs({}).ok).toBe(false);
    const parsed = parseInputs({ INPUT_URL: " https://my-app.com " });
    expect(parsed).toEqual({
      ok: true,
      value: { url: "https://my-app.com", failOn: "critical", minScore: 0, apiUrl: DEFAULT_API_URL },
    });
  });

  it.each(["not a url", "ftp://my-app.com", "javascript:alert(1)", "file:///etc/passwd"])("rejects url %s", (url) => {
    expect(parseInputs({ INPUT_URL: url }).ok).toBe(false);
  });

  it("validates fail-on and min-score", () => {
    const base = { INPUT_URL: "https://my-app.com" };
    expect(parseInputs({ ...base, INPUT_FAIL_ON: "WARNING" })).toMatchObject({ ok: true, value: { failOn: "warning" } });
    expect(parseInputs({ ...base, INPUT_FAIL_ON: "everything" }).ok).toBe(false);
    expect(parseInputs({ ...base, INPUT_MIN_SCORE: "80" })).toMatchObject({ ok: true, value: { minScore: 80 } });
    for (const bad of ["101", "-1", "8.5", "abc", "1000"]) expect(parseInputs({ ...base, INPUT_MIN_SCORE: bad }).ok).toBe(false);
  });

  it("only accepts an https api-url (http only for localhost)", () => {
    const base = { INPUT_URL: "https://my-app.com" };
    expect(parseInputs({ ...base, INPUT_API_URL: "https://shipsafe.example.com/" })).toMatchObject({
      ok: true,
      value: { apiUrl: "https://shipsafe.example.com" },
    });
    expect(parseInputs({ ...base, INPUT_API_URL: "http://evil.example.com" }).ok).toBe(false);
    expect(parseInputs({ ...base, INPUT_API_URL: "http://localhost:3000" }).ok).toBe(true);
  });
});

describe("evaluate", () => {
  it("passes a clean site and fails on critical by default", () => {
    expect(evaluate(clean, { failOn: "critical", minScore: 0 })).toEqual({ passed: true, reasons: [] });
    const failed = evaluate(dirty, { failOn: "critical", minScore: 0 });
    expect(failed.passed).toBe(false);
    expect(failed.reasons).toEqual(["2 critical issues found"]);
  });

  it("fail-on warning also fails on warnings, fail-on none never fails on findings", () => {
    const onlyWarning: ScanResultLike = { ...clean, summary: { critical: 0, warning: 1, info: 0, passed: 5 } };
    expect(evaluate(onlyWarning, { failOn: "critical", minScore: 0 }).passed).toBe(true);
    expect(evaluate(onlyWarning, { failOn: "warning", minScore: 0 }).reasons).toEqual(["1 issue found (critical or warning)"]);
    expect(evaluate(dirty, { failOn: "none", minScore: 0 }).passed).toBe(true);
  });

  it("enforces a minimum score independently", () => {
    expect(evaluate(clean, { failOn: "none", minScore: 90 }).passed).toBe(true);
    expect(evaluate(clean, { failOn: "none", minScore: 97 }).reasons).toEqual(["score 96 is below the required minimum of 97"]);
    expect(evaluate(dirty, { failOn: "critical", minScore: 80 }).reasons).toHaveLength(2);
  });
});

describe("escaping untrusted text", () => {
  it("collapses newlines and control characters", () => {
    expect(oneLine("a\nb\r\n\tc\u0000d")).toBe("a b c d");
    expect(oneLine("x".repeat(500), 20)).toHaveLength(20);
  });

  it("cannot inject extra workflow commands through a finding title", () => {
    const evil = "Server: nginx\n::set-env name=PWNED::1\n::error::fake";
    const escaped = escapeCommandData(evil);
    expect(escaped).not.toContain("\n");
    expect(escaped.startsWith("::")).toBe(false);
    expect(escapeCommandData("100% sure")).toBe("100%25 sure");
  });

  it("neutralizes markdown and html in the job summary", () => {
    const cell = escapeMarkdownCell("<img src=x onerror=alert(1)> | `code` *bold*");
    expect(cell).not.toMatch(/(^|[^\\])[<>|`*]/);
  });
});

describe("renderSummary", () => {
  it("lists counts, failure reasons and issues", () => {
    const evaluation = evaluate(dirty, { failOn: "critical", minScore: 0 });
    const text = renderSummary(dirty, evaluation, { url: "https://my-app.com", apiUrl: DEFAULT_API_URL });
    expect(text).toContain("ShipSafe security check failed");
    expect(text).toContain("score **42/100** · grade **F**");
    expect(text).toContain("| 2 | 1 | 0 | 8 |");
    expect(text).toContain("2 critical issues found");
    expect(text).toContain("| critical | Exposed /.env file | exposure |");
    expect(text).toContain(DEFAULT_API_URL);
  });

  it("is short and positive for a clean site", () => {
    const text = renderSummary(clean, { passed: true, reasons: [] }, { url: "https://my-app.com", apiUrl: DEFAULT_API_URL });
    expect(text).toContain("passed");
    expect(text).not.toContain("| Severity |");
  });
});

describe("runScan", () => {
  const inputs = { url: "https://my-app.com", apiUrl: "https://api.example.com" };

  it("posts the url to /api/scan and returns the result", async () => {
    const fetchImpl = vi.fn(async () => response(200, clean)) as unknown as typeof fetch;
    const outcome = await runScan(inputs, { fetchImpl, sleep: noSleep });
    expect(outcome).toEqual({ ok: true, result: clean });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/scan");
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://my-app.com" });
  });

  it("retries 429 using Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429, { error: { code: "RATE_LIMITED", message: "Too many" } }, { "retry-after": "7" }))
      .mockResolvedValueOnce(response(200, clean)) as unknown as typeof fetch;
    const outcome = await runScan(inputs, { fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(outcome.ok).toBe(true);
    expect(sleeps).toEqual([7_000]);
  });

  it("caps an excessive Retry-After", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429, { error: { message: "slow down" } }, { "retry-after": "600" }))
      .mockResolvedValueOnce(response(200, clean)) as unknown as typeof fetch;
    await runScan(inputs, { fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([30_000]);
  });

  it("does not retry a rejected url (4xx)", async () => {
    const fetchImpl = vi.fn(async () => response(422, { error: { code: "BLOCKED_TARGET", message: "Private address" } })) as unknown as typeof fetch;
    const outcome = await runScan(inputs, { fetchImpl, sleep: noSleep });
    expect(outcome).toMatchObject({ ok: false, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and gives up after the attempt limit", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ETIMEDOUT");
    }) as unknown as typeof fetch;
    const outcome = await runScan(inputs, { fetchImpl, sleep: noSleep, attempts: 3 });
    expect(outcome).toMatchObject({ ok: false, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a malformed 200 body as a failure", async () => {
    const fetchImpl = vi.fn(async () => response(200, { hello: "world" })) as unknown as typeof fetch;
    const outcome = await runScan(inputs, { fetchImpl, sleep: noSleep, attempts: 1 });
    expect(outcome.ok).toBe(false);
  });
});

describe("main", () => {
  const baseEnv = { INPUT_URL: "https://my-app.com", GITHUB_OUTPUT: "/tmp/out", GITHUB_STEP_SUMMARY: "/tmp/summary" };

  function harness(result: ScanResultLike | null, error = "boom") {
    const lines: string[] = [];
    const files: Record<string, string> = {};
    const io = {
      log: (line: string) => void lines.push(line),
      appendFile: (file: string, data: string) => void (files[file] = (files[file] ?? "") + data),
      runScan: async () => (result ? { ok: true as const, result } : { ok: false as const, error, retryable: true }),
    };
    return { lines, files, io };
  }

  it("exits 0 and writes outputs and a summary for a clean site", async () => {
    const { lines, files, io } = harness(clean);
    expect(await main(baseEnv, io)).toBe(0);
    expect(files["/tmp/out"]).toBe("score=96\ngrade=A\ncritical=0\nwarnings=0\npassed=true\n");
    expect(files["/tmp/summary"]).toContain("passed");
    expect(lines.at(-1)).toBe("ShipSafe check passed.");
  });

  it("exits 1 with annotations for a dirty site", async () => {
    const { lines, files, io } = harness(dirty);
    expect(await main(baseEnv, io)).toBe(1);
    expect(lines).toContain("::error title=ShipSafe critical::Exposed /.env file");
    expect(lines).toContain("::warning title=ShipSafe warning::CSP is missing");
    expect(lines).toContain("::error title=ShipSafe check failed::2 critical issues found");
    expect(files["/tmp/out"]).toContain("passed=false");
  });

  it("report-only mode never fails on findings", async () => {
    const { io } = harness(dirty);
    expect(await main({ ...baseEnv, INPUT_FAIL_ON: "none" }, io)).toBe(0);
  });

  it("exits 2 on bad input or when the scan itself fails (not a silent pass)", async () => {
    const bad = harness(clean);
    expect(await main({ INPUT_URL: "nope" }, bad.io)).toBe(2);
    expect(bad.lines[0]).toContain("::error title=ShipSafe::");

    const failed = harness(null, "HTTP 503");
    expect(await main(baseEnv, failed.io)).toBe(2);
    expect(failed.lines.some((line) => line.includes("scan failed") && line.includes("HTTP 503"))).toBe(true);
  });

  it("neutralizes a hostile finding title in the log", async () => {
    const hostile: ScanResultLike = {
      ...dirty,
      findings: [{ severity: "critical", title: "x\n::add-mask::secret\nline", category: "exposure" }],
    };
    const { lines, io } = harness(hostile);
    await main(baseEnv, io);
    expect(lines.filter((line) => line.startsWith("::add-mask::"))).toEqual([]);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
  });
});
