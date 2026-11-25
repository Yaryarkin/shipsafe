import { createClient } from "redis";
import { PRICING_TIERS, TELEGRAM_BOT_USERNAME, TIER_IDS, formatStars, type TierId } from "@/lib/payments";

/**
 * Referral program for the Telegram bot. Every 15 friends who start the bot for the first time through
 * your personal link give you 10% off, up to 50% (75 friends). The discount grows in steps of 10%
 * and is applied automatically to the Telegram Stars price (and shown on the crypto amounts).
 *
 * Everything here is pure except the store adapters at the bottom.
 */

/** Friends needed for each discount step. */
export const REFERRAL_FRIENDS_PER_STEP = 15;
/** Discount added by each step. */
export const REFERRAL_PERCENT_PER_STEP = 10;
export const REFERRAL_MAX_PERCENT = 50;
/** Friends needed to reach the maximum discount. */
export const REFERRAL_MAX_FRIENDS = (REFERRAL_MAX_PERCENT / REFERRAL_PERCENT_PER_STEP) * REFERRAL_FRIENDS_PER_STEP;

/** Discount for a number of invited friends: 10% per full 15 friends, capped at 50%. Bad input counts as zero. */
export function discountPercent(friends: number): number {
  if (!Number.isFinite(friends) || friends <= 0) return 0;
  const steps = Math.floor(Math.floor(friends) / REFERRAL_FRIENDS_PER_STEP);
  return Math.min(steps * REFERRAL_PERCENT_PER_STEP, REFERRAL_MAX_PERCENT);
}

/** Friends still needed for the next discount step, or null at the maximum. */
export function friendsToNextDiscount(friends: number): number | null {
  const count = Number.isFinite(friends) && friends > 0 ? Math.floor(friends) : 0;
  if (discountPercent(count) >= REFERRAL_MAX_PERCENT) return null;
  return REFERRAL_FRIENDS_PER_STEP - (count % REFERRAL_FRIENDS_PER_STEP);
}

/** Stars price after the discount, rounded to the nearest Star, never below 1 (Telegram's minimum). */
export function discountedStars(base: number, percent: number): number {
  const clean = Math.min(Math.max(Math.floor(percent), 0), REFERRAL_MAX_PERCENT);
  return Math.max(1, Math.round((base * (100 - clean)) / 100));
}

/** USD price after the discount, to the cent. */
export function discountedUsd(base: number, percent: number): number {
  const clean = Math.min(Math.max(Math.floor(percent), 0), REFERRAL_MAX_PERCENT);
  return Math.round(base * (100 - clean)) / 100;
}

/** 10 → "$10", 9.5 → "$9.50". */
export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function isValidDiscountPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= REFERRAL_MAX_PERCENT;
}

// ------------------------------------------------------------------------------- links and payloads

const USER_ID_PATTERN = /^[1-9][0-9]{0,14}$/;

/** "ref_123456" → 123456. Anything else → null. */
export function parseReferralPayload(payload: string | null | undefined): number | null {
  const match = /^ref_([0-9]+)$/.exec(payload ?? "");
  const id = match?.[1];
  return id && USER_ID_PATTERN.test(id) ? Number(id) : null;
}

export function referralLink(userId: number, botUsername: string = TELEGRAM_BOT_USERNAME): string {
  return `https://t.me/${botUsername}?start=ref_${userId}`;
}

/** Invoice payload: "quick" without a discount, "quick:12" with one. Stays far below Telegram's 128 bytes. */
export function buildInvoicePayload(tier: TierId, percent: number): string {
  return percent > 0 ? `${tier}:${Math.min(Math.floor(percent), REFERRAL_MAX_PERCENT)}` : tier;
}

export function parseInvoicePayload(payload: string): { tier: TierId; percent: number } | null {
  const [tier, rawPercent, ...rest] = payload.split(":");
  if (rest.length > 0 || !tier || !(TIER_IDS as readonly string[]).includes(tier)) return null;
  if (rawPercent === undefined) return { tier: tier as TierId, percent: 0 };
  if (!/^[0-9]{1,2}$/.test(rawPercent)) return null;
  const percent = Number(rawPercent);
  return isValidDiscountPercent(percent) && percent > 0 ? { tier: tier as TierId, percent } : null;
}

