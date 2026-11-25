import { CheckCircle2, CircleAlert, Plus, RotateCw, TrendingDown } from "lucide-react";
import type { FixVerification } from "@/lib/scan-insights";
import { revealStyle } from "./Reveal";

function Row({ icon, tone, label, items }: { icon: React.ReactNode; tone: string; label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 shrink-0 ${tone}`}>{icon}</span>
      <div className="min-w-0 text-sm">
        <p className="text-fg">
          {items.length} {label}
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {items.slice(0, 5).map((title) => (
            <li key={title} className="truncate">
              {title}
            </li>
          ))}
          {items.length > 5 && <li className="text-faint">+{items.length - 5} more</li>}
        </ul>
      </div>
    </div>
  );
}

/**
 * After a re-scan: which issues from the previous scan are fixed, improved or still open.
 * On a first scan it explains the next step instead, with a re-scan button.
 */
export function FixVerificationPanel({
  verification,
  onRescan,
  rescanning = false,
}: {
  verification: FixVerification | null;
  onRescan?: () => void;
  rescanning?: boolean;
}) {
  if (!verification) {
    if (!onRescan) return null;
    return (
      <section aria-label="Verify your fixes" className="reveal surface flex flex-col gap-3 rounded-lg p-5 sm:flex-row sm:items-center sm:justify-between" style={revealStyle(2)}>
        <div>
          <h3 className="text-sm font-medium text-fg">Verify your fixes</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">Patch the issues, then re-scan. ShipSafe compares with this scan and tells you what is fixed and what is still open.</p>
        </div>
        <button
          type="button"
          onClick={onRescan}
          disabled={rescanning}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3.5 text-xs text-soft transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCw className={`h-3.5 w-3.5 ${rescanning ? "animate-spin" : ""}`} aria-hidden="true" />
          Re-scan after fixing
        </button>
      </section>
    );
  }

  const { fixed, improved, stillOpen, added } = verification;
  const nothingChanged = fixed.length + improved.length + stillOpen.length + added.length === 0;
  const date = new Date(verification.previousScannedAt);
  const since = Number.isNaN(date.getTime()) ? "your previous scan" : `your scan on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  return (
    <section aria-label="Fix verification" className="reveal surface rounded-lg p-5" style={revealStyle(2)}>
      <h3 className="text-sm font-medium text-fg">Since {since}</h3>
      {nothingChanged ? (
        <p className="mt-2 text-sm text-muted">There were no critical issues or warnings then, and there are none now.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <Row icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} tone="text-safe" label={fixed.length === 1 ? "issue fixed" : "issues fixed"} items={fixed} />
          <Row icon={<TrendingDown className="h-4 w-4" aria-hidden="true" />} tone="text-safe" label="downgraded to a note" items={improved} />
          <Row icon={<CircleAlert className="h-4 w-4" aria-hidden="true" />} tone="text-warn" label={stillOpen.length === 1 ? "issue still open" : "issues still open"} items={stillOpen} />
          <Row icon={<Plus className="h-4 w-4" aria-hidden="true" />} tone="text-critical" label={added.length === 1 ? "new issue" : "new issues"} items={added} />
        </div>
      )}
    </section>
  );
}
