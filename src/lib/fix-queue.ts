import type { Category, Finding, Severity } from "@/lib/scanner/types";

/**
 * Fix priority queue: what to patch first, next and later. Order comes from severity first, then
 * from how much damage the issue can do (impact), then quick wins before slow fixes (effort).
 * Pure, so the report, the Markdown export and the print view all show the same order.
 */

export type FixTier = "now" | "next" | "later";
export type Effort = "minutes" | "hour" | "day";

export interface QueueItem {
  id: string;
  title: string;
  severity: Exclude<Severity, "passed">;
  category: Category;
  tier: FixTier;
  /** 1-based position in the whole queue. */
  position: number;
  effort: Effort;
  /** 0-100: how much an attacker gains from this issue. */
  impact: number;
  /** One line on why it sits where it does. */
  reason: string;
}

export const TIER_LABELS: Record<FixTier, string> = {
  now: "Fix now",
  next: "Fix next",
  later: "When you can",
};

export const TIER_HINTS: Record<FixTier, string> = {
  now: "Exploitable today. Do these before launch.",
  next: "Weaken your defenses. Do these in the first week.",
  later: "Hardening and housekeeping.",
};

export const EFFORT_LABELS: Record<Effort, string> = {
  minutes: "~15 min",
  hour: "~1 hour",
  day: "half a day+",
};

interface Rule {
  match: RegExp;
  impact: number;
  effort: Effort;
  reason: string;
}

/** First match wins, so more specific rules come first. */
const RULES: Rule[] = [
  { match: /^exposure\.(?:env|git)$|^exposure\.file\./, impact: 98, effort: "hour", reason: "Secrets or source code can be downloaded by anyone, right now." },
  { match: /^secrets\.(?!none$|supabase-public$|firebase-public$|public-keys$)/, impact: 96, effort: "hour", reason: "A live key is public. Rotate it first, then remove it from the bundle." },
  { match: /^build\.(?:signing-keys|credentials-file|env-file)$/, impact: 94, effort: "hour", reason: "Anyone who unpacks the build gets your keys." },
  { match: /^cors\.policy$/, impact: 90, effort: "minutes", reason: "Any website can read your users' data through their browser." },
  { match: /^transport\.https$/, impact: 90, effort: "hour", reason: "Traffic is not encrypted at all." },
  { match: /^build\.android-debuggable$/, impact: 86, effort: "minutes", reason: "A debuggable release can be inspected and modified by anyone." },
  { match: /^transport\.certificate$/, impact: 80, effort: "minutes", reason: "Visitors see a browser warning page." },
  { match: /^build\.hardcoded-tokens$/, impact: 80, effort: "hour", reason: "Tokens in the build are readable by anyone." },
  { match: /^cookies\./, impact: 72, effort: "minutes", reason: "Session cookies can be stolen or sent in the clear." },
  { match: /^build\.android-cleartext$|^build\.cleartext-endpoints$/, impact: 62, effort: "minutes", reason: "App traffic can be read on shared networks." },
  { match: /^transport\.http-redirect$/, impact: 62, effort: "minutes", reason: "Visitors can stay on an unencrypted connection." },
  { match: /^frontend\.mixed-content$/, impact: 60, effort: "minutes", reason: "Insecure resources can be swapped in transit." },
  { match: /^transport\.hsts$/, impact: 56, effort: "minutes", reason: "First visits can be downgraded to HTTP." },
  { match: /^headers\.csp$/, impact: 52, effort: "hour", reason: "No second line of defense against injected scripts." },
  { match: /^headers\.framing$/, impact: 46, effort: "minutes", reason: "Your pages can be framed for clickjacking." },
  { match: /^frontend\.source-maps$|^build\.android-permissions$|^build\.internal-endpoints$/, impact: 44, effort: "hour", reason: "Exposes your source code or widens what the app can access." },
  { match: /^headers\.nosniff$/, impact: 40, effort: "minutes", reason: "Uploaded files could be run as scripts." },
  { match: /^exposure\.tech-disclosure$|^build\.android-backup$/, impact: 32, effort: "minutes", reason: "Hands attackers an easier starting point." },
  { match: /^frontend\.sri$|^build\.api-endpoints$|^build\.debug-flags$/, impact: 26, effort: "hour", reason: "Reduces supply-chain and recon exposure." },
  { match: /^headers\.referrer-policy$|^headers\.permissions-policy|^exposure\.sitemap-sensitive$|^exposure\.robots$/, impact: 18, effort: "minutes", reason: "Small leaks and loose browser permissions." },
  { match: /^headers\.coop$|^headers\.csp-hardening$|^transport\.hsts-preload$|^exposure\.security-txt$|^secrets\.(?:supabase-public|firebase-public|public-keys)$/, impact: 12, effort: "minutes", reason: "Optional hardening." },
];

const SEVERITY_BASE: Record<Exclude<Severity, "passed">, number> = { critical: 3, warning: 2, info: 1 };
const TIER_FOR: Record<Exclude<Severity, "passed">, FixTier> = { critical: "now", warning: "next", info: "later" };
const EFFORT_ORDER: Record<Effort, number> = { minutes: 0, hour: 1, day: 2 };

const DEFAULTS: Record<Exclude<Severity, "passed">, Pick<Rule, "impact" | "effort" | "reason">> = {
  critical: { impact: 85, effort: "hour", reason: "Exploitable today." },
  warning: { impact: 40, effort: "hour", reason: "Weakens your defenses." },
  info: { impact: 10, effort: "minutes", reason: "Optional hardening." },
};

export function ruleFor(finding: Pick<Finding, "id" | "severity">): Pick<Rule, "impact" | "effort" | "reason"> {
  const severity = finding.severity === "passed" ? "info" : finding.severity;
  return RULES.find((rule) => rule.match.test(finding.id)) ?? DEFAULTS[severity];
}

/** Builds the ordered queue. Passed findings are not part of it. */
export function buildFixQueue(findings: readonly Finding[]): QueueItem[] {
  const items = findings
    .filter((item): item is Finding & { severity: Exclude<Severity, "passed"> } => item.severity !== "passed")
    .map((item, index) => {
      const rule = ruleFor(item);
      return { item, index, rule };
    });

  items.sort(
    (a, b) =>
      SEVERITY_BASE[b.item.severity] - SEVERITY_BASE[a.item.severity] ||
      b.rule.impact - a.rule.impact ||
      EFFORT_ORDER[a.rule.effort] - EFFORT_ORDER[b.rule.effort] ||
      a.index - b.index,
  );

  return items.map(({ item, rule }, position) => ({
    id: item.id,
    title: item.title,
    severity: item.severity,
    category: item.category,
    tier: TIER_FOR[item.severity],
    position: position + 1,
    effort: rule.effort,
    impact: rule.impact,
    reason: rule.reason,
  }));
}

/** Findings in queue order, followed by the passed checks in their original order. */
export function sortByPriority(findings: readonly Finding[]): Finding[] {
  const order = new Map(buildFixQueue(findings).map((entry) => [entry.id, entry.position] as const));
  const open = findings.filter((item) => order.has(item.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const passed = findings.filter((item) => !order.has(item.id));
  return [...open, ...passed];
}

export function queueByTier(queue: readonly QueueItem[]): Array<{ tier: FixTier; items: QueueItem[] }> {
  return (["now", "next", "later"] as const)
    .map((tier) => ({ tier, items: queue.filter((entry) => entry.tier === tier) }))
    .filter((group) => group.items.length > 0);
}
