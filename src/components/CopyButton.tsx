"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

export function CopyButton({ text, label = "Copy fix prompt" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  };

  const copied = state === "copied";
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-colors ${
        copied ? "border-safe/30 bg-safe/10 text-safe" : "border-line bg-raised text-soft hover:border-line-strong hover:text-fg"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}
