import { describe, expect, it } from "vitest";
import {
  BUYER_ACK,
  CALLBACK,
  CALLBACK_ERROR,
  buildStarsInvoice,
  BOT_COMMANDS,
  BOT_DESCRIPTION_LIMIT,
  BOT_PROFILES,
  BOT_SHORT_DESCRIPTION_LIMIT,
  buyerMessageForward,
  cryptoInstructions,
  decideWebhookAction,
  isAuthorizedWebhookRequest,
  parseCommand,
  paymentMenu,
  PRE_CHECKOUT_ERROR,
  startIntro,
  startMenu,
  startMessage,
  starsBuyerConfirmation,
  starsLogLine,
  starsOwnerAlert,
  statusMessage,
  tierFromStartPayload,
  type BuyerInfo,
} from "../telegram-webhook";

const OWNER = "100200300"; // dummy chat id
const BUYER = 111222333;
const SITE = "https://shipsafe-six-iota.vercel.app";
const CTX = { ownerChatId: OWNER, siteUrl: SITE, botUsername: "shipsafe_orders_bot" };

function message(text: string | undefined, chatId: number | string = Number(OWNER), extra: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 7,
      date: 1_700_000_000,
      chat: { id: chatId, type: "private" },
      from: { id: Number(chatId), is_bot: false, first_name: "Alex", username: "alex_dev" },
      text,
      ...extra,
    },
  };
}

function preCheckout(payload: string, amount: number, currency = "XTR") {
  return {
    update_id: 2,
    pre_checkout_query: {
      id: "pcq-123",
      from: { id: BUYER, is_bot: false, first_name: "Alex" },
      currency,
      total_amount: amount,
      invoice_payload: payload,
    },
  };
}

function successfulPayment(payload: string, amount: number, currency = "XTR") {
  return message(undefined, BUYER, {
    successful_payment: {
      currency,
      total_amount: amount,
      invoice_payload: payload,
      telegram_payment_charge_id: "stxCHARGE123",
      provider_payment_charge_id: "",
    },
  });
}

const BUYER_INFO: BuyerInfo = { chatId: String(BUYER), userId: BUYER, username: "alex_dev", firstName: "Alex" };

describe("owner commands", () => {
  it("/start from the owner → the start action (the route adds the activation message and the menu)", () => {
    expect(decideWebhookAction(message("/start"), CTX)).toEqual({ kind: "start", chatId: OWNER, userId: Number(OWNER), referrerId: null, isOwner: true });
    expect(startMessage(SITE)).toBe(
      [
        "ShipSafe Orders bot is active.",
        "Live site: https://shipsafe-six-iota.vercel.app",
        "You will receive instant notifications here whenever someone submits a $10 Quick Review, $20 Fix Pack, $49 Full Audit, or inquiry.",
      ].join("\n"),
    );
  });

  it("/status from the owner → the exact one-line status", () => {
    const action = decideWebhookAction(message("/status"), CTX);
    expect(action).toMatchObject({ kind: "sendMessage", chatId: OWNER, reason: "owner status" });
    if (action.kind === "sendMessage") {
      expect(action.text).toBe("Bot online • Site: https://shipsafe-six-iota.vercel.app • Ready to receive $10 / $20 / $49 orders.");
      expect(action.text).toBe(statusMessage(SITE));
    }
  });

  it.each(["/START", "/start@shipsafe_orders_bot", "  /start  "])("understands %j", (text) => {
    expect(decideWebhookAction(message(text), CTX)).toMatchObject({ kind: "start", isOwner: true });
  });

  it("matches the owner whether chat id arrives as number or string", () => {
    expect(decideWebhookAction(message("/status", OWNER), { ...CTX, ownerChatId: ` ${OWNER} ` })).toMatchObject({ reason: "owner status" });
  });

  it("ignores the owner's own plain messages", () => {
    expect(decideWebhookAction(message("hello"), CTX)).toEqual({ kind: "ignore", reason: "owner message" });
  });
});

