"use client";

import { Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { haptic } from "@/lib/haptics";

/** Opens the phone's native share sheet. Renders nothing where the Web Share API is unavailable. */
export function ShareButton({ text }: { text: string }) {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        haptic("tap");
        try {
          await navigator.share({ text });
        } catch {
          // Dismissing the sheet rejects with AbortError; nothing to do.
        }
      }}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3 text-xs text-soft transition-colors hover:border-line-strong hover:text-fg"
    >
      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
      Share
    </button>
  );
}
