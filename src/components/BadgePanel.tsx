"use client";

import { useState } from "react";
import {
  BADGE_FORMAT_LABELS,
  BADGE_FORMATS,
  BADGE_STYLES,
  BADGE_VARIANTS,
  buildBadgeSnippet,
  type BadgeFormat,
  type BadgeStyle,
  type BadgeVariant,
} from "@/lib/badge";
import type { Grade } from "@/lib/scanner/types";
import { CopyButton } from "./CopyButton";

const STYLE_LABELS: Record<BadgeStyle, string> = { flat: "Flat", "flat-square": "Square" };
const VARIANT_LABELS: Record<BadgeVariant, string> = { full: "Grade + score", grade: "Grade", score: "Score" };

function Choice<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="chip inline-flex max-w-full overflow-x-auto rounded-md p-0.5 [scrollbar-width:none]">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors ${option === value ? "chip-active" : "text-muted hover:text-fg"}`}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

/** Pick a badge style and format, preview it, and copy a snippet for a README or docs site. */
export function BadgePanel({ score, grade }: { score: number; grade: Grade }) {
  const [style, setStyle] = useState<BadgeStyle>("flat");
  const [variant, setVariant] = useState<BadgeVariant>("full");
  const [format, setFormat] = useState<BadgeFormat>("markdown");

  // Same-origin preview (the CSP allows only 'self' images); the copied snippet uses the public URL.
  const preview = `/api/badge?grade=${grade}&score=${score}&style=${style}&variant=${variant}`;
  const snippet = buildBadgeSnippet(format, score, grade, undefined, { style, variant });

  return (
    <>
      <div className="flex h-11 items-center rounded-md border border-line bg-raised px-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny same-origin SVG */}
        <img src={preview} alt={`ShipSafe badge: grade ${grade}, ${score}/100`} height={20} className="h-5 w-auto" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Choice label="Badge style" options={BADGE_STYLES} labels={STYLE_LABELS} value={style} onChange={setStyle} />
        <Choice label="Badge content" options={BADGE_VARIANTS} labels={VARIANT_LABELS} value={variant} onChange={setVariant} />
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-raised">
        <div role="tablist" aria-label="Snippet format" className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5 [scrollbar-width:none]">
          {BADGE_FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === format}
              onClick={() => setFormat(id)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors ${id === format ? "chip-active" : "text-muted hover:text-fg"}`}
            >
              {BADGE_FORMAT_LABELS[id]}
            </button>
          ))}
        </div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{snippet}</pre>
      </div>
      <span className="self-start">
        <CopyButton text={snippet} label={`Copy ${BADGE_FORMAT_LABELS[format]}`} />
      </span>
    </>
  );
}
