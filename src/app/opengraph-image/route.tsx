import { renderOgCard } from "@/lib/og-card";

/**
 * Static ShipSafe card at /opengraph-image. Served as a route handler (not the opengraph-image.tsx
 * file convention) because file-based metadata would override the per-score images set by
 * generateMetadata on shared result links.
 */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return renderOgCard();
}
