import { describe, expect, it } from "vitest";
import { buildOrderLogLine, buildTelegramOrderMessage } from "../order-notifications";
import {
  DEFAULT_TIER,
  PRICE_LIST_USD,
  PRICING_TIERS,
  STARTING_PRICE_USD,
  TIER_IDS,
  tierLabel,
  UI_DEFAULT_TIER,
  type TierId,
} from "../payments";
import { buildOrderReceipt } from "../receipt";
import { waitlistRequestSchema, type WaitlistRequest } from "../waitlist";

const ORDER_ID = "SS-7KQ2MX";
const TX = "https://solscan.io/tx/TESTONLYabc123";

function order(tier: TierId, txHash?: string): WaitlistRequest {
  return waitlistRequestSchema.parse({ email: "founder@example.com", scannedUrl: "https://my-app.com/", tier, txHash });
}

describe("pricing tiers", () => {
  it("offers exactly three tiers, cheapest first: $10 quick, $20 fix pack, $49 full", () => {
    expect(TIER_IDS).toEqual(["quick", "fix", "full"]);
    expect(PRICING_TIERS.quick.priceUsd).toBe(10);
    expect(PRICING_TIERS.fix.priceUsd).toBe(20);
    expect(PRICING_TIERS.full.priceUsd).toBe(49);
    expect(STARTING_PRICE_USD).toBe(10);
    expect(PRICE_LIST_USD).toBe("$10 / $20 / $49");
    const prices = TIER_IDS.map((id) => PRICING_TIERS[id].priceUsd);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("names and delivery times match the offer", () => {
    expect(PRICING_TIERS.quick.name).toBe("Quick Config & Fix Review");
    expect(PRICING_TIERS.quick.delivery).toBe("within a few hours");
    expect(PRICING_TIERS.fix.name).toBe("Code & Config Fix Pack");
    expect(PRICING_TIERS.fix.delivery).toBe("within 12 hours");
    expect(PRICING_TIERS.full.name).toBe("Full Repo & Game Audit");
    expect(PRICING_TIERS.full.delivery).toBe("within 24 hours");
    for (const id of TIER_IDS) {
      expect(PRICING_TIERS[id].id).toBe(id);
      expect(PRICING_TIERS[id].includes.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("builds short price labels", () => {
    expect(tierLabel("quick")).toBe("$10 Quick Review");
    expect(tierLabel("fix")).toBe("$20 Code & Config Fix Pack");
    expect(tierLabel("full")).toBe("$49 Full Repo & Game Audit");
  });

  it("defaults the API to $49 (backward compatible) and the UI to the $10 entry tier", () => {
    expect(DEFAULT_TIER).toBe("full");
    expect(UI_DEFAULT_TIER).toBe("quick");
  });
});

describe("order schema tier", () => {
  it("defaults to full when no tier is sent (pre-v1.4 clients)", () => {
    expect(waitlistRequestSchema.parse({ email: "a@example.com" }).tier).toBe("full");
  });

  it.each(["quick", "fix", "full"] as const)("accepts tier %s", (tier) => {
    expect(waitlistRequestSchema.parse({ email: "a@example.com", tier }).tier).toBe(tier);
  });

  it.each(["premium", "QUICK", "", 10])("rejects unknown tier %s", (tier) => {
    expect(waitlistRequestSchema.safeParse({ email: "a@example.com", tier }).success).toBe(false);
  });
});

describe("Telegram notification per tier", () => {
  const now = new Date("2026-11-17T10:00:00.000Z");

  it("leads a paid $10 order with the quick tier and price", () => {
    const text = buildTelegramOrderMessage(order("quick", TX), ORDER_ID, now);
    expect(text.split("\n")[0]).toBe("NEW PAID ORDER — $10 Quick Review");
    expect(text).toContain("Tier: $10 Quick Review");
    expect(text).toContain(`Transaction: ${TX}`);
    expect(text).toContain(`Order ID: ${ORDER_ID}`);
    expect(text).not.toContain("$49");
  });

  it("leads a paid $49 order with the full tier and price", () => {
    const text = buildTelegramOrderMessage(order("full", TX), ORDER_ID, now);
    expect(text.split("\n")[0]).toBe("NEW PAID ORDER — $49 Full Repo & Game Audit");
    expect(text).toContain("Verify the payment on-chain");
    expect(text).not.toContain("$10");
  });

  it("leads a paid $20 order with the fix pack tier and price", () => {
    const text = buildTelegramOrderMessage(order("fix", TX), ORDER_ID, now);
    expect(text.split("\n")[0]).toBe("NEW PAID ORDER — $20 Code & Config Fix Pack");
    expect(text).toContain("Tier: $20 Code & Config Fix Pack");
    expect(text).not.toContain("$10");
    expect(text).not.toContain("$49");
  });

  it("labels unpaid inquiries with the tier they asked about", () => {
    const text = buildTelegramOrderMessage(order("quick"), ORDER_ID, now);
    expect(text.split("\n")[0]).toBe("New ShipSafe Pro inquiry — $10 Quick Review");
    expect(text).not.toContain("Transaction:");
    expect(text).toContain("Time: 2026-11-17T10:00:00.000Z");
  });
});

describe("server log line per tier", () => {
  it.each([
    ["quick", "[$10 Quick Review]"],
    ["fix", "[$20 Code & Config Fix Pack]"],
    ["full", "[$49 Full Repo & Game Audit]"],
  ] as const)("includes the %s tier label", (tier, label) => {
    const line = buildOrderLogLine(order(tier, TX), ORDER_ID);
    expect(line).toContain(label);
    expect(line).toContain(`paid order (tx: ${TX}) ${ORDER_ID}`);
    expect(line).toContain("founder@example.com");
  });
});

describe("receipt per tier", () => {
  const base = { orderId: ORDER_ID, email: "founder@example.com", site: "https://my-app.com/", submittedAt: "2026-11-17T10:00:00.000Z" };

  it("shows the $10 product on a paid quick order", () => {
    const receipt = buildOrderReceipt({ ...base, tier: "quick", txHash: TX });
    expect(receipt).toContain("Product: $10 Quick Review (paid)");
    expect(receipt).toContain(`Transaction Hash: ${TX}`);
  });

  it("shows the $20 product on a paid fix pack order", () => {
    expect(buildOrderReceipt({ ...base, tier: "fix", txHash: TX })).toContain("Product: $20 Code & Config Fix Pack (paid)");
  });

  it("shows the $49 product on a paid full order", () => {
    expect(buildOrderReceipt({ ...base, tier: "full", txHash: TX })).toContain("Product: $49 Full Repo & Game Audit (paid)");
  });

  it("marks inquiries as unpaid for either tier", () => {
    expect(buildOrderReceipt({ ...base, tier: "quick", txHash: null })).toContain("Product: $10 Quick Review — inquiry (unpaid)");
    expect(buildOrderReceipt({ ...base, tier: "full", txHash: null })).toContain("Product: $49 Full Repo & Game Audit — inquiry (unpaid)");
  });
});