describe("customers (any chat)", () => {
  it("/status from a stranger stays restricted", () => {
    expect(decideWebhookAction(message("/status", BUYER), CTX)).toEqual({ kind: "ignore", reason: "unauthorized chat" });
  });

  it("plain /start from a stranger → the start action with no referrer", () => {
    expect(decideWebhookAction(message("/start", BUYER), CTX)).toEqual({ kind: "start", chatId: String(BUYER), userId: BUYER, referrerId: null, isOwner: false });
  });

  it("/start ref_<id> carries the referrer, and only a well-formed id", () => {
    expect(decideWebhookAction(message("/start ref_5550001", BUYER), CTX)).toMatchObject({ kind: "start", referrerId: 5550001 });
    for (const bad of ["/start ref_", "/start ref_abc", "/start ref_0", "/start REF_5", "/start ref_12345678901234567890"]) {
      expect(decideWebhookAction(message(bad, BUYER), CTX)).toMatchObject({ kind: "start", referrerId: null });
    }
  });

  it("/prices, /referral and /invite open their own screens", () => {
    expect(decideWebhookAction(message("/prices", BUYER), CTX)).toEqual({ kind: "prices", chatId: String(BUYER), userId: BUYER });
    expect(decideWebhookAction(message("/referral", BUYER), CTX)).toEqual({ kind: "referral", chatId: String(BUYER), userId: BUYER });
    expect(decideWebhookAction(message("/invite@shipsafe_orders_bot", BUYER), CTX)).toMatchObject({ kind: "referral" });
  });

  it("the welcome is short and points to prices and referral; the menu has Prices, Referral and the free scan", () => {
    const text = startIntro();
    expect(text).toContain("Welcome to ShipSafe Orders.");
    expect(text).toContain("/prices");
    expect(text).toContain("/referral");
    expect(text).not.toContain("500 ⭐");
    expect(startIntro({ invited: true })).toContain("a friend's link");
    expect(startMenu(SITE)).toEqual([
      [
        { text: "💰 Prices", callback_data: "menu:prices" },
        { text: "🎁 Referral", callback_data: "menu:referral" },
      ],
      [{ text: "Free security scan on the site", url: SITE }],
    ]);
  });

  it("the payment menu shows list prices without a discount and discounted Stars with one", () => {
    expect(paymentMenu(SITE).slice(0, 3)).toEqual([
      [{ text: "⭐ Quick Review — 500 ⭐", callback_data: "stars:quick" }],
      [{ text: "⭐ Fix Pack — 1,200 ⭐", callback_data: "stars:fix" }],
      [{ text: "⭐ Full Audit — 3,500 ⭐", callback_data: "stars:full" }],
    ]);
    expect(paymentMenu(SITE, 10).slice(0, 3)).toEqual([
      [{ text: "⭐ Quick Review — 450 ⭐", callback_data: "stars:quick" }],
      [{ text: "⭐ Fix Pack — 1,080 ⭐", callback_data: "stars:fix" }],
      [{ text: "⭐ Full Audit — 3,150 ⭐", callback_data: "stars:full" }],
    ]);
  });

  it("explains what the bot does, in English and Russian, within Telegram's limits", () => {
    expect(BOT_PROFILES.map((profile) => profile.languageCode)).toEqual([undefined, "ru"]);
    for (const profile of BOT_PROFILES) {
      expect(profile.description.length).toBeGreaterThan(100);
      expect(profile.description.length).toBeLessThanOrEqual(BOT_DESCRIPTION_LIMIT);
      expect(profile.shortDescription.length).toBeGreaterThan(30);
      expect(profile.shortDescription.length).toBeLessThanOrEqual(BOT_SHORT_DESCRIPTION_LIMIT);
      expect(profile.description).toContain("Prices");
      expect(profile.description).toContain("$10");
      expect(profile.description).toContain("$49");
      expect(profile.description).toContain("shipsafe-six-iota.vercel.app");
      expect(profile.description).toContain("/referral");
      expect(profile.description).toContain("50%");
      expect(profile.commands.map((item) => item.command)).toEqual(["start", "prices", "referral"]);
      expect(profile.commands.every((item) => item.description.length >= 3 && item.description.length <= 256)).toBe(true);
    }
    expect(BOT_PROFILES[0]?.description).toContain("finds security holes");
    expect(BOT_PROFILES[0]?.description).toContain("How it works:");
    expect(BOT_PROFILES[1]?.description).toContain("Как это работает:");
    expect(BOT_PROFILES[1]?.description).toContain("безопасности");
  });

  it("registers Start, Prices and Referral in the command menu", () => {
    expect(BOT_COMMANDS.map((item) => item.command)).toEqual(["start", "prices", "referral"]);
    expect(BOT_COMMANDS.every((item) => item.description.length >= 3 && item.description.length <= 256)).toBe(true);
  });

  it.each([
    ["/start pay_quick", "quick"],
    ["/start pay_fix", "fix"],
    ["/start pay_full", "full"],
  ] as const)("%s from a stranger → sendInvoice(%s)", (text, tier) => {
    expect(decideWebhookAction(message(text, BUYER), CTX)).toEqual({ kind: "sendInvoice", chatId: String(BUYER), userId: BUYER, tier });
  });

  it("also sends invoices to the owner (for testing the flow)", () => {
    expect(decideWebhookAction(message("/start pay_quick"), CTX)).toEqual({ kind: "sendInvoice", chatId: OWNER, userId: Number(OWNER), tier: "quick" });
  });

  it("sends invoices even before the owner chat is configured", () => {
    expect(decideWebhookAction(message("/start pay_full", BUYER), {})).toMatchObject({ kind: "sendInvoice", tier: "full" });
  });

  it.each(["/start pay_premium", "/start pay_", "/start PAY_QUICK", "/start something"])("unknown start payload %j → welcome", (text) => {
    expect(decideWebhookAction(message(text, BUYER), CTX)).toMatchObject({ kind: "start", referrerId: null });
  });

  it("forwards a buyer's plain message (email + site) to the owner", () => {
    const action = decideWebhookAction(message("me@example.com https://my-app.com", BUYER), CTX);
    expect(action).toEqual({ kind: "forwardBuyerMessage", buyer: BUYER_INFO, text: "me@example.com https://my-app.com" });
  });

  it("doesn't forward when no owner is configured, or for unknown commands", () => {
    expect(decideWebhookAction(message("hi", BUYER), {})).toEqual({ kind: "ignore", reason: "owner not configured" });
    expect(decideWebhookAction(message("/help", BUYER), CTX)).toEqual({ kind: "ignore", reason: "not a known command" });
  });
});

