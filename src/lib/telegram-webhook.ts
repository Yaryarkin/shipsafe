import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  formatStars,
  isTierId,
  PAYMENT_OPTIONS,
  PRICE_LIST_USD,
  PRICING_TIERS,
  TIER_IDS,
  tierLabel,
  type PaymentOption,
  type TierId,
} from "@/lib/payments";
import { SITE_URL } from "@/lib/share";

/**
 * Pure logic for the @shipsafe_orders_bot webhook. Each Telegram Update maps to exactly one action;
 * the route performs the Bot API calls. Covers owner commands, Telegram Stars (XTR) invoices,
 * pre-checkout validation, successful payments and buyer follow-up messages.
 */

// ---------------------------------------------------------------- Update schema (only fields we use)

const chatIdSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);

const userSchema = z.object({
  id: z.number().int(),
  username: z.string().max(64).optional(),
  first_name: z.string().max(256).optional(),
});

const successfulPaymentSchema = z.object({
  currency: z.string().max(8),
  total_amount: z.number().int().nonnegative(),
  invoice_payload: z.string().max(128),
  telegram_payment_charge_id: z.string().max(256),
  provider_payment_charge_id: z.string().max(256).optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().optional(),
  message: z
    .object({
      chat: z.object({ id: chatIdSchema }),
      from: userSchema.optional(),
      text: z.string().max(4096).optional(),
      successful_payment: successfulPaymentSchema.optional(),
    })
    .optional(),
  pre_checkout_query: z
    .object({
      id: z.string().min(1).max(256),
      from: userSchema,
      currency: z.string().max(8),
      total_amount: z.number().int().nonnegative(),
      invoice_payload: z.string().max(128),
    })
    .optional(),
  /** Inline keyboard button press in the bot's payment menu. */
  callback_query: z
    .object({
      id: z.string().min(1).max(256),
      from: userSchema,
      message: z.object({ chat: z.object({ id: chatIdSchema }) }).optional(),
      data: z.string().max(64).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface BuyerInfo {
  chatId: string;
  userId: number | null;
  username: string | null;
  firstName: string | null;
}

// ---------------------------------------------------------------- Message builders

const TIERS = TIER_IDS.map((id) => PRICING_TIERS[id]);

export function startMessage(siteUrl: string = SITE_URL): string {
  const products = TIERS.map((tier) => `$${tier.priceUsd} ${tier.menuLabel}`).join(", ");
  return [
    "ShipSafe Orders bot is active.",
    `Live site: ${siteUrl}`,
    `You will receive instant notifications here whenever someone submits a ${products}, or inquiry.`,
  ].join("\n");
}

export function statusMessage(siteUrl: string = SITE_URL): string {
  return `Bot online • Site: ${siteUrl} • Ready to receive ${PRICE_LIST_USD} orders.`;
}

/** Inline keyboard button: opens a URL or sends callback data back to the webhook. */
export type InlineButton = { text: string; url: string } | { text: string; callback_data: string };

export type CryptoNetwork = PaymentOption["id"];

/** Callback data sent by the payment menu buttons (≤ 64 bytes, as Telegram requires). */
export const CALLBACK = {
  stars: (tier: TierId) => `stars:${tier}`,
  crypto: (network: CryptoNetwork) => `crypto:${network}`,
} as const;

/** The in-bot payment menu shown under /start: Stars invoices, crypto instructions, and the free scan. */
export function paymentMenu(siteUrl: string = SITE_URL): InlineButton[][] {
  return [
    ...TIERS.map((tier): InlineButton[] => [{ text: `⭐ ${tier.menuLabel} — ${formatStars(tier.starsAmount)}`, callback_data: CALLBACK.stars(tier.id) }]),
    [
      { text: "Solana (USDT / USDC)", callback_data: CALLBACK.crypto("solana") },
      { text: "Tron (USDT TRC-20)", callback_data: CALLBACK.crypto("tron") },
    ],
    [{ text: "Free security scan on the site", url: siteUrl }],
  ];
}

/** Welcome for customers: prices plus the payment menu, so they can pay without leaving Telegram. */
export function buyerWelcome(siteUrl: string = SITE_URL): { text: string; buttons: InlineButton[][] } {
  return {
    text: [
      "Welcome to ShipSafe Orders.",
      "Get a human security review of your site, app or game:",
      "",
      ...TIERS.map((tier) => `• ${tier.name} — $${tier.priceUsd} or ${formatStars(tier.starsAmount)} (${tier.delivery})`),
      "",
      "Choose how to pay below:",
      "⭐ Telegram Stars — card / Apple Pay right here in Telegram",
      "Solana or Tron — pay in USDT / USDC",
    ].join("\n"),
    buttons: paymentMenu(siteUrl),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML message with the wallet address (tap to copy) and exact amounts for every tier. */
export function cryptoInstructions(network: CryptoNetwork): string {
  const option = PAYMENT_OPTIONS.find((candidate) => candidate.id === network);
  if (!option) return "Unknown network.";
  return [
    `<b>Pay with ${escapeHtml(option.network)} — ${escapeHtml(option.assets)}</b>`,
    "",
    ...TIERS.map((tier) => `• ${escapeHtml(tier.name)}: send exactly <b>$${tier.priceUsd}</b>`),
    "",
    "Address (tap to copy):",
    `<code>${escapeHtml(option.address)}</code>`,
    "",
    `⚠️ Send on the ${escapeHtml(option.network)} network only. Crypto transfers can't be reversed.`,
    "",
    "After sending, reply here with:",
    "1. your email",
    "2. the site URL to audit",
    "3. the transaction hash or explorer link",
  ].join("\n");
}

export const CALLBACK_ERROR = "This button has expired. Send /start to get a fresh menu.";

/** Stars invoice titles / price labels (Telegram limits titles to 32 characters). */
export const INVOICE_LABELS: Record<TierId, string> = {
  quick: "ShipSafe Quick Review",
  fix: "ShipSafe Code & Config Fix Pack",
  full: "ShipSafe Full Repo & Game Audit",
};

/** Body for Bot API sendInvoice in Telegram Stars (XTR). provider_token is empty for Stars. */
export function buildStarsInvoice(chatId: string, tier: TierId) {
  const product = PRICING_TIERS[tier];
  return {
    chat_id: chatId,
    title: INVOICE_LABELS[tier],
    description: `${product.name}: ${product.summary} Delivered ${product.delivery}. After paying, reply here with your email and site URL.`,
    payload: tier,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: INVOICE_LABELS[tier], amount: product.starsAmount }],
  };
}

function describeBuyer(buyer: BuyerInfo): string {
  const name = buyer.username ? `@${buyer.username}` : buyer.firstName ?? "unknown user";
  return `${name} (chat ${buyer.chatId})`;
}

function productLine(tier: TierId | null, amount: number): string {
  return tier ? `${tierLabel(tier)} (${formatStars(amount)})` : `Unknown product (${formatStars(amount)})`;
}

export function starsBuyerConfirmation(orderId: string, tier: TierId | null, amount: number): string {
  return [
    "Payment received — thank you!",
    `Order ID: ${orderId}`,
    `Product: ${productLine(tier, amount)}`,
    "",
    "Please reply to this message with your email and the site URL to audit, so we can deliver your review.",
  ].join("\n");
}

export function starsOwnerAlert(
  orderId: string,
  tier: TierId | null,
  amount: number,
  buyer: BuyerInfo,
  chargeId: string,
  now: Date = new Date(),
): string {
  return [
    `NEW PAID ORDER (Telegram Stars) — ${tier ? tierLabel(tier) : "unknown tier"}`,
    "",
    `Order ID: ${orderId}`,
    `Paid: ${formatStars(amount)}`,
    `Buyer: ${describeBuyer(buyer)}`,
    `Charge ID: ${chargeId}`,
    `Time: ${now.toISOString()}`,
    "",
    "The buyer was asked to reply with their email and site URL — their reply will be forwarded here.",
  ].join("\n");
}

export function buyerMessageForward(buyer: BuyerInfo, text: string): string {
  return [`Message from buyer ${describeBuyer(buyer)}:`, "", text.slice(0, 1500)].join("\n");
}

export const BUYER_ACK = "Thanks — got it. We'll get back to you by email or here.";

export function starsLogLine(orderId: string, tier: TierId | null, amount: number, buyer: BuyerInfo, chargeId: string): string {
  return `[shipsafe] pro paid order (stars) ${orderId} [${tier ? tierLabel(tier) : "unknown tier"} · ${amount} XTR]: ${describeBuyer(buyer)} · charge: ${chargeId}`;
}

// ---------------------------------------------------------------- Decision

/** "/start", "/START", "/start@bot", "/start payload" → "/start". Non-commands → null. */
export function parseCommand(text: string | undefined): string | null {
  const first = text?.trim().split(/\s+/)[0];
  if (!first?.startsWith("/")) return null;
  return first.split("@")[0]?.toLowerCase() ?? null;
}

/** "/start pay_full" → "pay_full"; "/start" → null. */
export function parseStartPayload(text: string | undefined): string | null {
  return text?.trim().split(/\s+/)[1] ?? null;
}

/** "pay_quick" → "quick"; anything else → null. */
export function tierFromStartPayload(payload: string | null): TierId | null {
  const match = /^pay_([a-z]+)$/.exec(payload ?? "");
  return match && isTierId(match[1]) ? match[1] : null;
}

export type WebhookAction =
  | { kind: "sendMessage"; chatId: string; text: string; buttons?: InlineButton[][]; reason: "owner start" | "owner status" | "buyer welcome" }
  | { kind: "sendInvoice"; chatId: string; tier: TierId }
  | { kind: "callbackInvoice"; queryId: string; chatId: string; tier: TierId }
  | { kind: "callbackCrypto"; queryId: string; chatId: string; network: CryptoNetwork; html: string }
  | { kind: "callbackExpired"; queryId: string }
  | { kind: "answerPreCheckout"; queryId: string; ok: true; tier: TierId }
  | { kind: "answerPreCheckout"; queryId: string; ok: false; errorMessage: string }
  | { kind: "starsPayment"; buyer: BuyerInfo; tier: TierId | null; amount: number; chargeId: string; currencyOk: boolean }
  | { kind: "forwardBuyerMessage"; buyer: BuyerInfo; text: string }
  | {
      kind: "ignore";
      reason: "invalid payload" | "no message" | "unauthorized chat" | "not a known command" | "owner message" | "owner not configured";
    };

export interface WebhookContext {
  ownerChatId?: string;
  siteUrl?: string;
  botUsername?: string;
}

export const PRE_CHECKOUT_ERROR = "This invoice is no longer valid. Please send /start to the bot to get a fresh one.";

export function decideWebhookAction(payload: unknown, context: WebhookContext = {}): WebhookAction {
  const parsed = telegramUpdateSchema.safeParse(payload);
  if (!parsed.success) return { kind: "ignore", reason: "invalid payload" };
  const update = parsed.data;
  const siteUrl = context.siteUrl ?? SITE_URL;
  const owner = context.ownerChatId?.trim() || null;

  // 1. Pre-checkout: approve only invoices that match our own prices exactly.
  const query = update.pre_checkout_query;
  if (query) {
    const tier = isTierId(query.invoice_payload) ? query.invoice_payload : null;
    if (tier && query.currency === "XTR" && query.total_amount === PRICING_TIERS[tier].starsAmount) {
      return { kind: "answerPreCheckout", queryId: query.id, ok: true, tier };
    }
    return { kind: "answerPreCheckout", queryId: query.id, ok: false, errorMessage: PRE_CHECKOUT_ERROR };
  }

  // 2. Payment menu buttons (anyone): Stars → invoice, Solana/Tron → address + amounts.
  const callback = update.callback_query;
  if (callback) {
    const chatId = String(callback.message?.chat.id ?? callback.from.id);
    const [kind, value] = (callback.data ?? "").split(":");
    if (kind === "stars" && isTierId(value)) return { kind: "callbackInvoice", queryId: callback.id, chatId, tier: value };
    const network = PAYMENT_OPTIONS.find((option) => option.id === value)?.id;
    if (kind === "crypto" && network) {
      return { kind: "callbackCrypto", queryId: callback.id, chatId, network, html: cryptoInstructions(network) };
    }
    return { kind: "callbackExpired", queryId: callback.id };
  }

  const message = update.message;
  if (!message) return { kind: "ignore", reason: "no message" };

  const chatId = String(message.chat.id);
  const isOwner = owner !== null && chatId === owner;
  const buyer: BuyerInfo = {
    chatId,
    userId: message.from?.id ?? null,
    username: message.from?.username ?? null,
    firstName: message.from?.first_name ?? null,
  };

  // 2. Successful payment: money has moved — always record it, even if something looks off.
  const payment = message.successful_payment;
  if (payment) {
    return {
      kind: "starsPayment",
      buyer,
      tier: isTierId(payment.invoice_payload) ? payment.invoice_payload : null,
      amount: payment.total_amount,
      chargeId: payment.telegram_payment_charge_id,
      currencyOk: payment.currency === "XTR",
    };
  }

  // 3. Commands.
  const command = parseCommand(message.text);
  if (command === "/start") {
    const tier = tierFromStartPayload(parseStartPayload(message.text));
    if (tier) return { kind: "sendInvoice", chatId, tier };
    // The owner gets their status message plus the same payment menu customers see.
    if (isOwner) return { kind: "sendMessage", chatId, text: startMessage(siteUrl), buttons: paymentMenu(siteUrl), reason: "owner start" };
    const welcome = buyerWelcome(siteUrl);
    return { kind: "sendMessage", chatId, text: welcome.text, buttons: welcome.buttons, reason: "buyer welcome" };
  }
  if (command === "/status") {
    return isOwner
      ? { kind: "sendMessage", chatId, text: statusMessage(siteUrl), reason: "owner status" }
      : { kind: "ignore", reason: "unauthorized chat" };
  }
  if (command) return { kind: "ignore", reason: "not a known command" };

  // 4. Plain text: the owner's own messages stay in their chat; a customer's message (e.g. email + site
  //    after paying) is forwarded to the owner.
  const text = message.text?.trim();
  if (!text) return { kind: "ignore", reason: "not a known command" };
  if (isOwner) return { kind: "ignore", reason: "owner message" };
  if (!owner) return { kind: "ignore", reason: "owner not configured" };
  return { kind: "forwardBuyerMessage", buyer, text };
}

/**
 * Checks Telegram's X-Telegram-Bot-Api-Secret-Token header when TELEGRAM_WEBHOOK_SECRET is set.
 * Constant-time comparison; with no secret configured every request passes.
 */
export function isAuthorizedWebhookRequest(headerValue: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (!expected) return true;
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
