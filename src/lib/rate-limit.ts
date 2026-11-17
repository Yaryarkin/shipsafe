/**
 * Fixed-memory sliding-window rate limiter (in-process).
 * Good for a single instance / MVP. For multi-region production, swap for Upstash Redis or Vercel KV.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Options {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: Options) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }

  return function check(key: string): RateLimitResult {
    const now = Date.now();
    sweep(now);

    const timestamps = (hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? now;
      hits.set(key, timestamps);
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    if (!hits.has(key) && hits.size >= maxKeys) {
      // Memory guard: drop the oldest key (Map preserves insertion order).
      const firstKey = hits.keys().next().value;
      if (firstKey !== undefined) hits.delete(firstKey);
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return { allowed: true, limit, remaining: limit - timestamps.length, retryAfterSeconds: 0 };
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || headers.get("cf-connecting-ip")?.trim() || "unknown";
}
