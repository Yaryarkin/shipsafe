import { GRADES, type Grade } from "@/lib/scanner/types";

/**
 * Strict parsing for score-card parameters used by /api/og, /api/badge and the shareable
 * `/?s=94&g=A&p=62` landing URL. Anything that isn't exactly valid is rejected, so user input can
 * never reach rendered images or SVG markup unvalidated.
 */

export interface ScoreCardParams {
  score: number;
  grade: Grade;
  /** Previous score (only meaningful when lower than `score`). */
  prev: number | null;
  /** Sanitized scan target (domain or build name), ≤ 40 safe ASCII chars. */
  target: string | null;
}

type Raw = string | string[] | null | undefined;

function first(value: Raw): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** "0".."100" only — no signs, decimals, exponents or whitespace. */
export function parseScore(value: Raw): number | null {
  const raw = first(value);
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const score = Number(raw);
  return score >= 0 && score <= 100 ? score : null;
}

export function parseGrade(value: Raw): Grade | null {
  const raw = first(value);
  return raw !== null && (GRADES as readonly string[]).includes(raw) ? (raw as Grade) : null;
}

/** Keeps only letters, digits and . _ - : / space; collapses spaces; max 40 chars; empty → null. */
export function sanitizeTarget(value: Raw): string | null {
  const raw = first(value);
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^A-Za-z0-9._\-:/ ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return cleaned || null;
}

export interface ParamKeys {
  score: string;
  grade: string;
  prev: string;
  target: string;
}

export const API_PARAM_KEYS: ParamKeys = { score: "score", grade: "grade", prev: "prev", target: "target" };
/** Short keys used in the shareable landing URL: /?s=94&g=A&p=62 */
export const SHARE_PARAM_KEYS: ParamKeys = { score: "s", grade: "g", prev: "p", target: "t" };

/** Returns null unless both score and grade are valid. */
export function parseScoreCardParams(get: (key: string) => Raw, keys: ParamKeys = API_PARAM_KEYS): ScoreCardParams | null {
  const score = parseScore(get(keys.score));
  const grade = parseGrade(get(keys.grade));
  if (score === null || grade === null) return null;
  const prev = parseScore(get(keys.prev));
  return { score, grade, prev, target: sanitizeTarget(get(keys.target)) };
}

/** Upgrade badge data ("62 → 94 (+32 pts)") only when the score actually went up. */
export function scoreUpgrade(params: ScoreCardParams): { from: number; to: number; delta: number } | null {
  if (params.prev === null || params.score <= params.prev) return null;
  return { from: params.prev, to: params.score, delta: params.score - params.prev };
}

/** Relative /api/og URL for a score card (resolved against metadataBase by Next.js). */
export function ogImagePath(params: ScoreCardParams): string {
  const query = new URLSearchParams({ score: String(params.score), grade: params.grade });
  if (scoreUpgrade(params)) query.set("prev", String(params.prev));
  if (params.target) query.set("target", params.target);
  return `/api/og?${query.toString()}`;
}
