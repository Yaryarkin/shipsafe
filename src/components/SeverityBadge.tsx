import type { Severity } from "@/lib/scanner/types";

export const SEVERITY_STYLES: Record<Severity, { label: string; badge: string; dot: string; text: string }> = {
  critical: {
    label: "Critical",
    badge: "border-red-500/30 bg-red-500/10 text-red-400",
    dot: "bg-red-500",
    text: "text-red-400",
  },
  warning: {
    label: "Warning",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    dot: "bg-amber-500",
    text: "text-amber-400",
  },
  info: {
    label: "Info",
    badge: "border-zinc-600/60 bg-zinc-500/10 text-zinc-300",
    dot: "bg-zinc-400",
    text: "text-zinc-300",
  },
  passed: {
    label: "Passed",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
  },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded border px-1.5 text-[11px] font-semibold uppercase tracking-wide ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}
