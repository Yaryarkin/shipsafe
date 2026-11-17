import { randomInt } from "node:crypto";

/** No 0/O/1/I/L so IDs can be read aloud or retyped from a screenshot without ambiguity. */
export const ORDER_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ORDER_ID_PATTERN = /^SS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** Short, human-friendly order reference such as `SS-7KQ2MX` (31^6 ≈ 887M combinations, CSPRNG). */
export function generateOrderId(): string {
  let id = "";
  for (let index = 0; index < 6; index += 1) id += ORDER_ID_ALPHABET[randomInt(ORDER_ID_ALPHABET.length)];
  return `SS-${id}`;
}
