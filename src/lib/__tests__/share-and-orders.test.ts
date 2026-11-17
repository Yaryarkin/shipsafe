import { describe, expect, it } from "vitest";
import { buildShareText, SITE_URL } from "../share";
import { isValidTxReference, waitlistRequestSchema } from "../waitlist";

describe("buildShareText", () => {
  it("produces the exact ready-to-post snippet", () => {
    expect(buildShareText(87, "B", "https://shipsafe-six-iota.vercel.app")).toBe(
      "My site scored 87/100 (Grade B) on ShipSafe's 15-second pre-launch security check: https://shipsafe-six-iota.vercel.app",
    );
  });

  it("defaults to the production URL without a trailing slash", () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^\s]+[^/]$/);
    expect(buildShareText(100, "A")).toContain(SITE_URL);
  });

  it("fits in a single X/Twitter post", () => {
    expect(buildShareText(100, "A").length).toBeLessThanOrEqual(280);
  });
});

describe("waitlist / order schema", () => {
  const solanaSignature = "5".repeat(40) + "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMN";
  const tronTxId = "a1b2c3d4".repeat(8);

  it("accepts an inquiry without a transaction", () => {
    const parsed = waitlistRequestSchema.parse({ email: "  Founder@Example.COM ", scannedUrl: "https://my-app.com/" });
    expect(parsed.email).toBe("founder@example.com");
    expect(parsed.txHash).toBeUndefined();
  });

  it.each([
    ["Solana signature", solanaSignature],
    ["Tron tx id", tronTxId],
    ["0x-prefixed hash", `0x${tronTxId}`],
    ["explorer link", "https://solscan.io/tx/abc123"],
    ["Tronscan link", "https://tronscan.org/#/transaction/abc123"],
  ])("accepts a paid order with a %s", (_, txHash) => {
    expect(waitlistRequestSchema.safeParse({ email: "a@example.com", txHash }).success).toBe(true);
  });

  it.each([
    ["too short", "abc123"],
    ["http link", "http://solscan.io/tx/abc"],
    ["script injection", "<script>alert(1)</script>"],
    ["spaces", "abc def ghi jkl mno pqr stu vwx yz12 3456"],
    ["too long", "a".repeat(301)],
  ])("rejects a %s transaction reference", (_, txHash) => {
    expect(waitlistRequestSchema.safeParse({ email: "a@example.com", txHash }).success).toBe(false);
  });

  it("still requires a valid email for paid orders", () => {
    expect(waitlistRequestSchema.safeParse({ txHash: tronTxId }).success).toBe(false);
    expect(waitlistRequestSchema.safeParse({ email: "nope", txHash: tronTxId }).success).toBe(false);
  });

  it("exposes the same tx validator to the client", () => {
    expect(isValidTxReference(tronTxId)).toBe(true);
    expect(isValidTxReference("nope")).toBe(false);
  });
});
