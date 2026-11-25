import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telegram/webhook/route";

/**
 * End to end through the real webhook route: Telegram and Redis are replaced by one fake fetch, so
 * these tests prove that referral credit, the discount and the invoice amount work together.
 */

const OWNER = "100200300";
const ALICE = 7001; // the referrer
const BOB = 7002; // a friend who joins through Alice's link

interface TelegramCall {
  method: string;
  body: Record<string, unknown>;
}

let telegram: TelegramCall[];
let redis: Map<string, string>;

function installFakes(withRedis: boolean) {
  telegram = [];
  redis = new Map();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:TEST_TOKEN_NOT_REAL");
  vi.stubEnv("TELEGRAM_CHAT_ID", OWNER);
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", withRedis ? "https://redis.example" : "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", withRedis ? "redis-token" : "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.stubEnv("REDIS_URL", "");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://redis.example")) {
        const commands = JSON.parse(String(init?.body)) as Array<Array<string | number>>;
        const results = commands.map(([name, key, value, flag]) => {
          const k = String(key);
          if (name === "SET") {
            if (flag === "NX" && redis.has(k)) return { result: null };
            redis.set(k, String(value));
            return { result: "OK" };
          }
          if (name === "INCR") {
            const next = Number(redis.get(k) ?? 0) + 1;
            redis.set(k, String(next));
            return { result: next };
          }
          return { result: redis.get(k) ?? null };
        });
        return new Response(JSON.stringify(results), { status: 200 });
      }
      const method = url.split("/").pop() ?? "";
      telegram.push({ method, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }),
  );
}

function post(update: unknown) {
  return POST(new NextRequest("https://shipsafe.example/api/telegram/webhook", { method: "POST", body: JSON.stringify(update), headers: { "content-type": "application/json" } }));
}

