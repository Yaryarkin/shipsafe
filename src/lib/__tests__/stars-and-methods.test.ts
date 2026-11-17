import { describe, expect, it } from "vitest";
import {
  formatStars,
  isTierId,
  PAYMENT_METHOD_IDS,
  PAYMENT_METHODS,
  PAYMENT_OPTIONS,
  PRICING_TIERS,
  starsDeepLink,
  TELEGRAM_BOT_USERNAME,
} from "../payments";
import { callTelegramApi, telegramTokenFromEnv } from "../telegram";

describe("Telegram Stars pricing", () => {
  it("prices Quick Review at $10 or 500 Stars and Full Audit at $49 or 3500 Stars", () => {
    expect(PRICING_TIERS.quick).toMatchObject({ priceUsd: 10, starsAmount: 500 });
    expect(PRICING_TIERS.full).toMatchObject({ priceUsd: 49, starsAmount: 3500 });
  });

  it("formats Stars amounts with thousands separators", () => {
    expect(formatStars(500)).toBe("500 ⭐");
    expect(formatStars(3500)).toBe("3,500 ⭐");
    expect(formatStars(1234567)).toBe("1,234,567 ⭐");
  });

  it("deep-links each tier to the bot's invoice command", () => {
    expect(TELEGRAM_BOT_USERNAME).toBe("shipsafe_orders_bot");
    expect(starsDeepLink("quick")).toBe("https://t.me/shipsafe_orders_bot?start=pay_quick");
    expect(starsDeepLink("full")).toBe("https://t.me/shipsafe_orders_bot?start=pay_full");
  });

  it("recognizes tier ids", () => {
    expect(isTierId("quick")).toBe(true);
    expect(isTierId("full")).toBe(true);
    expect(isTierId("premium")).toBe(false);
    expect(isTierId(undefined)).toBe(false);
  });
});

describe("payment method tabs", () => {
  it("has exactly three tabs in order: Solana, Tron, Telegram Stars", () => {
    expect(PAYMENT_METHOD_IDS).toEqual(["solana", "tron", "stars"]);
    expect(PAYMENT_METHODS.map((method) => method.label)).toEqual(["Solana", "Tron", "Telegram Stars"]);
    expect(PAYMENT_METHODS.map((method) => method.sublabel)).toEqual(["USDT / USDC", "TRC-20 USDT", "Card / Apple Pay"]);
  });

  it("maps each crypto tab to exactly one wallet address, and Stars to none", () => {
    for (const method of PAYMENT_METHODS) {
      const wallets = PAYMENT_OPTIONS.filter((option) => option.id === method.id);
      expect(wallets).toHaveLength(method.kind === "crypto" ? 1 : 0);
    }
    expect(PAYMENT_OPTIONS.find((option) => option.id === "solana")?.address).toBe("CTVymMDpRjPFTrU1Z2QE71MuMGpUqDoybe1x7wDy8rFb");
    expect(PAYMENT_OPTIONS.find((option) => option.id === "tron")?.address).toBe("T9zXkVGBwwLCm3h8HXUSArkfPo7PUjX3Ui");
  });
});

describe("callTelegramApi", () => {
  it("posts any Bot API method with the given payload", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await callTelegramApi("000:TEST", "answerPreCheckoutQuery", { pre_checkout_query_id: "q1", ok: true }, { fetchImpl });
    expect(calls).toEqual([{ url: "https://api.telegram.org/bot000:TEST/answerPreCheckoutQuery", body: { pre_checkout_query_id: "q1", ok: true } }]);
  });

  it("reads just the bot token for customer replies", () => {
    expect(telegramTokenFromEnv({ TELEGRAM_BOT_TOKEN: " t " })).toBe("t");
    expect(telegramTokenFromEnv({})).toBeNull();
  });
});
