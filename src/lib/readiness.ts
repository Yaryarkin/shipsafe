import type { ScanResult } from "@/lib/scanner/types";

/**
 * Pre-Launch Readiness Gate: one verdict for "can I ship this?", with the reasons behind it.
 *   blocked    at least one critical finding
 *   attention  no critical findings, but warnings (or checks that did not finish)
 *   ready      no critical findings and no warnings
 */

export type ReadinessStatus = "ready" | "attention" | "blocked";

export interface Readiness {
  status: ReadinessStatus;
  /** Short label for the indicator: "Ready to ship". */
  label: string;
  /** One sentence for the verdict. */
  headline: string;
  /** Concise reasoning, most important first. */
  reasons: string[];
  /** Titles of the findings that hold the gate closed (critical, then warnings), at most 5. */
  holding: string[];
  /** What changes the status next. Empty when already ready. */
  unlock: string;
}

export const READINESS_LABELS: Record<ReadinessStatus, string> = {
  ready: "Ready to ship",
  attention: "Needs attention",
  blocked: "Blocked by critical",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const list = (titles: string[], max = 3) => {
  const shown = titles.slice(0, max).join("; ");
  return titles.length > max ? `${shown}; +${titles.length - max} more` : shown;
};

export function assessReadiness(result: ScanResult): Readiness {
  const { critical, warning, info, passed } = result.summary;
  const criticalTitles = result.findings.filter((item) => item.severity === "critical").map((item) => item.title);
  const warningTitles = result.findings.filter((item) => item.severity === "warning").map((item) => item.title);
  const incomplete = result.findings.filter((item) => item.id.endsWith(".incomplete")).length;
  const subject = result.target.startsWith("build:") ? "build" : "site";

  const reasons: string[] = [];
  let status: ReadinessStatus;
  let headline: string;
  let unlock = "";

  if (critical > 0) {
    status = "blocked";
    headline = `Do not launch yet: ${plural(critical, "critical issue", "critical issues")} can be exploited today.`;
    reasons.push(`${plural(critical, "critical issue", "critical issues")}: ${list(criticalTitles)}.`);
    if (warning > 0) reasons.push(`${plural(warning, "warning", "warnings")} also need work after that.`);
    unlock = `Fix ${critical === 1 ? "the critical issue" : `all ${critical} critical issues`} to move to ${warning > 0 ? READINESS_LABELS.attention : READINESS_LABELS.ready}.`;
  } else if (warning > 0 || incomplete > 0) {
    status = "attention";
    headline =
      warning > 0
        ? `No critical issues. Fix the ${plural(warning, "warning", "warnings")} soon, ideally before launch.`
        : "No critical issues, but some checks did not finish. Re-scan to be sure.";
    reasons.push("No critical issues found.");
    if (warning > 0) reasons.push(`${plural(warning, "warning", "warnings")}: ${list(warningTitles)}.`);
    if (incomplete > 0) reasons.push(`${plural(incomplete, "check", "checks")} did not complete (timeout or server error).`);
    unlock = warning > 0 ? `Fix ${warning === 1 ? "the warning" : `all ${warning} warnings`} to reach ${READINESS_LABELS.ready}.` : "Re-scan to finish the incomplete checks.";
  } else {
    status = "ready";
    headline = `This ${subject} is ready to ship. No critical issues or warnings.`;
    reasons.push("No critical issues found.", "No warnings found.");
  }

  reasons.push(`${plural(passed, "check", "checks")} passed${info > 0 ? `, ${plural(info, "optional note", "optional notes")}` : ""}.`);

  return {
    status,
    label: READINESS_LABELS[status],
    headline,
    reasons,
    holding: [...criticalTitles, ...warningTitles].slice(0, 5),
    unlock,
  };
}
