import { Check, Circle, LoaderCircle } from "lucide-react";

export const SCAN_STEPS = ["Checking TLS", "Inspecting Headers", "Scanning Public Bundles", "Generating Report"] as const;

export function ScanProgress({ activeStep }: { activeStep: number }) {
  return (
    <div className="animate-fade-in rounded-lg border border-line bg-card p-4" role="status" aria-live="polite">
      <ol className="grid gap-2.5 sm:grid-cols-4 sm:gap-3">
        {SCAN_STEPS.map((label, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li key={label} className="flex items-center gap-2 text-sm">
              {done ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              ) : active ? (
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-fg" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-zinc-700" aria-hidden="true" />
              )}
              <span className={done ? "text-zinc-400" : active ? "text-fg" : "text-zinc-600"}>
                {label}
                {active ? "…" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 h-0.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, ((activeStep + 0.5) / SCAN_STEPS.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}
