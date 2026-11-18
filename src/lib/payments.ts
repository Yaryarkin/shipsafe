/**
 * Pricing tiers and crypto payment options for ShipSafe Pro.
 * Addresses are verified by unit tests (Tron base58check checksum, Solana 32-byte public key) so a
 * typo can never silently send customer funds to an unreachable address.
 */

/** Ordered cheapest → most complete; the modal, bot menu and texts are all generated from this list. */
export const TIER_IDS = ["quick", "fix", "full"] as const;
export type TierId = (typeof TIER_IDS)[number];

/** API default when no tier is sent — keeps pre-v1.4 clients working as $49 orders. */
export const DEFAULT_TIER: TierId = "full";
/** Tier preselected in the order modal (the low-friction entry tier). */
export const UI_DEFAULT_TIER: TierId = "quick";

export interface PricingTier {
  id: TierId;
  name: string;
  /** Short product name used in notifications, logs and receipts, e.g. "$10 Quick Review". */
  shortName: string;
  /** Compact label for the Telegram bot's payment buttons and status texts, e.g. "Fix Pack". */
  menuLabel: string;
  priceUsd: number;
  /** Price in Telegram Stars (currency XTR) when paying through @shipsafe_orders_bot. */
  starsAmount: number;
  delivery: string;
  summary: string;
  includes: readonly string[];
}

export const PRICING_TIERS: Readonly<Record<TierId, PricingTier>> = {
  quick: {
    id: "quick",
    name: "Quick Config & Fix Review",
    shortName: "Quick Review",
    menuLabel: "Quick Review",
    priceUsd: 10,
    starsAmount: 500,
    delivery: "within a few hours",
    summary: "A human review of your live scan plus copy-paste configs for your stack.",
    includes: [
      "Expert review of your live ShipSafe scan findings",
      "Ready-to-paste security headers, CSP and CORS config for your stack",
      "Supabase RLS / Firebase rules checklist tailored to your app",
    ],
  },
  fix: {
    id: "fix",
    name: "Code & Config Fix Pack",
    shortName: "Code & Config Fix Pack",
    menuLabel: "Fix Pack",
    priceUsd: 20,
    starsAmount: 1200,
    delivery: "within 12 hours",
    summary: "We write the actual fixes for your top findings, ready to apply.",
    includes: [
      "Everything in the Quick Review",
      "Ready-to-apply fixes for your top findings: headers, CSP, CORS and cookie settings for your stack",
      "Supabase RLS policies or Firebase Security Rules written for your tables / collections",
      "Step-by-step apply & verify notes (or a patch you can merge)",
    ],
  },
  full: {
    id: "full",
    name: "Full Repo & Game Audit",
    shortName: "Full Repo & Game Audit",
    menuLabel: "Full Audit",
    priceUsd: 49,
    starsAmount: 3500,
    delivery: "within 24 hours",
    summary: "A manual audit of your code, APIs, database rules and game / app builds.",
    includes: [
      "Manual review of your codebase and every API route / server action",
      "Supabase Row-Level Security or Firebase Security Rules check",
      "Game & mobile builds: APK / WebGL / Electron review, backend and anti-cheat endpoints",
      "Secret hygiene: env vars, client bundles and git history",
      "Prioritized fixes with copy-paste AI prompts",
    ],
  },
};

/** "$10 Quick Review" / "$20 Code & Config Fix Pack" / "$49 Full Repo & Game Audit" */
export function tierLabel(id: TierId): string {
  const tier = PRICING_TIERS[id];
  return `$${tier.priceUsd} ${tier.shortName}`;
}

export function isTierId(value: unknown): value is TierId {
  return typeof value === "string" && (TIER_IDS as readonly string[]).includes(value);
}

/** 3500 → "3,500 ⭐" (locale-independent, so server and client render identically). */
export function formatStars(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ⭐`;
}

/** Bot that sells Stars invoices and receives order alerts. */
export const TELEGRAM_BOT_USERNAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "shipsafe_orders_bot").replace(/^@/, "");

/** https://t.me/shipsafe_orders_bot?start=pay_quick — opens the bot, which replies with a Stars invoice. */
export function starsDeepLink(tier: TierId, botUsername: string = TELEGRAM_BOT_USERNAME): string {
  return `https://t.me/${botUsername}?start=pay_${tier}`;
}

export const PAYMENT_METHOD_IDS = ["solana", "tron", "stars"] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export interface PaymentMethod {
  id: PaymentMethodId;
  label: string;
  sublabel: string;
  kind: "crypto" | "stars";
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  { id: "solana", label: "Solana", sublabel: "USDT / USDC", kind: "crypto" },
  { id: "tron", label: "Tron", sublabel: "TRC-20 USDT", kind: "crypto" },
  { id: "stars", label: "Telegram Stars", sublabel: "Card / Apple Pay", kind: "stars" },
];

/** "$10 / $20 / $49" */
export const PRICE_LIST_USD = TIER_IDS.map((id) => `$${PRICING_TIERS[id].priceUsd}`).join(" / ");

/** Lowest tier price, for "from $10" CTAs. */
export const STARTING_PRICE_USD = Math.min(...TIER_IDS.map((id) => PRICING_TIERS[id].priceUsd));

/** @deprecated kept for backwards compatibility; use PRICING_TIERS.full.priceUsd. */
export const PRO_AUDIT_PRICE_USD = PRICING_TIERS.full.priceUsd;

export interface PaymentOption {
  id: "solana" | "tron";
  network: string;
  assets: string;
  note: string;
  address: string;
}

export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  {
    id: "solana",
    network: "Solana",
    assets: "USDT or USDC",
    note: "Lowest fee",
    address: "CTVymMDpRjPFTrU1Z2QE71MuMGpUqDoybe1x7wDy8rFb",
  },
  {
    id: "tron",
    network: "Tron",
    assets: "USDT (TRC-20)",
    note: "Send on the TRC-20 network only",
    address: "T9zXkVGBwwLCm3h8HXUSArkfPo7PUjX3Ui",
  },
];