const text = (userId: number, value: string) => ({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false, first_name: "U" }, text: value } });
const press = (userId: number, data: string) => ({ update_id: 2, callback_query: { id: "cb", from: { id: userId, is_bot: false, first_name: "U" }, message: { message_id: 3, chat: { id: userId } }, data } });
const sent = (method: string) => telegram.filter((call) => call.method === method);
const messagesTo = (chatId: number) => sent("sendMessage").filter((call) => String(call.body.chat_id) === String(chatId));

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("referral flow through the webhook (store connected)", () => {
  beforeEach(() => installFakes(true));

  it("a friend starting through the link credits the referrer and both get a message", async () => {
    await post(text(BOB, `/start ref_${ALICE}`));
    expect(await redis.get(`shipsafe:referral:friends:${ALICE}`)).toBe("1");
    expect(messagesTo(ALICE)[0]?.body.text).toContain("A friend joined through your link");
    expect(messagesTo(ALICE)[0]?.body.text).toContain("14 more for 10% off");
    const welcome = messagesTo(BOB)[0]?.body;
    expect(String(welcome?.text)).toContain("joined through a friend's link");
    expect(JSON.stringify(welcome?.reply_markup)).toContain("menu:prices");
    expect(JSON.stringify(welcome?.reply_markup)).toContain("menu:referral");
  });

  it("registers the Start, Prices and Referral command menu once per server instance", async () => {
    // A fresh copy of the route, because the registration flag lives in the module.
    vi.resetModules();
    const fresh = (await import("@/app/api/telegram/webhook/route")).POST;
    const send = (value: string) => fresh(new NextRequest("https://shipsafe.example/api/telegram/webhook", { method: "POST", body: JSON.stringify(text(BOB, value)), headers: { "content-type": "application/json" } }));
    await send("/start");
    await send("/start");
    // English (default) and Russian, once each.
    expect(sent("setMyCommands")).toHaveLength(2);
    const english = sent("setMyCommands")[0]?.body;
    expect((english?.commands as Array<{ command: string }>).map((item) => item.command)).toEqual(["start", "prices", "referral"]);
    expect(english?.language_code).toBeUndefined();
    expect(sent("setMyCommands")[1]?.body.language_code).toBe("ru");
    // The description shown before Start and the short description on the profile page.
    expect(sent("setMyDescription")).toHaveLength(2);
    expect(String(sent("setMyDescription")[0]?.body.description)).toContain("ShipSafe finds security holes");
    expect(String(sent("setMyDescription")[1]?.body.description)).toContain("находит дыры");
    expect(sent("setMyShortDescription")).toHaveLength(2);
    expect(String(sent("setMyShortDescription")[0]?.body.short_description)).toContain("Finds security holes");
  });

  it("the same friend starting again, or opening a second link, credits nobody twice", async () => {
    await post(text(BOB, `/start ref_${ALICE}`));
    await post(text(BOB, `/start ref_${ALICE}`));
    await post(text(BOB, "/start ref_999"));
    expect(redis.get(`shipsafe:referral:friends:${ALICE}`)).toBe("1");
    expect(redis.get("shipsafe:referral:friends:999")).toBeUndefined();
    expect(messagesTo(ALICE)).toHaveLength(1);
  });

  it("inviting yourself earns nothing", async () => {
    await post(text(ALICE, `/start ref_${ALICE}`));
    expect(redis.get(`shipsafe:referral:friends:${ALICE}`)).toBeUndefined();
  });

  const invite = async (count: number, firstId = 20_000) => {
    for (let friend = 0; friend < count; friend += 1) await post(text(firstId + friend, `/start ref_${ALICE}`));
  };

  it("14 friends give no discount yet; the 15th unlocks 10% and tells the referrer", async () => {
    await invite(14);
    telegram.length = 0;
    await post(press(ALICE, "stars:quick"));
    expect(sent("sendInvoice")[0]?.body.prices).toEqual([{ label: "ShipSafe Quick Review", amount: 500 }]);
    expect(sent("sendInvoice")[0]?.body.payload).toBe("quick");

    telegram.length = 0;
    await invite(1, 30_000);
    expect(String(messagesTo(ALICE)[0]?.body.text)).toContain("New discount unlocked: 10% off");
  });

  it("the referrer's prices and Stars invoice drop by 10% at 15 friends", async () => {
    await invite(15);
    telegram.length = 0;

    await post(text(ALICE, "/prices"));
    const prices = messagesTo(ALICE)[0]?.body;
    expect(String(prices?.text)).toContain("Your referral discount: 10% off");
    expect(String(prices?.text)).toContain("$9 or 450 ⭐ instead of $10 / 500 ⭐");
    expect(JSON.stringify(prices?.reply_markup)).toContain("Quick Review — 450 ⭐");

    telegram.length = 0;
    await post(press(ALICE, "stars:quick"));
    const invoice = sent("sendInvoice")[0]?.body;
    expect(invoice?.currency).toBe("XTR");
    expect(invoice?.payload).toBe("quick:10");
    expect(invoice?.prices).toEqual([{ label: "ShipSafe Quick Review", amount: 450 }]);
  });

  it("a user with no friends pays the list price", async () => {
    await post(press(BOB, "stars:full"));
    expect(sent("sendInvoice")[0]?.body.prices).toEqual([{ label: "ShipSafe Full Repo & Game Audit", amount: 3500 }]);
    expect(sent("sendInvoice")[0]?.body.payload).toBe("full");
  });

  it("steps up every 15 friends: 30 → 20%, 60 → 40%, 75 → the 50% cap, more never go below half", async () => {
    const full = async () => {
      telegram.length = 0;
      await post(press(ALICE, "stars:full"));
      return sent("sendInvoice")[0]?.body;
    };
    await invite(30);
    expect((await full())?.prices).toEqual([{ label: "ShipSafe Full Repo & Game Audit", amount: 2800 }]);
    expect((await full())?.payload).toBe("full:20");
    await invite(30, 40_000);
    expect((await full())?.prices).toEqual([{ label: "ShipSafe Full Repo & Game Audit", amount: 2100 }]);
    await invite(15, 50_000);
    expect(redis.get(`shipsafe:referral:friends:${ALICE}`)).toBe("75");
    expect((await full())?.prices).toEqual([{ label: "ShipSafe Full Repo & Game Audit", amount: 1750 }]);
    await invite(10, 60_000);
    expect((await full())?.payload).toBe("full:50");
    expect((await full())?.prices).toEqual([{ label: "ShipSafe Full Repo & Game Audit", amount: 1750 }]);
  });

  it("crypto instructions show the discounted amounts", async () => {
    await invite(15);
    telegram.length = 0;
    await post(press(ALICE, "crypto:solana"));
    const html = String(messagesTo(ALICE)[0]?.body.text);
    expect(html).toContain("send exactly <b>$9</b> (10% referral discount");
    expect(html).toContain("send exactly <b>$44.10</b>");
  });

  it("the referral screen shows the personal link, the count and the discount", async () => {
    await post(text(BOB, `/start ref_${ALICE}`));
    telegram.length = 0;
    await post(text(ALICE, "/referral"));
    const body = String(messagesTo(ALICE)[0]?.body.text);
    expect(body).toContain(`?start=ref_${ALICE}`);
    expect(body).toContain("Friends invited: 1");
    expect(body).toContain("Your discount: 0%");
    expect(body).toContain("Next discount: 10% off, 14 more friends to go.");
  });

  it("approves only the exact discounted amount at pre-checkout and records the discount on payment", async () => {
    const check = (payload: string, amount: number) => ({ update_id: 5, pre_checkout_query: { id: "pq", from: { id: ALICE, is_bot: false, first_name: "A" }, currency: "XTR", total_amount: amount, invoice_payload: payload } });
    await post(check("quick:10", 450));
    expect(sent("answerPreCheckoutQuery")[0]?.body).toMatchObject({ ok: true });
    telegram.length = 0;
    await post(check("quick:10", 500));
    expect(sent("answerPreCheckoutQuery")[0]?.body).toMatchObject({ ok: false });

    telegram.length = 0;
    await post({ update_id: 6, message: { message_id: 4, date: 1, chat: { id: ALICE }, from: { id: ALICE, first_name: "A" }, successful_payment: { currency: "XTR", total_amount: 450, invoice_payload: "quick:10", telegram_payment_charge_id: "ch1" } } });
    expect(String(messagesTo(ALICE)[0]?.body.text)).toContain("10% referral discount");
    expect(String(messagesTo(Number(OWNER))[0]?.body.text)).toContain("Paid: 450 ⭐ (10% referral discount)");
  });

  it("falls back to the full price (never a wrong discount) when the store is down", async () => {
    await invite(15);
    telegram.length = 0;
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => (String(input).startsWith("https://redis.example") ? new Response("down", { status: 503 }) : realFetch(input as string, init))));
    await post(press(ALICE, "stars:quick"));
    expect(sent("sendInvoice")[0]?.body.prices).toEqual([{ label: "ShipSafe Quick Review", amount: 500 }]);
    expect(sent("sendInvoice")[0]?.body.payload).toBe("quick");
  });
});

describe("without a store the bot never discounts", () => {
  beforeEach(() => installFakes(false));

  it("shows the referral program as not switched on and charges list prices", async () => {
    await post(text(ALICE, "/referral"));
    expect(String(messagesTo(ALICE)[0]?.body.text)).toContain("being switched on");
    telegram.length = 0;
    await post(text(ALICE, "/prices"));
    expect(String(messagesTo(ALICE)[0]?.body.text)).not.toContain("instead of");
    telegram.length = 0;
    await post(press(ALICE, "stars:fix"));
    expect(sent("sendInvoice")[0]?.body.prices).toEqual([{ label: "ShipSafe Code & Config Fix Pack", amount: 1200 }]);
  });

  it("a referral link still opens the welcome without crashing", async () => {
    await post(text(BOB, `/start ref_${ALICE}`));
    expect(String(messagesTo(BOB)[0]?.body.text)).toContain("Welcome to ShipSafe Orders.");
    expect(String(messagesTo(BOB)[0]?.body.text)).not.toContain("friend's link");
    expect(messagesTo(ALICE)).toHaveLength(0);
  });
});