describe("sendInvoice (Telegram Stars, XTR)", () => {
  it("builds the $10 Quick Review invoice for 500 Stars", () => {
    const invoice = buildStarsInvoice("42", "quick");
    expect(invoice).toMatchObject({
      chat_id: "42",
      payload: "quick",
      provider_token: "",
      currency: "XTR",
      prices: [{ label: "ShipSafe Quick Review", amount: 500 }],
    });
  });

  it("builds the $20 Fix Pack invoice for 1200 Stars", () => {
    expect(buildStarsInvoice("42", "fix")).toMatchObject({
      payload: "fix",
      currency: "XTR",
      provider_token: "",
      prices: [{ label: "ShipSafe Code & Config Fix Pack", amount: 1200 }],
    });
  });

  it("builds the $49 Full Audit invoice for 3500 Stars", () => {
    expect(buildStarsInvoice("42", "full")).toMatchObject({
      payload: "full",
      currency: "XTR",
      provider_token: "",
      prices: [{ label: "ShipSafe Full Repo & Game Audit", amount: 3500 }],
    });
  });

  it("stays within Telegram's title (32) and description (255) limits", () => {
    for (const tier of ["quick", "fix", "full"] as const) {
      const invoice = buildStarsInvoice("42", tier);
      expect(invoice.title.length).toBeLessThanOrEqual(32);
      expect(invoice.description.length).toBeLessThanOrEqual(255);
    }
  });
});

