import { tierLabel } from "@/lib/payments";
import type { WaitlistRequest } from "@/lib/waitlist";

/** Telegram text for a new order. Paid orders lead with the tier and price so they stand out. */
export function buildTelegramOrderMessage(order: WaitlistRequest, orderId: string, now: Date = new Date()): string {
  const label = tierLabel(order.tier);
  const header = order.txHash
    ? [`NEW PAID ORDER — ${label}`, "Verify the payment on-chain before starting the audit."]
    : [`New ShipSafe Pro inquiry — ${label}`];
  return [
    ...header,
    "",
    `Order ID: ${orderId}`,
    `Tier: ${label}`,
    `Email: ${order.email}`,
    `Site: ${order.scannedUrl ?? "(none)"}`,
    ...(order.txHash ? [`Transaction: ${order.txHash}`] : []),
    `Time: ${now.toISOString()}`,
  ].join("\n");
}

/** One self-contained server log line per order, so every order can be recovered from Vercel logs alone. */
export function buildOrderLogLine(order: WaitlistRequest, orderId: string): string {
  const kind = order.txHash ? `paid order (tx: ${order.txHash})` : "inquiry";
  return `[shipsafe] pro ${kind} ${orderId} [${tierLabel(order.tier)}]: ${order.email} · site: ${order.scannedUrl ?? "(none)"}`;
}
