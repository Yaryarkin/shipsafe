import type { NextRequest } from "next/server";
import { renderBadgeSvg } from "@/lib/badge";
import { API_PARAM_KEYS, parseScoreCardParams } from "@/lib/og-params";

/**
 * GET /api/badge?grade=A&score=94 → shields-style SVG badge. Invalid parameters render a neutral
 * "ShipSafe | Check Security" badge. Only validated grade/score reach the SVG.
 */
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const params = parseScoreCardParams((key) => request.nextUrl.searchParams.get(key), API_PARAM_KEYS);
  return new Response(renderBadgeSvg(params ? { score: params.score, grade: params.grade } : null), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // The site-wide CSP from next.config.ts also applies; the SVG itself contains no user input.
    },
  });
}
