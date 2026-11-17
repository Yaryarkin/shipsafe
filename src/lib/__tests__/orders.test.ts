import { describe, expect, it } from "vitest";
import { generateOrderId, ORDER_ID_ALPHABET, ORDER_ID_PATTERN } from "../order-id";
import { buildOrderReceipt } from "../receipt";
import { buildShareText, buildXIntentUrl } from "../share";
import { waitlistResponseSchema } from "../waitlist";

describe("generateOrderId", () => {
  it("returns IDs shaped like SS-XXXXXX", () => {
    for (let index = 0; index < 200; index += 1) {
      const id = generateOrderId();
      expect(id).toMatch(ORDER_ID_PATTERN);
      expect(id).toHaveLength(9);
    }
  });

  it("never uses ambiguous characters (0, O, 1, I, L)", () => {
    expect(ORDER_ID_ALPHABET).not.toMatch(/[01OIL]/);
    const ids = Array.from({ length: 500 }, generateOrderId).join("");
    expect(ids.slice(3)).not.toMatch(/[01OIL]/);
  });

  it("is practically unique", () => {
    const ids = new Set(Array.from({ length: 5_000 }, generateOrderId));
    expect(ids.size).toBeGreaterThanOrEqual(4_995);
  });

  it("produces IDs accepted by the API response schema", () => {
    const parsed = waitlistResponseSchema.safeParse({ ok: true, delivered: false, orderId: generateOrderId() });
    expect(parsed.success).toBe(true);
  });

  it("rejects responses with a missing or malformed orderId", () => {
    expect(waitlistResponseSchema.safeParse({ ok: true, delivered: true }).success).toBe(false);
    expect(waitlistResponseSchema.safeParse({ ok: true, delivered: true, orderId: "SS-12345" }).success).toBe(false);
    expect(waitlistResponseSchema.safeParse({ ok: true, delivered: true, orderId: "SS-ABCDEO" }).success).toBe(false);
  });
});

describe("buildOrderReceipt", () => {
  const base = {
    orderId: "SS-7KQ2MX",
    tier: "full" as const,
    email: "founder@example.com",
    site: "https://my-app.com/",
    submittedAt: "2026-11-16T12:00:00.000Z",
  };

  it("includes order ID, site, email and transaction hash for paid orders", () => {
    const receipt = buildOrderReceipt({ ...base, txHash: "https://solscan.io/tx/abc123" });
    expect(receipt).toContain("Order ID: SS-7KQ2MX");
    expect(receipt).toContain("Site: https://my-app.com/");
    expect(receipt).toContain("Email: founder@example.com");
    expect(receipt).toContain("Transaction Hash: https://solscan.io/tx/abc123");
    expect(receipt).toContain("$49 Full Repo & RLS Audit (paid)");
  });

  it("marks inquiries as unpaid and handles missing fields", () => {
    const receipt = buildOrderReceipt({ ...base, site: null, txHash: null });
    expect(receipt).toContain("$49 Full Repo & RLS Audit — inquiry (unpaid)");
    expect(receipt).toContain("Site: (not provided)");
    expect(receipt).toContain("Transaction Hash: (none)");
  });

  it("starts with a clear heading line", () => {
    expect(buildOrderReceipt({ ...base, txHash: null }).split("\n")[0]).toBe("ShipSafe order receipt");
  });
});

describe("buildXIntentUrl", () => {
  it("builds a twitter.com intent link with the fully encoded share text", () => {
    const text = buildShareText(92, "A", "https://shipsafe-six-iota.vercel.app");
    const url = new URL(buildXIntentUrl(text));
    expect(url.origin).toBe("https://twitter.com");
    expect(url.pathname).toBe("/intent/tweet");
    expect(url.searchParams.get("text")).toBe(text);
  });

  it("encodes characters that would otherwise break the query string", () => {
    const url = buildXIntentUrl("a & b # c ? d's 100/100");
    expect(url).not.toContain(" ");
    expect(url).not.toContain("&b");
    expect(url).toContain("%26");
    expect(url).toContain("%23");
  });
});