// ------------------------------------------------------------------------------------- messages

export function priceLine(tier: TierId, percent: number): string {
  const product = PRICING_TIERS[tier];
  if (percent <= 0) return `• ${product.name}: $${product.priceUsd} or ${formatStars(product.starsAmount)} (${product.delivery})`;
  return `• ${product.name}: ${formatUsd(discountedUsd(product.priceUsd, percent))} or ${formatStars(discountedStars(product.starsAmount, percent))} instead of $${product.priceUsd} / ${formatStars(product.starsAmount)} (${product.delivery})`;
}

export function pricesText(percent: number): string {
  return [
    "ShipSafe human reviews",
    "",
    ...TIER_IDS.map((tier) => priceLine(tier, percent)),
    "",
    percent > 0 ? `Your referral discount: ${percent}% off, applied automatically.` : "Invite friends with /referral and get up to 50% off.",
    "",
    "Pick how to pay below. Stars are charged at the price shown.",
  ].join("\n");
}

export interface ReferralView {
  /** False when no store is configured: the program is shown as "coming soon" and nothing is discounted. */
  enabled: boolean;
  friends: number;
  link: string;
}

export function referralText(view: ReferralView): string {
  if (!view.enabled) {
    return ["Referral program", "", "The referral program is being switched on. Check back soon: every friend you invite will give you a discount."].join("\n");
  }
  const percent = discountPercent(view.friends);
  const lines = [
    "Referral program",
    "",
    `Every ${REFERRAL_FRIENDS_PER_STEP} friends who start the bot through your link give you ${REFERRAL_PERCENT_PER_STEP}% off, up to ${REFERRAL_MAX_PERCENT}% at ${REFERRAL_MAX_FRIENDS} friends.`,
    "The discount is applied automatically, and the Stars price drops with it.",
    "",
    "Your link (tap to copy):",
    view.link,
    "",
    `Friends invited: ${view.friends}`,
    `Your discount: ${percent}%${percent >= REFERRAL_MAX_PERCENT ? " (maximum)" : ""}`,
  ];
  const left = friendsToNextDiscount(view.friends);
  if (left !== null) {
    lines.push(`Next discount: ${percent + REFERRAL_PERCENT_PER_STEP}% off, ${left} more ${left === 1 ? "friend" : "friends"} to go.`);
  }
  lines.push("", "Only people who start the bot for the first time count. Inviting yourself does not count.");
  return lines.join("\n");
}

export function referrerNotification(friends: number): string {
  const percent = discountPercent(friends);
  const head = `A friend joined through your link. Friends: ${friends}.`;
  if (percent > discountPercent(friends - 1)) {
    return `${head} New discount unlocked: ${percent}% off${percent >= REFERRAL_MAX_PERCENT ? " (maximum)" : ""}! See /prices.`;
  }
  const left = friendsToNextDiscount(friends);
  if (left === null) return `${head} You have the maximum discount (${REFERRAL_MAX_PERCENT}%).`;
  return `${head} ${left} more for ${percent + REFERRAL_PERCENT_PER_STEP}% off.`;
}

// ------------------------------------------------------------------------------------ the store

export interface RegisterResult {
  /** True the first time this user ever starts the bot. */
  firstStart: boolean;
  /** True when this start was credited to a referrer. */
  credited: boolean;
  /** The referrer's friend count after this start (only when credited). */
  referrerFriends: number | null;
}

export interface ReferralStore {
  /** Records a /start. Only a user's very first start can be credited, and never to themselves. */
  registerStart(userId: number, referrerId: number | null): Promise<RegisterResult>;
  friendCount(userId: number): Promise<number>;
}

const KEY_PREFIX = "shipsafe:referral";
const seenKey = (userId: number) => `${KEY_PREFIX}:seen:${userId}`;
const countKey = (userId: number) => `${KEY_PREFIX}:friends:${userId}`;

/** In-memory store for tests and local runs. It does not survive a serverless cold start, so production never falls back to it. */
export function createMemoryReferralStore(): ReferralStore {
  const seen = new Map<number, number>();
  const friends = new Map<number, number>();
  return {
    async registerStart(userId, referrerId) {
      if (seen.has(userId)) return { firstStart: false, credited: false, referrerFriends: null };
      seen.set(userId, referrerId ?? 0);
      if (referrerId === null || referrerId === userId) return { firstStart: true, credited: false, referrerFriends: null };
      const count = (friends.get(referrerId) ?? 0) + 1;
      friends.set(referrerId, count);
      return { firstStart: true, credited: true, referrerFriends: count };
    },
    async friendCount(userId) {
      return friends.get(userId) ?? 0;
    },
  };
}