describe("pre_checkout_query", () => {
  it.each([
    ["quick", 500],
    ["fix", 1200],
    ["full", 3500],
  ] as const)("approves a valid %s invoice for %i XTR", (payload, amount) => {
    expect(decideWebhookAction(preCheckout(payload, amount), CTX)).toEqual({ kind: "answerPreCheckout", queryId: "pcq-123", ok: true, tier: payload, percent: 0 });
  });

  it.each([
    ["wrong amount", preCheckout("full", 500)],
    ["fix pack paid at the quick price", preCheckout("fix", 500)],
    ["wrong currency", preCheckout("quick", 500, "USD")],
    ["unknown payload", preCheckout("premium", 500)],
  ])("rejects %s with a clear message", (_, update) => {
    expect(decideWebhookAction(update, CTX)).toEqual({ kind: "answerPreCheckout", queryId: "pcq-123", ok: false, errorMessage: PRE_CHECKOUT_ERROR });
  });

  it.each([
    ["quick:10", 450, "quick", 10],
    ["fix:25", 900, "fix", 25],
    ["full:50", 1750, "full", 50],
    ["quick:1", 495, "quick", 1],
  ] as const)("approves the discounted invoice %s for %i XTR", (payload, amount, tier, percent) => {
    expect(decideWebhookAction(preCheckout(payload, amount), CTX)).toEqual({ kind: "answerPreCheckout", queryId: "pcq-123", ok: true, tier, percent });
  });

  it.each([
    ["a discount claimed but full price charged", preCheckout("quick:10", 500)],
    ["a discount applied to the wrong amount", preCheckout("quick:10", 400)],
    ["more than the 50% cap", preCheckout("quick:60", 200)],
    ["a zero discount spelled out", preCheckout("quick:0", 500)],
    ["a negative or non-numeric discount", preCheckout("quick:-5", 525)],
    ["extra payload parts", preCheckout("quick:10:5", 450)],
    ["the discounted price for the wrong tier", preCheckout("fix:10", 450)],
  ])("rejects %s", (_, update) => {
    expect(decideWebhookAction(update, CTX)).toEqual({ kind: "answerPreCheckout", queryId: "pcq-123", ok: false, errorMessage: PRE_CHECKOUT_ERROR });
  });

  it("answers for any buyer, even with no owner configured", () => {
    expect(decideWebhookAction(preCheckout("quick", 500), {})).toMatchObject({ kind: "answerPreCheckout", ok: true });
  });
});

describe("successful_payment", () => {
  it("records a paid Stars order with buyer, tier, amount and charge id", () => {
    expect(decideWebhookAction(successfulPayment("full", 3500), CTX)).toEqual({
      kind: "starsPayment",
      buyer: BUYER_INFO,
      tier: "full",
      percent: 0,
      amount: 3500,
      chargeId: "stxCHARGE123",
      currencyOk: true,
    });
  });

  it("records the referral discount carried in the payload", () => {
    expect(decideWebhookAction(successfulPayment("full:20", 2800), CTX)).toMatchObject({ kind: "starsPayment", tier: "full", percent: 20, amount: 2800 });
    const text = starsBuyerConfirmation("SS-7KQ2MX", "full", 2800, 20);
    expect(text).toContain("Product: $49 Full Repo & Game Audit (2,800 ⭐, 20% referral discount)");
    const alert = starsOwnerAlert("SS-7KQ2MX", "full", 2800, BUYER_INFO, "stxCHARGE123", new Date("2026-11-17T10:00:00Z"), 20);
    expect(alert).toContain("Paid: 2,800 ⭐ (20% referral discount)");
    expect(starsLogLine("SS-7KQ2MX", "full", 2800, BUYER_INFO, "stxCHARGE123", 20)).toContain("· 2800 XTR · -20% referral]");
  });

  it("still records the payment when the payload or currency looks wrong (money already moved)", () => {
    expect(decideWebhookAction(successfulPayment("mystery", 42, "USD"), CTX)).toMatchObject({
      kind: "starsPayment",
      tier: null,
      amount: 42,
      currencyOk: false,
    });
  });

  it("asks the buyer for email + site and quotes the order id", () => {
    const text = starsBuyerConfirmation("SS-7KQ2MX", "quick", 500);
    expect(text).toContain("Payment received");
    expect(text).toContain("Order ID: SS-7KQ2MX");
    expect(text).toContain("Product: $10 Quick Review (500 ⭐)");
    expect(text).toContain("reply to this message with your email and the site URL");
  });

  it("alerts the owner with a NEW PAID ORDER (Telegram Stars) message", () => {
    const text = starsOwnerAlert("SS-7KQ2MX", "full", 3500, BUYER_INFO, "stxCHARGE123", new Date("2026-11-17T10:00:00Z"));
    expect(text.split("\n")[0]).toBe("NEW PAID ORDER (Telegram Stars) — $49 Full Repo & Game Audit");
    expect(text).toContain("Order ID: SS-7KQ2MX");
    expect(text).toContain("Paid: 3,500 ⭐");
    expect(text).toContain("Buyer: @alex_dev (chat 111222333)");
    expect(text).toContain("Charge ID: stxCHARGE123");
    expect(text).toContain("Time: 2026-11-17T10:00:00.000Z");
  });

  it("writes a self-contained log line", () => {
    expect(starsLogLine("SS-7KQ2MX", "quick", 500, BUYER_INFO, "stxCHARGE123")).toBe(
      "[shipsafe] pro paid order (stars) SS-7KQ2MX [$10 Quick Review · 500 XTR]: @alex_dev (chat 111222333) · charge: stxCHARGE123",
    );
  });

  it("formats forwarded buyer messages and caps their length", () => {
    const forwarded = buyerMessageForward({ ...BUYER_INFO, username: null }, "x".repeat(5000));
    expect(forwarded.startsWith("Message from buyer Alex (chat 111222333):")).toBe(true);
    expect(forwarded.length).toBeLessThan(1600);
    expect(BUYER_ACK).toMatch(/got it/);
  });
});

