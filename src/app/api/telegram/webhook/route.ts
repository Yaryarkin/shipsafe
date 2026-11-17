import { NextResponse, type NextRequest } from "next/server";
import { generateOrderId } from "@/lib/order-id";
import { createRateLimiter } from "@/lib/rate-limit";
import { callTelegramApi, telegramTokenFromEnv } from "@/lib/telegram";
import {
  BUYER_ACK,
  CALLBACK_ERROR,
  buildStarsInvoice,
  buyerMessageForward,
  decideWebhookAction,
  isAuthorizedWebhookRequest,
  starsBuyerConfirmation,
  starsLogLine,
  starsOwnerAlert,
  type WebhookAction,
} from "@/lib/telegram-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Room for Bot API calls with one retry (4 s + 6 s). */
export const maxDuration = 20;

const NO_STORE = { "Cache-Control": "no-store" };
/** Pre-checkout must be answered within 10 s, so its retry budget is tighter. */
const PRE_CHECKOUT_TIMEOUTS_MS = [3_000, 4_000];
/** Buyers can message the owner through the bot, but not flood them. */
const buyerForwardLimit = createRateLimiter({ limit: 5, windowMs: 60_000 });

/** Telegram retries any non-2xx response, so every normal outcome is a fast 200. */
function ok() {
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

async function execute(action: Exclude<WebhookAction, { kind: "ignore" }>, token: string, ownerChatId: string | null): Promise<void> {
  const send = (chatId: string, text: string, extra: Record<string, unknown> = {}) =>
    callTelegramApi(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

  switch (action.kind) {
    case "answerPreCheckout": {
      const body = action.ok
        ? { pre_checkout_query_id: action.queryId, ok: true }
        : { pre_checkout_query_id: action.queryId, ok: false, error_message: action.errorMessage };
      await callTelegramApi(token, "answerPreCheckoutQuery", body, { timeoutsMs: PRE_CHECKOUT_TIMEOUTS_MS });
      console.info(`[shipsafe] stars pre-checkout ${action.ok ? `approved (${action.tier})` : "REJECTED (price/payload mismatch)"}`);
      return;
    }

    case "sendInvoice": {
      await callTelegramApi(token, "sendInvoice", buildStarsInvoice(action.chatId, action.tier));
      console.info(`[shipsafe] stars invoice sent: ${action.tier}`);
      return;
    }

    case "callbackInvoice":
    case "callbackCrypto":
    case "callbackExpired": {
      // Acknowledge the button press first so Telegram stops the loading spinner.
      const ack =
        action.kind === "callbackExpired"
          ? { callback_query_id: action.queryId, text: CALLBACK_ERROR, show_alert: true }
          : { callback_query_id: action.queryId };
      const answered = callTelegramApi(token, "answerCallbackQuery", ack, { timeoutsMs: [3_000] }).catch((error: unknown) =>
        console.error(`[shipsafe] answerCallbackQuery failed: ${errorText(error)}`),
      );
      if (action.kind === "callbackInvoice") {
        await Promise.all([answered, callTelegramApi(token, "sendInvoice", buildStarsInvoice(action.chatId, action.tier))]);
        console.info(`[shipsafe] stars invoice sent from menu: ${action.tier}`);
      } else if (action.kind === "callbackCrypto") {
        await Promise.all([answered, send(action.chatId, action.html, { parse_mode: "HTML" })]);
        console.info(`[shipsafe] crypto instructions sent from menu: ${action.network}`);
      } else {
        await answered;
      }
      return;
    }

    case "sendMessage": {
      const extra = action.buttons ? { reply_markup: { inline_keyboard: action.buttons } } : {};
      await send(action.chatId, action.text, extra);
      return;
    }

    case "starsPayment": {
      // Money has moved: log first so the order survives any Telegram failure below.
      const orderId = generateOrderId();
      const line = starsLogLine(orderId, action.tier, action.amount, action.buyer, action.chargeId);
      console.info(`${line} · received${action.currencyOk ? "" : " · WARNING: currency is not XTR"}`);

      const results = await Promise.allSettled([
        send(action.buyer.chatId, starsBuyerConfirmation(orderId, action.tier, action.amount)),
        ownerChatId
          ? send(ownerChatId, starsOwnerAlert(orderId, action.tier, action.amount, action.buyer, action.chargeId))
          : Promise.reject(new Error("TELEGRAM_CHAT_ID not configured")),
      ]);
      const [buyerResult, ownerResult] = results;
      console.info(
        `[shipsafe] ${orderId} · buyer confirmation: ${buyerResult?.status === "fulfilled" ? "sent" : `FAILED (${errorText(buyerResult?.status === "rejected" ? buyerResult.reason : null)})`}` +
          ` · owner alert: ${ownerResult?.status === "fulfilled" ? "sent" : `FAILED (${errorText(ownerResult?.status === "rejected" ? ownerResult.reason : null)}) — follow up manually`}`,
      );
      return;
    }

    case "forwardBuyerMessage": {
      if (!ownerChatId) return;
      if (!buyerForwardLimit(action.buyer.chatId).allowed) {
        console.info(`[shipsafe] buyer message from chat ${action.buyer.chatId} rate-limited`);
        return;
      }
      await Promise.allSettled([send(ownerChatId, buyerMessageForward(action.buyer, action.text)), send(action.buyer.chatId, BUYER_ACK)]);
      return;
    }
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedWebhookRequest(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    // Not from Telegram (wrong or missing secret). Telegram itself always sends the right one.
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return ok();
  }

  const ownerChatId = process.env.TELEGRAM_CHAT_ID?.trim() || null;
  const action = decideWebhookAction(payload, { ownerChatId: ownerChatId ?? undefined });
  if (action.kind === "ignore") {
    if (action.reason === "invalid payload" || action.reason === "owner not configured") {
      console.info(`[shipsafe] telegram webhook ignored: ${action.reason}`);
    }
    return ok();
  }

  const token = telegramTokenFromEnv();
  if (!token) {
    console.error("[shipsafe] telegram webhook: TELEGRAM_BOT_TOKEN not configured");
    return ok();
  }

  try {
    await execute(action, token, ownerChatId);
  } catch (error) {
    console.error(`[shipsafe] telegram webhook ${action.kind} failed: ${errorText(error)}`);
  }
  return ok();
}

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Telegram webhook endpoint. Telegram sends updates here via POST." } },
    { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
  );
}
