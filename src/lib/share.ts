import type { Grade } from "@/lib/scanner/types";

/** Public URL used for share text, metadataBase, robots and sitemap. Override with NEXT_PUBLIC_SITE_URL (e.g. a custom domain). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://shipsafe-six-iota.vercel.app").replace(/\/+$/, "");

/**
 * Ready-to-post snippet. When a re-scan improved the score, it brags about the upgrade instead:
 * "Upgraded my site from 62 to 94/100 (Grade A) …".
 */
export function buildShareText(
  score: number,
  grade: Grade,
  siteUrl: string = SITE_URL,
  diff?: { scoreDelta: number; previousScore: number } | null,
): string {
  const suffix = `on ShipSafe's 15-second pre-launch security check: ${siteUrl}`;
  if (diff && diff.scoreDelta > 0) {
    return `Upgraded my site from ${diff.previousScore} to ${score}/100 (Grade ${grade}) ${suffix}`;
  }
  return `My site scored ${score}/100 (Grade ${grade}) ${suffix}`;
}

/** One-click X/Twitter compose link prefilled with the share text. */
export function buildXIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
