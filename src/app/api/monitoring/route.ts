import { NextResponse, type NextRequest } from "next/server";
import {
  buildMonitoringLogLine,
  buildMonitoringMessage,
  monitoringRequestSchema,
  type MonitoringResponse,
} from "@/lib/monitoring";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import type { ApiError } from "@/lib/scanner/types";
import { sendTelegramMessage, telegramConfigFromEnv } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const rateLimit = createRateLimiter({ limit: 5, windowMs: 60_000 });
const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  const body: ApiError = { error: { code, message } };
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function ok(delivered: boolean, headers: Record<string, string>) {
  const body: MonitoringResponse = { ok: true, delivered };
  return NextResponse.json(body, { status: 200, headers: { ...NO_STORE, ...headers } });
}

export async function POST(request: NextRequest) {
  const limit = rateLimit(clientIp(request.headers));
  const rateHeaders = {
    "X-RateLimit-Limit": String(limit.limit),
    "X-RateLimit-Remaining": String(limit.remaining),
  };
  if (!limit.allowed) {
    return errorResponse(429, "RATE_LIMITED", `Too many attempts. Try again in ${limit.retryAfterSeconds}s.`, {
      ...rateHeaders,
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be JSON.", rateHeaders);
  }

  const parsed = monitoringRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid request body.", rateHeaders);
  }
  const signup = parsed.data;

  // Honeypot filled: pretend success so bots learn nothing.
  if (signup.hp) return ok(false, rateHeaders);

  // Logged BEFORE the notification attempt, so a signup survives a Telegram failure.
  console.info(`${buildMonitoringLogLine(signup)} · received`);

  let delivered = false;
  try {
    const config = telegramConfigFromEnv();
    if (config) {
      await sendTelegramMessage(config, buildMonitoringMessage(signup));
      delivered = true;
    }
  } catch (error) {
    console.error(
      `${buildMonitoringLogLine(signup)} · telegram: FAILED (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
  return ok(delivered, rateHeaders);
}

export function GET() {
  return errorResponse(405, "METHOD_NOT_ALLOWED", 'Use POST /api/monitoring with {"email": "you@company.com"}.', {
    Allow: "POST",
  });
}
