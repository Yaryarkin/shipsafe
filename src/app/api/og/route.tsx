import type { NextRequest } from "next/server";
import { renderOgCard, renderScoreOgCard } from "@/lib/og-card";
import { API_PARAM_KEYS, parseScoreCardParams } from "@/lib/og-params";

/**
 * GET /api/og?score=94&grade=A[&prev=62][&target=my-app.com] → 1200×630 PNG score card.
 * Invalid or missing parameters fall back to the standard ShipSafe card.
 */
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const params = parseScoreCardParams((key) => request.nextUrl.searchParams.get(key), API_PARAM_KEYS);
  return params ? renderScoreOgCard(params) : renderOgCard();
}
