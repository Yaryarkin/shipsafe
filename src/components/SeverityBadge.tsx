import type { Severity } from "@/lib/scanner/types";

export const SEVERITY_STYLES: Record<Severity, { label: string; badge: string; dot: string; text: string }> = {
  critical: {
    label: "Critical",
    badge: "border-critical/25 bg-critical/10 text-critical",
    dot: "bg-critical",
    text: "text-critical",
  },
  warning: {
    label: "Warning",
    badge: "border-warn/25 bg-warn/10 text-warn",
    dot: "bg-warn",
    text: "text-warn",
  },
  info: {
    label: "Info",
    badge: "border-line bg-raised text-soft",
    dot: "bg-muted",
    text: "text-soft",
  },
  passed: {
    label: "Passed",
    badge: "border-safe/25 bg-safe/10 text-safe",
    dot: "bg-safe",
    text: "text-safe",
  },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={`inline-flex h-5 w-[74px] shrink-0 items-center justify-center gap-1.5 rounded border font-mono text-[10.5px] font-medium uppercase tracking-wider ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}
