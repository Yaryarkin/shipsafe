"use client";

import { Briefcase, Code2 } from "lucide-react";
import type { ReportView } from "@/lib/report-summary";

const OPTIONS: Array<{ id: ReportView; label: string; hint: string; icon: typeof Code2 }> = [
  { id: "owner", label: "Owner", hint: "Plain-language business and security impact", icon: Briefcase },
  { id: "developer", label: "Developer", hint: "Technical details, evidence and copy-ready fixes", icon: Code2 },
];

/** Switches the report between the owner (plain language) and developer (technical) explanation. */
export function ViewToggle({ value, onChange }: { value: ReportView; onChange: (view: ReportView) => void }) {
  return (
    <div role="group" aria-label="Report audience" className="chip inline-flex rounded-md p-0.5">
      {OPTIONS.map(({ id, label, hint, icon: Icon }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            title={hint}
            onClick={() => onChange(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] transition-colors ${
              active ? "chip-active" : "text-muted hover:text-fg"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
