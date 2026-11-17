/**
 * Pricing tiers and crypto payment options for ShipSafe Pro.
 * Addresses are verified by unit tests (Tron base58check checksum, Solana 32-byte public key) so a
 * typo can never silently send customer funds to an unreachable address.
 */

export const TIER_IDS = ["quick", "full"] as const;
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
  full: {
    id: "full",
    name: "Full Repo & RLS Audit",
    shortName: "Full Repo & RLS Audit",
    priceUsd: 49,
    starsAmount: 3500,
    delivery: "within 24 hours",
    summary: "A manual audit of your code, API routes and database rules.",
    includes: [
      "Manual review of your codebase and every API route / server action",
      "Supabase Row-Level Security or Firebase Security Rules check",
      "Secret hygiene: env vars, client bundles and git history",
      "Prioritized fixes with copy-paste AI prompts",
    ],
  },
};

/** "$10 Quick Review" / "$49 Full Repo & RLS Audit" */
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
