// ShipSafe GitHub Action: scans a deployed site through the public ShipSafe API and fails the job
// when it finds critical issues. Plain ESM with no dependencies, so it runs on any runner that has Node 20+.
//
// Only the URL you ask us to scan is sent to ShipSafe. The scan itself is passive (GET / HEAD requests).
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_API_URL = "https://shipsafe-six-iota.vercel.app";
export const FAIL_ON_VALUES = ["critical", "warning", "none"];
const MAX_RETRY_WAIT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Strips control characters and collapses whitespace so untrusted text can't break log lines. */
export function oneLine(value, max = 200) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Escapes a workflow-command message ("::error::…") the way GitHub documents it. */
export function escapeCommandData(value) {
  return oneLine(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escapes text for a Markdown table cell in the job summary. */
export function escapeMarkdownCell(value) {
  return oneLine(value, 160).replace(/[\\`*_{}[\]<>|]/g, (char) => `\\${char}`);
}

/**
 * Reads and validates the action inputs (passed as INPUT_* environment variables, never interpolated
 * into a shell script). Returns { ok: true, value } or { ok: false, error }.
 */
export function parseInputs(env) {
  const url = (env.INPUT_URL ?? "").trim();
  if (!url) return { ok: false, error: "Input 'url' is required, e.g. https://your-app.com" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Input 'url' is not a valid URL: ${oneLine(url, 80)}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Input 'url' must start with http:// or https://" };
  }
  if (url.length > 2048) return { ok: false, error: "Input 'url' is too long." };

  const failOn = (env.INPUT_FAIL_ON ?? "critical").trim().toLowerCase() || "critical";
  if (!FAIL_ON_VALUES.includes(failOn)) {
    return { ok: false, error: `Input 'fail-on' must be one of: ${FAIL_ON_VALUES.join(", ")}` };
  }

  const rawMin = (env.INPUT_MIN_SCORE ?? "0").trim() || "0";
  if (!/^\d{1,3}$/.test(rawMin) || Number(rawMin) > 100) {
    return { ok: false, error: "Input 'min-score' must be a whole number from 0 to 100." };
  }

  const apiUrl = ((env.INPUT_API_URL ?? "").trim() || DEFAULT_API_URL).replace(/\/+$/, "");
  let api;
  try {
    api = new URL(apiUrl);
  } catch {
    return { ok: false, error: "Input 'api-url' is not a valid URL." };
  }
  const isLocal = api.hostname === "localhost" || api.hostname === "127.0.0.1";
  if (api.protocol !== "https:" && !(isLocal && api.protocol === "http:")) {
    return { ok: false, error: "Input 'api-url' must use https://." };
  }

  return { ok: true, value: { url, failOn, minScore: Number(rawMin), apiUrl } };
}

/** Decides pass / fail from a scan result. */
export function evaluate(result, { failOn, minScore }) {
  const { critical = 0, warning = 0 } = result.summary ?? {};
  const reasons = [];
  if (failOn === "critical" && critical > 0) reasons.push(`${critical} critical ${critical === 1 ? "issue" : "issues"} found`);
  if (failOn === "warning" && critical + warning > 0) {
    reasons.push(`${critical + warning} ${critical + warning === 1 ? "issue" : "issues"} found (critical or warning)`);
  }
  if (minScore > 0 && result.overallScore < minScore) {
    reasons.push(`score ${result.overallScore} is below the required minimum of ${minScore}`);
  }
  return { passed: reasons.length === 0, reasons };
}

/** Markdown for the job summary page. */
export function renderSummary(result, evaluation, inputs) {
  const { critical = 0, warning = 0, info = 0, passed = 0 } = result.summary ?? {};
  const issues = (result.findings ?? []).filter((finding) => finding.severity === "critical" || finding.severity === "warning");
  const lines = [
    `## ShipSafe security check ${evaluation.passed ? "passed" : "failed"}`,
    "",
    `**${escapeMarkdownCell(result.target ?? inputs.url)}** · score **${result.overallScore}/100** · grade **${result.grade}**`,
    "",
    "| Critical | Warnings | Info | Passed |",
    "| ---: | ---: | ---: | ---: |",
    `| ${critical} | ${warning} | ${info} | ${passed} |`,
    "",
  ];
  if (!evaluation.passed) {
    lines.push(...evaluation.reasons.map((reason) => `- ${escapeMarkdownCell(reason)}`), "");
  }
  if (issues.length > 0) {
    lines.push("| Severity | Finding | Category |", "| --- | --- | --- |");
    for (const finding of issues.slice(0, 30)) {
      lines.push(`| ${finding.severity} | ${escapeMarkdownCell(finding.title)} | ${escapeMarkdownCell(finding.category)} |`);
    }
    if (issues.length > 30) lines.push("", `…and ${issues.length - 30} more.`);
    lines.push("");
  }
  lines.push(`Open the full report with fix prompts at ${inputs.apiUrl}`);
  return lines.join("\n");
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls POST /api/scan. Retries on 429 (honouring Retry-After, capped), 5xx and network errors, because
 * GitHub runners share IP addresses and the API rate-limits per IP.
 */
export async function runScan({ url, apiUrl }, { fetchImpl = fetch, sleep = defaultSleep, attempts = 3, log = () => {} } = {}) {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let waitMs = 2_000 * attempt;
    try {
      const response = await fetchImpl(`${apiUrl}/api/scan`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "shipsafe-github-action" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body && typeof body.overallScore === "number" && body.summary) return { ok: true, result: body };

      const message = oneLine(body?.error?.message ?? `HTTP ${response.status}`);
      lastError = `${message} (HTTP ${response.status})`;
      if (response.status === 429) {
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) waitMs = Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS);
      } else if (response.status < 500) {
        // 400 / 422 (bad or blocked URL) will not fix themselves.
        return { ok: false, error: lastError, retryable: false };
      }
    } catch (error) {
      lastError = oneLine(error instanceof Error ? error.message : error);
    }
    if (attempt < attempts) {
      log(`Scan attempt ${attempt} failed (${lastError}); retrying in ${Math.round(waitMs / 1000)}s…`);
      await sleep(waitMs);
    }
  }
  return { ok: false, error: lastError, retryable: true };
}

/** Runs the whole action. Returns the process exit code. `io` is injectable for tests. */
export async function main(env = process.env, io = {}) {
  const log = io.log ?? ((line) => console.log(line));
  const writeFile = io.appendFile ?? appendFileSync;
  const runner = io.runScan ?? runScan;

  const parsed = parseInputs(env);
  if (!parsed.ok) {
    log(`::error title=ShipSafe::${escapeCommandData(parsed.error)}`);
    return 2;
  }
  const inputs = parsed.value;
  log(`ShipSafe: scanning ${oneLine(inputs.url, 120)} (fail-on: ${inputs.failOn}, min-score: ${inputs.minScore})`);

  const scan = await runner(inputs, { log });
  if (!scan.ok) {
    log(`::error title=ShipSafe scan failed::${escapeCommandData(scan.error)}`);
    return 2;
  }
  const result = scan.result;
  const evaluation = evaluate(result, inputs);

  const { critical = 0, warning = 0, info = 0, passed = 0 } = result.summary;
  log(`Score ${result.overallScore}/100 · grade ${result.grade} · ${critical} critical · ${warning} warnings · ${info} info · ${passed} passed`);
  for (const finding of result.findings ?? []) {
    if (finding.severity === "critical") log(`::error title=ShipSafe critical::${escapeCommandData(finding.title)}`);
    else if (finding.severity === "warning") log(`::warning title=ShipSafe warning::${escapeCommandData(finding.title)}`);
  }

  // Outputs hold only numbers and a one-letter grade, so they are safe to write unescaped.
  if (env.GITHUB_OUTPUT) {
    writeFile(
      env.GITHUB_OUTPUT,
      `score=${result.overallScore}\ngrade=${oneLine(result.grade, 2)}\ncritical=${critical}\nwarnings=${warning}\npassed=${evaluation.passed}\n`,
    );
  }
  if (env.GITHUB_STEP_SUMMARY) writeFile(env.GITHUB_STEP_SUMMARY, `${renderSummary(result, evaluation, inputs)}\n`);

  if (!evaluation.passed) {
    for (const reason of evaluation.reasons) log(`::error title=ShipSafe check failed::${escapeCommandData(reason)}`);
    return 1;
  }
  log("ShipSafe check passed.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
