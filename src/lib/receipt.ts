import { tierLabel, type TierId } from "@/lib/payments";

export interface OrderReceipt {
  orderId: string;
  tier: TierId;
  email: string;
  site: string | null;
  txHash: string | null;
  submittedAt: string;
}

/** Plain-text receipt the customer can copy and keep or send back as proof of their order. */
export function buildOrderReceipt(order: OrderReceipt): string {
  const label = tierLabel(order.tier);
  return [
    "ShipSafe order receipt",
    `Order ID: ${order.orderId}`,
    `Product: ${order.txHash ? `${label} (paid)` : `${label} — inquiry (unpaid)`}`,
    `Site: ${order.site ?? "(not provided)"}`,
    `Email: ${order.email}`,
    `Transaction Hash: ${order.txHash ?? "(none)"}`,
    `Submitted: ${order.submittedAt}`,
  ].join("\n");
}
