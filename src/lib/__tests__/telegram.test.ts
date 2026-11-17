import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEOUTS_MS,
  isRetryableStatus,
  sendTelegramMessage,
  telegramConfigFromEnv,
  TelegramDeliveryError,
} from "../telegram";

const CONFIG = { token: "000000:TEST-ONLY-NOT-A-REAL-TOKEN", chatId: "42" };
const noSleep = async () => {};

type Step = { status: number } | { error: "timeout" | "network" };

/** Fake fetch that plays back one step per call and records what it was asked. */
function scriptedFetch(steps: Step[]) {
  const calls: Array<{ url: string; body: unknown; hasSignal: boolean }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), hasSignal: Boolean(init?.signal) });
    const step = steps[calls.length - 1] ?? { status: 200 };
    if ("error" in step) {
      const error = new Error(step.error === "timeout" ? "The operation was aborted due to timeout" : "fetch failed");
      error.name = step.error === "timeout" ? "TimeoutError" : "TypeError";
      throw error;
    }
    return new Response("{}", { status: step.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("sendTelegramMessage", () => {
  it("defaults to two attempts: 4 s then a 6 s retry", () => {
    expect(DEFAULT_TIMEOUTS_MS).toEqual([4_000, 6_000]);
  });

  it("succeeds on the first attempt without retrying", async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 200 }]);
    await expect(sendTelegramMessage(CONFIG, "hi", { fetchImpl, sleep: noSleep })).resolves.toEqual({ attempt: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${CONFIG.token}/sendMessage`);
    expect(calls[0]?.body).toEqual({ chat_id: "42", text: "hi", disable_web_page_preview: true });
    expect(calls[0]?.hasSignal).toBe(true);
  });

  it("retries after a cold-start timeout and reports the attempt that worked", async () => {
    const { fetchImpl, calls } = scriptedFetch([{ error: "timeout" }, { status: 200 }]);
    await expect(sendTelegramMessage(CONFIG, "hi", { fetchImpl, sleep: noSleep })).resolves.toEqual({ attempt: 2 });
    expect(calls).toHaveLength(2);
  });

  it.each([429, 500, 502, 503])("retries on HTTP %i", async (status) => {
    const { fetchImpl, calls } = scriptedFetch([{ status }, { status: 200 }]);
    await expect(sendTelegramMessage(CONFIG, "hi", { fetchImpl, sleep: noSleep })).resolves.toEqual({ attempt: 2 });
    expect(calls).toHaveLength(2);
  });

  it.each([400, 401, 403, 404])("does not retry on HTTP %i (bad token or chat won't fix itself)", async (status) => {
    const { fetchImpl, calls } = scriptedFetch([{ status }, { status: 200 }]);
    await expect(sendTelegramMessage(CONFIG, "hi", { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(TelegramDeliveryError);
    expect(calls).toHaveLength(1);
  });

  it("gives up after all attempts and lists each failure", async () => {
    const { fetchImpl, calls } = scriptedFetch([{ error: "timeout" }, { error: "network" }]);
    const error = await sendTelegramMessage(CONFIG, "hi", { fetchImpl, sleep: noSleep }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramDeliveryError);
    expect((error as TelegramDeliveryError).attempts).toEqual(["#1 timed out", "#2 network error"]);
    expect(calls).toHaveLength(2);
  });

  it("never puts the bot token in the error message", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 401 }]);
    const error = await sendTelegramMessage(CONFIG, "hi", { fetchImpl, sleep: noSleep }).catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toContain(CONFIG.token);
  });

  it("waits the backoff only between attempts", async () => {
    const waits: number[] = [];
    const { fetchImpl } = scriptedFetch([{ error: "timeout" }, { status: 200 }]);
    await sendTelegramMessage(CONFIG, "hi", { fetchImpl, backoffMs: 250, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([250]);
  });
});

describe("helpers", () => {
  it("classifies retryable statuses", () => {
    expect([429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404].some(isRetryableStatus)).toBe(false);
  });

  it("reads config from env and requires both values", () => {
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: " t ", TELEGRAM_CHAT_ID: " 1 " })).toEqual({ token: "t", chatId: "1" });
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t" })).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_CHAT_ID: "1" })).toBeNull();
    expect(telegramConfigFromEnv({})).toBeNull();
  });
});
