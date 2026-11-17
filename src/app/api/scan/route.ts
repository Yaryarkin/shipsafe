import { NextResponse, type NextRequest } from "next/server";
import { runScan } from "@/lib/scanner/engine";
import { ScanError } from "@/lib/scanner/errors";
import { scanRequestSchema, type ApiError, type ScanResult } from "@/lib/scanner/types";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const rateLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  const body: ApiError = { error: { code, message } };
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export async function POST(request: NextRequest) {
  const limit = rateLimit(clientIp(request.headers));
  const rateHeaders = {
    "X-RateLimit-Limit": String(limit.limit),
    "X-RateLimit-Remaining": String(limit.remaining),
  };
  if (!limit.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Too many scans. You can run 10 scans per minute — try again in ${limit.retryAfterSeconds}s.`,
      { ...rateHeaders, "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be JSON like {\"url\": \"https://your-app.com\"}.", rateHeaders);
  }

  const parsed = scanRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid request body.", rateHeaders);
  }

  try {
    const result: ScanResult = await runScan(parsed.data.url);
    return NextResponse.json(result, { status: 200, headers: { ...NO_STORE, ...rateHeaders } });
  } catch (error) {
    if (error instanceof ScanError) {
      return errorResponse(error.status, error.code, error.message, rateHeaders);
    }
    console.error("[shipsafe] unexpected scan failure:", error instanceof Error ? error.message : "unknown error");
    return errorResponse(500, "INTERNAL", "Something went wrong while scanning. Please try again.", rateHeaders);
  }
}

export function GET() {
  return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST /api/scan with {\"url\": \"https://your-app.com\"}.", {
    Allow: "POST",
  });
}
