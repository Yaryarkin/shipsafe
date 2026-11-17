/**
 * Telegram Bot API sender with a retry, so a slow first request after a cold start doesn't drop
 * an order notification. Never includes the bot token in errors or logs.
 */

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export interface SendOptions {
  /** One entry per attempt: the timeout for that attempt. Default: 4 s, then a 6 s retry. */
  timeoutsMs?: number[];
  /** Pause before a retry. */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_TIMEOUTS_MS = [4_000, 6_000];
const DEFAULT_BACKOFF_MS = 300;

export class TelegramDeliveryError extends Error {
  readonly attempts: string[];

  constructor(attempts: string[]) {
    super(`Telegram delivery failed after ${attempts.length} attempt(s): ${attempts.join("; ")}`);
    this.name = "TelegramDeliveryError";
    this.attempts = attempts;
  }
}

export function telegramConfigFromEnv(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

/** 429 (rate limit) and 5xx are worth retrying; other 4xx (bad token, unknown chat) never fix themselves. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Bot token only (no owner chat needed) — for replying to customers. */
export function telegramTokenFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  return env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** Sends one text message, retrying on timeouts, network errors, 429 and 5xx. */
export function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  options: SendOptions = {},
): Promise<{ attempt: number }> {
  return callTelegramApi(config.token, "sendMessage", { chat_id: config.chatId, text, disable_web_page_preview: true }, options);
}

/**
 * Calls any Bot API method (sendMessage, sendInvoice, answerPreCheckoutQuery, …) with retries on
 * timeouts, network errors, 429 and 5xx. Resolves with the attempt that succeeded.
 */
export async function callTelegramApi(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  options: SendOptions = {},
): Promise<{ attempt: number }> {
  const timeouts = options.timeoutsMs && options.timeoutsMs.length > 0 ? options.timeoutsMs : DEFAULT_TIMEOUTS_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const failures: string[] = [];

  for (let index = 0; index < timeouts.length; index += 1) {
    const attempt = index + 1;
    if (index > 0) await sleep(backoffMs);

    let response: Response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeouts[index] ?? 4_000),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      failures.push(`#${attempt} ${timedOut ? "timed out" : "network error"}`);
      continue;
    }

    if (response.ok) return { attempt };
    failures.push(`#${attempt} HTTP ${response.status}`);
    if (!isRetryableStatus(response.status)) break;
  }

  throw new TelegramDeliveryError(failures);
}
