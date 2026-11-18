import { renderOgCard } from "@/lib/og-card";

/** Static ShipSafe card at /twitter-image (kept for existing links; same image as /opengraph-image). */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return renderOgCard();
}
