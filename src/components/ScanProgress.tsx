import { Check, Circle, LoaderCircle } from "lucide-react";

export const SCAN_STEPS = ["Checking TLS", "Inspecting Headers", "Scanning Public Bundles", "Generating Report"] as const;

export function ScanProgress({ activeStep }: { activeStep: number }) {
  return (
    <div className="animate-fade-in rounded-lg border border-line bg-card px-4 py-3.5" role="status" aria-live="polite">
      <ol className="grid gap-2.5 sm:grid-cols-4 sm:gap-3">
        {SCAN_STEPS.map((label, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li key={label} className="flex items-center gap-2 text-[13px]">
              {done ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-safe" aria-hidden="true" />
              ) : active ? (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-fg" aria-hidden="true" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
              )}
              <span className={done ? "text-muted" : active ? "text-fg" : "text-faint"}>
                {label}
                {active ? "…" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3.5 h-px overflow-hidden bg-line">
        <div
          className="h-full bg-fg/70 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, ((activeStep + 0.5) / SCAN_STEPS.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}
