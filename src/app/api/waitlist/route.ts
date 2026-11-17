import { NextResponse, type NextRequest } from "next/server";
import { generateOrderId } from "@/lib/order-id";
import { buildOrderLogLine, buildTelegramOrderMessage } from "@/lib/order-notifications";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import type { ApiError } from "@/lib/scanner/types";
import { sendTelegramMessage, telegramConfigFromEnv } from "@/lib/telegram";
import { waitlistRequestSchema, type WaitlistRequest, type WaitlistResponse } from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Room for two Telegram attempts (4 s + 6 s) plus a cold start. */
export const maxDuration = 20;

const rateLimit = createRateLimiter({ limit: 5, windowMs: 60_000 });
const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  const body: ApiError = { error: { code, message } };
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function ok(delivered: boolean, orderId: string, headers: Record<string, string>) {
  const body: WaitlistResponse = { ok: true, delivered, orderId };
  return NextResponse.json(body, { status: 200, headers: { ...NO_STORE, ...headers } });
}

const telegramMessage = buildTelegramOrderMessage;
const logLine = buildOrderLogLine;

/**
 * Returns "not configured", or the attempt that succeeded (a retry covers cold-start timeouts).
 * Throws TelegramDeliveryError when every attempt failed. Never leaks the token.
 */
async function notifyTelegram(signup: WaitlistRequest, orderId: string): Promise<"not configured" | number> {
  const config = telegramConfigFromEnv();
  if (!config) return "not configured";
  const { attempt } = await sendTelegramMessage(config, telegramMessage(signup, orderId));
  return attempt;
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

  const parsed = waitlistRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid request body.", rateHeaders);
  }
  const signup = parsed.data;

  const orderId = generateOrderId();

  // Honeypot filled: pretend success (with a well-formed ID) so bots learn nothing.
  if (signup.hp) return ok(false, orderId, rateHeaders);

  // Zero-lost-order: the full order is written to the server log BEFORE any notification attempt, so it
  // survives even if Telegram fails or the function is cut off. The customer always gets their receipt.
  console.info(`${logLine(signup, orderId)} · received`);

  let delivered = false;
  try {
    const result = await notifyTelegram(signup, orderId);
    delivered = result !== "not configured";
    console.info(
      `[shipsafe] ${orderId} · telegram: ${delivered ? `sent${result === 1 ? "" : ` (attempt ${result})`}` : "not configured"}`,
    );
  } catch (error) {
    console.error(
      `${logLine(signup, orderId)} · telegram: FAILED (${error instanceof Error ? error.message : "unknown error"}) — follow up manually`,
    );
  }
  return ok(delivered, orderId, rateHeaders);
}

export function GET() {
  return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST /api/waitlist with {\"email\": \"you@company.com\"}.", {
    Allow: "POST",
  });
}
