import { isBuildTarget } from "@/lib/scan-target";
import type { Grade } from "@/lib/scanner/types";

/** Public URL used for share text, metadataBase, robots and sitemap. Override with NEXT_PUBLIC_SITE_URL (e.g. a custom domain). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://shipsafe-six-iota.vercel.app").replace(/\/+$/, "");

/**
 * Shareable landing link that renders a personal score card in link previews:
 * https://…/?s=94&g=A (plus &p=62 when the score went up).
 */
export function buildShareLink(
  score: number,
  grade: Grade,
  siteUrl: string = SITE_URL,
  diff?: { scoreDelta: number; previousScore: number } | null,
): string {
  const improved = diff && diff.scoreDelta > 0;
  return `${siteUrl}/?s=${score}&g=${grade}${improved ? `&p=${diff.previousScore}` : ""}`;
}

/**
 * Ready-to-post snippet (always ≤ 280 chars). After an improving re-scan it brags about the upgrade
 * ("Upgraded my site from 62 to 94/100 …"); build scans say "app build" instead of "site".
 */
export function buildShareText(
  score: number,
  grade: Grade,
  siteUrl: string = SITE_URL,
  diff?: { scoreDelta: number; previousScore: number } | null,
  target?: string | null,
): string {
  const subject = target && isBuildTarget(target) ? "app build" : "site";
  const suffix = `on ShipSafe's 15-second pre-launch security check: ${buildShareLink(score, grade, siteUrl, diff)}`;
  if (diff && diff.scoreDelta > 0) {
    return `Upgraded my ${subject} from ${diff.previousScore} to ${score}/100 (Grade ${grade}) ${suffix}`;
  }
  return `My ${subject} scored ${score}/100 (Grade ${grade}) ${suffix}`;
}

/** One-click X/Twitter compose link prefilled with the share text. */
export function buildXIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
