import { buildBadgeMarkdown } from "@/lib/badge";
import { buildFixQueue, EFFORT_LABELS, queueByTier, sortByPriority, TIER_HINTS, TIER_LABELS } from "@/lib/fix-queue";
import { buildStackConfigs } from "@/lib/config-generator";
import { assessReadiness } from "@/lib/readiness";
import { buildOwnerSummary, extractFixSteps, extractVerifyHint, plainImpact, severityRows } from "@/lib/report-summary";
import { displayTarget, isBuildTarget } from "@/lib/scan-target";
import { describeDetections } from "@/lib/scanner/stack";
import { CATEGORY_LABELS, type Finding, type ScanResult, type Severity } from "@/lib/scanner/types";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
  passed: "PASSED",
};

/** `full` is the complete report; `owner` leaves out technical detail; `developer` leaves out the executive summary. */
export type MarkdownAudience = "full" | "owner" | "developer";

export interface MarkdownOptions {
  audience?: MarkdownAudience;
}

function fence(content: string, lang = ""): string {
  // Use a fence longer than any backtick run inside the content.
  const longestRun = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longestRun + 1);
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

/** Keeps user-controlled text from breaking a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function summarySection(result: ScanResult): string[] {
  const host = displayTarget(result.target);
  const lines = [
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    isBuildTarget(result.target) ? `| Build | ${cell(host)} (scanned locally in the browser, nothing was uploaded) |` : `| Target | ${cell(result.target)} |`,
  ];
  if (!isBuildTarget(result.target) && result.finalUrl !== result.target) lines.push(`| Final URL | ${cell(result.finalUrl)} |`);
  lines.push(
    `| Launch readiness | **${assessReadiness(result).label}** |`,
    `| Score | **${result.overallScore}/100** (Grade ${result.grade}) |`,
    ...(result.detectedStack?.length ? [`| Detected stack | ${cell(describeDetections(result.detectedStack))} |`] : []),
    `| Scanned at | ${new Date(result.scannedAt).toUTCString()} |`,
    `| Scan duration | ${(result.scanDurationMs / 1000).toFixed(1)}s |`,
    "",
    "### Severity breakdown",
    "",
    "| Severity | Count | Points lost |",
    "| --- | ---: | ---: |",
    ...severityRows(result).map((row) => `| ${row.label} | ${row.count} | ${row.points > 0 ? `-${row.points}` : "0"} |`),
    "",
  );
  const cap = result.scoreBreakdown?.criticalCap;
  if (typeof cap === "number") lines.push(`> A critical finding caps the score at ${cap}, whatever the other results.`, "");
  return lines;
}

function executiveSection(result: ScanResult): string[] {
  const summary = buildOwnerSummary(result);
  const lines = ["## Executive summary", "", `**${summary.headline}.**`, "", summary.verdict, ""];
  if (summary.risks.length > 0) {
    lines.push("Biggest risks:", "");
    for (const risk of summary.risks) lines.push(`- **${cell(risk.title)}**: ${cell(risk.impact)}`);
    lines.push("");
  }
  lines.push(`**Next step:** ${summary.nextStep}`, "");
  return lines;
}

function readinessSection(result: ScanResult): string[] {
  const gate = assessReadiness(result);
  const lines = ["## Pre-launch readiness", "", `**${gate.label}.** ${gate.headline}`, "", ...gate.reasons.map((reason) => `- ${reason}`), ""];
  if (gate.unlock) lines.push(`**To unlock:** ${gate.unlock}`, "");
  return lines;
}

function prioritySection(result: ScanResult): string[] {
  const queue = buildFixQueue(result.findings);
  if (queue.length === 0) return [];
  const lines = ["## Priority fix list", ""];
  for (const group of queueByTier(queue)) {
    lines.push(`### ${TIER_LABELS[group.tier]}`, "", `_${TIER_HINTS[group.tier]}_`, "");
    for (const item of group.items) {
      lines.push(`- [ ] **${SEVERITY_LABEL[item.severity]}**: ${cell(item.title)} (${CATEGORY_LABELS[item.category]}) · ${EFFORT_LABELS[item.effort]}`);
    }
    lines.push("");
  }
  return lines;
}

/** The unified config for the detected (or first) stack, so the export carries the "fix it all" file too. */
function configSection(result: ScanResult): string[] {
  const config = buildStackConfigs(result)[0];
  if (!config) return [];
  return [`## Fix it all in one file: ${config.label}`, "", `\`${config.filename}\` resolves ${config.covers.length} finding${config.covers.length === 1 ? "" : "s"}.`, "", fence(config.code, config.language), "", ...config.notes.map((note) => `- ${note}`), ""];
}

