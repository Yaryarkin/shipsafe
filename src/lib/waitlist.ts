import { z } from "zod";
import { DEFAULT_TIER, TIER_IDS } from "@/lib/payments";

/** A transaction hash (hex or base58 signature) or an https:// block-explorer link. */
const TX_HASH_PATTERN = /^(?:0x)?[A-Za-z0-9]{32,128}$/;
const TX_LINK_PATTERN = /^https:\/\/[^\s<>"']+$/i;

export function isValidTxReference(value: string): boolean {
  return TX_HASH_PATTERN.test(value) || TX_LINK_PATTERN.test(value);
}

/** Shared between POST /api/waitlist and the Pro Audit modal. Covers both paid orders and inquiries. */
export const waitlistRequestSchema = z.object({
  email: z
    .string({ required_error: "Email is required.", invalid_type_error: "Email must be a string." })
    .trim()
    .toLowerCase()
    .max(254, "Email is too long.")
    .email("Enter a valid email address."),
  scannedUrl: z
    .string()
    .trim()
    .max(2048)
    .url("Enter the site URL as https://your-app.com.")
    .refine((value) => /^https?:\/\//i.test(value), "scannedUrl must be an http(s) URL.")
    .optional(),
  /** Payment proof for a paid order: transaction hash/signature or explorer link. */
  txHash: z
    .string()
    .trim()
    .max(300, "Transaction reference is too long.")
    .refine(isValidTxReference, "Enter a transaction hash or an https:// explorer link.")
    .optional(),
  /** Pricing tier. Defaults to "full" ($49) so pre-v1.4 clients keep working unchanged. */
  tier: z.enum(TIER_IDS).default(DEFAULT_TIER),
  /** Honeypot: hidden from humans, bots tend to fill it. */
  hp: z.string().max(200).optional(),
});

export const waitlistResponseSchema = z.object({
  ok: z.literal(true),
  delivered: z.boolean(),
  /** Short receipt reference such as SS-7KQ2MX (see src/lib/order-id.ts). */
  orderId: z.string().regex(/^SS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/),
});

export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;
export type WaitlistResponse = z.infer<typeof waitlistResponseSchema>;
