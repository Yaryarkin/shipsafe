import { isBuildTarget } from "@/lib/scan-target";
import type { Finding, ScanResult, Severity } from "@/lib/scanner/types";

/** Pure helpers shared by the owner view, the Markdown export and the print report. */

export type ReportView = "owner" | "developer";

export interface OwnerSummary {
  headline: string;
  verdict: string;
  /** Up to three plain-language risks, most severe first. */
  risks: Array<{ severity: Severity; title: string; impact: string }>;
  nextStep: string;
}

export interface SeverityRow {
  severity: Severity;
  label: string;
  count: number;
  /** Points taken off the score by this severity (0 for info and passed). */
  points: number;
}

const POINTS: Record<Severity, number> = { critical: 20, warning: 6, info: 0, passed: 0 };
const LABELS: Record<Severity, string> = { critical: "Critical", warning: "Warnings", info: "Info", passed: "Passed" };

export function firstSentence(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(clean);
  const sentence = match?.[1] ?? clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** What the owner should understand about one finding, in plain language. */
export function plainImpact(finding: Finding): string {
  return finding.impact?.trim() || firstSentence(finding.description);
}

export function severityRows(result: ScanResult): SeverityRow[] {
  return (["critical", "warning", "info", "passed"] as const).map((severity) => ({
    severity,
    label: LABELS[severity],
    count: result.summary[severity],
    points: result.summary[severity] * POINTS[severity],
  }));
}

/** Critical first, then warnings, in scan order. These are the items a team must act on. */
export function priorityFindings(result: ScanResult): Finding[] {
  return [...result.findings.filter((item) => item.severity === "critical"), ...result.findings.filter((item) => item.severity === "warning")];
}

export function buildOwnerSummary(result: ScanResult): OwnerSummary {
  const { critical, warning, info } = result.summary;
  const subject = isBuildTarget(result.target) ? "build" : "site";
  const priority = priorityFindings(result);

  let headline: string;
  let verdict: string;
  if (critical > 0) {
    headline = `${critical} critical ${critical === 1 ? "problem" : "problems"} must be fixed before launch`;
    verdict = `This ${subject} scored ${result.overallScore}/100 (grade ${result.grade}). Critical problems can lead to stolen data or accounts today, so they come first.`;
  } else if (warning > 0) {
    headline = `No critical problems, but ${warning} ${warning === 1 ? "warning needs" : "warnings need"} attention`;
    verdict = `This ${subject} scored ${result.overallScore}/100 (grade ${result.grade}). It can ship, but the warnings make other attacks easier and should be fixed soon.`;
  } else {
    headline = "No critical problems or warnings found";
    verdict = `This ${subject} scored ${result.overallScore}/100 (grade ${result.grade}).${info > 0 ? ` ${info} informational ${info === 1 ? "note is" : "notes are"} optional hardening.` : ""}`;
  }

  const nextStep =
    critical + warning === 0
      ? "Nothing urgent. Re-scan after every release to catch regressions."
      : critical > 0
        ? "Send the report (or the developer brief for each item) to whoever builds your product. Ask for the critical items first, then re-scan to confirm they are gone."
        : "Ask your developer to work through the warnings, then re-scan to confirm they are gone.";

  return {
    headline,
    verdict,
    risks: priority.slice(0, 3).map((item) => ({ severity: item.severity, title: item.title, impact: plainImpact(item) })),
    nextStep,
  };
}

/**
 * Pulls the concrete steps out of a generated fix prompt (the numbered list after "Please:"),
 * dropping the generic framing lines so the export shows only what to actually do.
 */
export function extractFixSteps(fixPrompt: string): string[] {
  if (!fixPrompt) return [];
  const section = fixPrompt.split(/\n\s*Please:\s*\n/)[1] ?? "";
  const body = section.split(/\n\s*How I'll verify:/)[0] ?? "";
  const steps = body
    .split("\n")
    .map((line) => /^\s*\d+\.\s+(.*\S)\s*$/.exec(line)?.[1])
    .filter((step): step is string => Boolean(step));
  // The first step ("detect how this project is built...") and the last ("keep the change minimal...") are boilerplate.
  return steps.filter((step) => !/^First, detect how this project is built/.test(step) && !/^Keep the change minimal/.test(step));
}

export function extractVerifyHint(fixPrompt: string): string | null {
  const match = /How I'll verify:\s*(.+)$/s.exec(fixPrompt);
  return match?.[1]?.trim() || null;
}

/** A self-contained message an owner can forward to a developer: what is wrong, why it matters, how to fix it. */
export function buildDeveloperBrief(finding: Finding, site: string): string {
  const steps = extractFixSteps(finding.fixPrompt);
  const lines = [
    `Security issue found by ShipSafe on ${site}`,
    "",
    `${finding.severity.toUpperCase()}: ${finding.title}`,
    "",
    `Why it matters: ${plainImpact(finding)}`,
  ];
  if (finding.evidence) lines.push("", "Evidence:", finding.evidence);
  if (steps.length > 0) lines.push("", "What to do:", ...steps.map((step, index) => `${index + 1}. ${step}`));
  const verify = extractVerifyHint(finding.fixPrompt);
  if (verify) lines.push("", `How to verify: ${verify}`);
  return lines.join("\n");
}