function callback(data: string | undefined, chatId: number = BUYER) {
  return {
    update_id: 9,
    callback_query: { id: "cbq-1", from: { id: chatId, is_bot: false, first_name: "Alex" }, message: { message_id: 3, chat: { id: chatId } }, data },
  };
}

describe("in-bot payment menu (button presses)", () => {
  it.each([
    ["quick", CALLBACK.stars("quick")],
    ["fix", CALLBACK.stars("fix")],
    ["full", CALLBACK.stars("full")],
  ] as const)("⭐ %s button → acknowledge + Stars invoice to that chat", (tier, data) => {
    expect(decideWebhookAction(callback(data), CTX)).toEqual({ kind: "callbackInvoice", queryId: "cbq-1", chatId: String(BUYER), userId: BUYER, tier });
  });

  it.each(["solana", "tron"] as const)("%s button → acknowledge + address and exact amounts", (network) => {
    const action = decideWebhookAction(callback(CALLBACK.crypto(network)), CTX);
    expect(action).toEqual({ kind: "callbackCrypto", queryId: "cbq-1", chatId: String(BUYER), userId: BUYER, network });
    expect(cryptoInstructions(network)).toContain("send exactly");
  });

  it.each(["start", "prices", "referral"] as const)("menu button %s → acknowledge + that screen", (menu) => {
    expect(decideWebhookAction(callback(CALLBACK.menu(menu)), CTX)).toEqual({ kind: "callbackMenu", queryId: "cbq-1", chatId: String(BUYER), userId: BUYER, menu });
  });

  it("crypto instructions apply the referral discount to every amount", () => {
    const html = cryptoInstructions("solana", 10);
    expect(html).toContain("send exactly <b>$9</b> (10% referral discount, list price $10)");
    expect(html).toContain("send exactly <b>$18</b> (10% referral discount, list price $20)");
    expect(html).toContain("send exactly <b>$44.10</b> (10% referral discount, list price $49)");
    expect(cryptoInstructions("tron", 0)).toContain("send exactly <b>$49</b>");
    expect(cryptoInstructions("tron", 7)).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });

  it("works for the owner too, and falls back to the presser's id when the message is missing", () => {
    expect(decideWebhookAction(callback("stars:quick", Number(OWNER)), CTX)).toMatchObject({ kind: "callbackInvoice", chatId: OWNER });
    const noMessage = { callback_query: { id: "cbq-2", from: { id: BUYER }, data: "stars:full" } };
    expect(decideWebhookAction(noMessage, CTX)).toMatchObject({ kind: "callbackInvoice", chatId: String(BUYER), tier: "full" });
  });

  it.each(["stars:vip", "crypto:bitcoin", "something", undefined])("unknown or stale button %j → just acknowledge", (data) => {
    expect(decideWebhookAction(callback(data), CTX)).toEqual({ kind: "callbackExpired", queryId: "cbq-1" });
    expect(CALLBACK_ERROR).toContain("/start");
  });

  it("Solana instructions show only the Solana address, every tier's amount and what to reply with", () => {
    const html = cryptoInstructions("solana");
    expect(html).toContain("<code>CTVymMDpRjPFTrU1Z2QE71MuMGpUqDoybe1x7wDy8rFb</code>");
    expect(html).not.toContain("T9zXkVGBwwLCm3h8HXUSArkfPo7PUjX3Ui");
    expect(html).toContain("send exactly <b>$10</b>");
    expect(html).toContain("Code &amp; Config Fix Pack: send exactly <b>$20</b>");
    expect(html).toContain("send exactly <b>$49</b>");
    expect(html).toContain("Full Repo &amp; Game Audit");
    expect(html).toContain("the transaction hash or explorer link");
  });

  it("Tron instructions show only the Tron address and the network warning", () => {
    const html = cryptoInstructions("tron");
    expect(html).toContain("<code>T9zXkVGBwwLCm3h8HXUSArkfPo7PUjX3Ui</code>");
    expect(html).not.toContain("CTVymMDpRjPFTrU1Z2QE71MuMGpUqDoybe1x7wDy8rFb");
    expect(html).toContain("Send on the Tron network only");
  });

  it("escapes every & so Telegram's HTML parser accepts the message", () => {
    for (const network of ["solana", "tron"] as const) {
      expect(cryptoInstructions(network)).not.toMatch(/&(?!amp;|lt;|gt;)/);
    }
  });
});