type RedisCommand = Array<string | number>;
type Fetcher = typeof fetch;

/** Upstash Redis over REST (also what Vercel KV uses). One pipeline request per operation. */
export function createRedisReferralStore(config: { url: string; token: string }, fetcher: Fetcher = fetch): ReferralStore {
  const run = async (commands: RedisCommand[]): Promise<unknown[]> => {
    const response = await fetcher(`${config.url.replace(/[/]+$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`referral store HTTP ${response.status}`);
    const body = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    return body.map((entry) => {
      if (entry.error) throw new Error(`referral store: ${entry.error}`);
      return entry.result;
    });
  };

  return {
    async registerStart(userId, referrerId) {
      // SET ... NX succeeds only for the first start ever, so a friend can never be credited twice.
      const [claimed] = await run([["SET", seenKey(userId), referrerId ?? 0, "NX"]]);
      if (claimed !== "OK") return { firstStart: false, credited: false, referrerFriends: null };
      if (referrerId === null || referrerId === userId) return { firstStart: true, credited: false, referrerFriends: null };
      const [count] = await run([["INCR", countKey(referrerId)]]);
      return { firstStart: true, credited: true, referrerFriends: Number(count) || 0 };
    },
    async friendCount(userId) {
      const [value] = await run([["GET", countKey(userId)]]);
      const count = Number(value);
      return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    },
  };
}

/** The few Redis commands the store needs, so the real client can be swapped for a fake in tests. */
export interface RedisConnection {
  set(key: string, value: string, options: { NX: true }): Promise<string | null>;
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  quit(): Promise<unknown>;
}

const CONNECT_TIMEOUT_MS = 3_000;

function connectRedis(url: string): Promise<RedisConnection> {
  const client = createClient({ url, socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false } });
  // An unhandled "error" event would crash the function; failures surface through the awaited calls instead.
  client.on("error", () => undefined);
  return client.connect().then(() => client as unknown as RedisConnection);
}

/**
 * Standard Redis over TCP (the REDIS_URL that Vercel's Redis integration provides). A short-lived
 * connection per operation suits serverless: connect, run, quit.
 */
export function createTcpReferralStore(url: string, connect: (url: string) => Promise<RedisConnection> = connectRedis): ReferralStore {
  const withConnection = async <T>(run: (connection: RedisConnection) => Promise<T>): Promise<T> => {
    const connection = await connect(url);
    try {
      return await run(connection);
    } finally {
      await connection.quit().catch(() => undefined);
    }
  };

  return {
    async registerStart(userId, referrerId) {
      return withConnection(async (redis) => {
        // SET ... NX succeeds only for the first start ever, so a friend can never be credited twice.
        const claimed = await redis.set(seenKey(userId), String(referrerId ?? 0), { NX: true });
        if (claimed !== "OK") return { firstStart: false, credited: false, referrerFriends: null };
        if (referrerId === null || referrerId === userId) return { firstStart: true, credited: false, referrerFriends: null };
        return { firstStart: true, credited: true, referrerFriends: Number(await redis.incr(countKey(referrerId))) || 0 };
      });
    },
    async friendCount(userId) {
      return withConnection(async (redis) => {
        const count = Number(await redis.get(countKey(userId)));
        return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      });
    },
  };
}

/**
 * Picks the store from the environment, or returns null when none is configured:
 *   1. Upstash / Vercel KV over REST (UPSTASH_REDIS_REST_* or KV_REST_API_*)
 *   2. standard Redis over TCP (REDIS_URL, redis:// or rediss://)
 */
export function referralStoreFromEnv(env: Record<string, string | undefined> = process.env): ReferralStore | null {
  const url = (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim();
  if (url && token) return createRedisReferralStore({ url, token });
  const tcp = env.REDIS_URL?.trim();
  if (tcp && /^rediss?:[/][/]/.test(tcp)) return createTcpReferralStore(tcp);
  return null;
}