function findingSection(item: Finding, index: number, audience: MarkdownAudience): string[] {
  const technical = audience !== "owner";
  const lines = [`### ${index}. [${SEVERITY_LABEL[item.severity]}] ${item.title}`, "", `**Category:** ${CATEGORY_LABELS[item.category]}`, ""];

  if (audience === "owner") {
    lines.push(`**What it means:** ${plainImpact(item)}`, "");
    return lines;
  }

  lines.push(item.description, "");
  if (item.impact) lines.push(`**Impact:** ${item.impact}`, "");
  if (technical && item.evidence) lines.push("**Evidence**", "", fence(item.evidence), "");

  const steps = extractFixSteps(item.fixPrompt);
  if (technical && steps.length > 0) {
    lines.push("**Remediation steps**", "", ...steps.map((step, position) => `${position + 1}. ${step}`), "");
    const verify = extractVerifyHint(item.fixPrompt);
    if (verify) lines.push(`**How to verify:** ${verify}`, "");
  }
  if (technical) {
    for (const fix of item.snippets ?? []) lines.push(`**Fix: ${fix.label}**`, "", fence(fix.code, fix.language), "");
    if (item.fixPrompt) lines.push("**AI fix prompt** (paste into Cursor / Claude Code)", "", fence(item.fixPrompt, "text"), "");
  }
  return lines;
}

export function reportToMarkdown(result: ScanResult, options: MarkdownOptions = {}): string {
  const audience = options.audience ?? "full";
  const host = displayTarget(result.target);
  const issues = sortByPriority(result.findings).filter((item) => item.severity !== "passed");
  const passed = result.findings.filter((item) => item.severity === "passed");

  const lines: string[] = [`# ShipSafe Security Report: ${host}`, ""];
  if (!isBuildTarget(result.target)) lines.push(buildBadgeMarkdown(result.overallScore, result.grade), "");
  lines.push(
    "> Passive configuration check only (standard GET/HEAD requests). Secrets are masked; file contents are never stored.",
    "",
    ...summarySection(result),
  );
  lines.push(...readinessSection(result));
  if (audience !== "developer") lines.push(...executiveSection(result));
  lines.push(...prioritySection(result));
  if (audience !== "owner") lines.push(...configSection(result));

  lines.push("## Findings", "");
  if (issues.length === 0) lines.push("No critical, warning or informational findings.", "");
  issues.forEach((item, index) => lines.push(...findingSection(item, index + 1, audience)));

  if (passed.length > 0) {
    lines.push("## Passed checks", "", ...passed.map((item) => `- ${cell(item.title)}`), "");
  }

  lines.push("---", "Generated by ShipSafe, pre-launch security & config audit.");
  return lines.join("\n");
}

export function markdownFileName(result: ScanResult, audience: MarkdownAudience = "full"): string {
  const host = displayTarget(result.target).replace(/[^a-z0-9.-]/gi, "_");
  const date = result.scannedAt.slice(0, 10);
  return `shipsafe-report-${host}-${date}${audience === "full" ? "" : `-${audience}`}.md`;
}

export function downloadMarkdown(result: ScanResult, audience: MarkdownAudience = "full"): void {
  const blob = new Blob([reportToMarkdown(result, { audience })], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = markdownFileName(result, audience);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