describe("invalid payloads", () => {
  it.each([
    ["null", null],
    ["string", "not json"],
    ["array", [1, 2]],
    ["chat id is an object", { message: { chat: { id: { evil: true } }, text: "/start" } }],
    ["chat id is not numeric", { message: { chat: { id: "abc" }, text: "/start" } }],
    ["missing chat", { message: { text: "/start" } }],
    ["text is not a string", { message: { chat: { id: 1 }, text: 42 } }],
    ["pre-checkout without id", { pre_checkout_query: { from: { id: 1 }, currency: "XTR", total_amount: 500, invoice_payload: "quick" } }],
    ["negative payment amount", { message: { chat: { id: 1 }, successful_payment: { currency: "XTR", total_amount: -5, invoice_payload: "quick", telegram_payment_charge_id: "x" } } }],
  ])("ignores %s", (_, payload) => {
    expect(decideWebhookAction(payload, CTX)).toEqual({ kind: "ignore", reason: "invalid payload" });
  });

  it("ignores updates without message or pre_checkout_query", () => {
    expect(decideWebhookAction({ update_id: 3, edited_message: { chat: { id: 1 } } }, CTX)).toEqual({ kind: "ignore", reason: "no message" });
  });
});

describe("helpers", () => {
  it("parses commands and start payloads", () => {
    expect(parseCommand("/Status@ShipSafe_Orders_Bot extra")).toBe("/status");
    expect(parseCommand("status")).toBeNull();
    expect(tierFromStartPayload("pay_quick")).toBe("quick");
    expect(tierFromStartPayload("pay_full")).toBe("full");
    expect(tierFromStartPayload("pay_vip")).toBeNull();
    expect(tierFromStartPayload(null)).toBeNull();
  });

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    for (const row of [...paymentMenu(SITE, 12), ...startMenu(SITE)]) {
      for (const button of row) {
        if ("callback_data" in button) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
      }
    }
  });

  it("checks the webhook secret only when configured", () => {
    expect(isAuthorizedWebhookRequest(null, undefined)).toBe(true);
    expect(isAuthorizedWebhookRequest("s3cret-value", "s3cret-value")).toBe(true);
    expect(isAuthorizedWebhookRequest(null, "s3cret-value")).toBe(false);
    expect(isAuthorizedWebhookRequest("s3cret-valuE", "s3cret-value")).toBe(false);
    expect(isAuthorizedWebhookRequest("s3cret-value-longer", "s3cret-value")).toBe(false);
  });
});
