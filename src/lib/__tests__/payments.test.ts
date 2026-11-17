import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAYMENT_OPTIONS, PRO_AUDIT_PRICE_USD } from "../payments";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(value: string): Buffer {
  let number = 0n;
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base58 character "${char}"`);
    number = number * 58n + BigInt(index);
  }
  let hex = number === 0n ? "" : number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leadingZeros = value.length - value.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(hex, "hex")]);
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

function isValidTronAddress(address: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  const bytes = base58Decode(address);
  if (bytes.length !== 25 || bytes[0] !== 0x41) return false;
  const payload = bytes.subarray(0, 21);
  const checksum = bytes.subarray(21);
  return sha256(sha256(payload)).subarray(0, 4).equals(checksum);
}

function isValidSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  return base58Decode(address).length === 32;
}

describe("crypto payment options", () => {
  it("prices the Pro audit at $49", () => {
    expect(PRO_AUDIT_PRICE_USD).toBe(49);
  });

  it("offers exactly Solana and Tron", () => {
    expect(PAYMENT_OPTIONS.map((option) => option.id)).toEqual(["solana", "tron"]);
  });

  it("has a valid Solana address (decodes to a 32-byte public key)", () => {
    const solana = PAYMENT_OPTIONS.find((option) => option.id === "solana");
    expect(solana?.address).toBe("CTVymMDpRjPFTrU1Z2QE71MuMGpUqDoybe1x7wDy8rFb");
    expect(isValidSolanaAddress(solana?.address ?? "")).toBe(true);
  });

  it("has a valid Tron address (base58check checksum and 0x41 version byte)", () => {
    const tron = PAYMENT_OPTIONS.find((option) => option.id === "tron");
    expect(tron?.address).toBe("T9zXkVGBwwLCm3h8HXUSArkfPo7PUjX3Ui");
    expect(isValidTronAddress(tron?.address ?? "")).toBe(true);
  });

  it("detects a single-character typo in a Tron address", () => {
    const tron = PAYMENT_OPTIONS.find((option) => option.id === "tron")?.address ?? "";
    const typo = `${tron.slice(0, 10)}${tron[10] === "a" ? "b" : "a"}${tron.slice(11)}`;
    expect(isValidTronAddress(typo)).toBe(false);
  });

  it("has no whitespace or invisible characters in any address", () => {
    for (const option of PAYMENT_OPTIONS) expect(option.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });
});
