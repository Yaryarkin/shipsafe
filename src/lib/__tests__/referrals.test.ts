import { describe, expect, it, vi } from "vitest";
import { PRICING_TIERS } from "../payments";
import {
  buildInvoicePayload,
  createMemoryReferralStore,
  createRedisReferralStore,
  createTcpReferralStore,
  type RedisConnection,
  discountedStars,
  discountedUsd,
  discountPercent,
  friendsToNextDiscount,
  formatUsd,
  isValidDiscountPercent,
  parseInvoicePayload,
  parseReferralPayload,
  priceLine,
  pricesText,
  REFERRAL_MAX_FRIENDS,
  REFERRAL_MAX_PERCENT,
  referralLink,
  referralStoreFromEnv,
  referralText,
  referrerNotification,
} from "../referrals";
import { buildStarsInvoice } from "../telegram-webhook";

describe("discount rule: every 15 friends = 10%, capped at 50% (75 friends)", () => {
  it("grows in steps of 10% per 15 friends and stops at the cap", () => {
    expect(REFERRAL_MAX_PERCENT).toBe(50);
    expect(REFERRAL_MAX_FRIENDS).toBe(75);
    const expected: Array<[number, number]> = [
      [0, 0], [1, 0], [14, 0], [15, 10], [16, 10], [29, 10], [30, 20], [44, 20], [45, 30], [59, 30], [60, 40], [74, 40], [75, 50], [76, 50], [10_000, 50],
    ];
    for (const [friends, percent] of expected) expect(discountPercent(friends), `${friends} friends`).toBe(percent);
  });

  it("counts down to the next step and stops at the maximum", () => {
    expect(friendsToNextDiscount(0)).toBe(15);
    expect(friendsToNextDiscount(1)).toBe(14);
    expect(friendsToNextDiscount(14)).toBe(1);
    expect(friendsToNextDiscount(15)).toBe(15);
    expect(friendsToNextDiscount(29)).toBe(1);
    expect(friendsToNextDiscount(74)).toBe(1);
    expect(friendsToNextDiscount(75)).toBeNull();
    expect(friendsToNextDiscount(500)).toBeNull();
    expect(friendsToNextDiscount(-3)).toBe(15);
  });

  it("treats bad input as no discount and rounds partial friends down", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(discountPercent(bad)).toBe(0);
    expect(discountPercent(14.9)).toBe(0);
    expect(discountPercent(15.9)).toBe(10);
  });

  it("takes the same number of Stars off every tier", () => {
    expect(discountedStars(500, 0)).toBe(500);
    expect(discountedStars(500, 10)).toBe(450);
    expect(discountedStars(1200, 10)).toBe(1080);
    expect(discountedStars(3500, 10)).toBe(3150);
    expect(discountedStars(500, 50)).toBe(250);
    expect(discountedStars(1200, 50)).toBe(600);
    expect(discountedStars(3500, 50)).toBe(1750);
  });

  it("rounds to a whole Star, never goes below 1, and clamps a wrong percent into 0-50", () => {
    expect(discountedStars(500, 33)).toBe(335);
    expect(discountedStars(1, 50)).toBe(1);
    expect(discountedStars(2, 50)).toBe(1);
    expect(discountedStars(500, 99)).toBe(250);
    expect(discountedStars(500, -20)).toBe(500);
    expect(Number.isInteger(discountedStars(1234, 17))).toBe(true);
  });

  it("prices every tier consistently at each step from 0 to 50 percent", () => {
    for (let percent = 0; percent <= 50; percent += 1) {
      for (const tier of Object.values(PRICING_TIERS)) {
        const stars = discountedStars(tier.starsAmount, percent);
        expect(stars).toBeGreaterThan(0);
        expect(stars).toBeLessThanOrEqual(tier.starsAmount);
        expect(stars).toBeGreaterThanOrEqual(tier.starsAmount / 2 - 1);
      }
    }
  });

  it("does the USD amounts to the cent", () => {
    expect(discountedUsd(10, 10)).toBe(9);
    expect(discountedUsd(20, 10)).toBe(18);
    expect(discountedUsd(49, 10)).toBe(44.1);
    expect(discountedUsd(49, 1)).toBe(48.51);
    expect(discountedUsd(49, 50)).toBe(24.5);
    expect(formatUsd(9)).toBe("$9");
    expect(formatUsd(44.1)).toBe("$44.10");
    expect(formatUsd(24.5)).toBe("$24.50");
  });

  it("validates a discount percent", () => {
    expect(isValidDiscountPercent(0)).toBe(true);
    expect(isValidDiscountPercent(50)).toBe(true);
    for (const bad of [51, -1, 1.5, "10", null, undefined, Number.NaN]) expect(isValidDiscountPercent(bad)).toBe(false);
  });
});

describe("links and payloads", () => {
  it("builds a personal link and reads it back", () => {
    expect(referralLink(123456, "shipsafe_orders_bot")).toBe("https://t.me/shipsafe_orders_bot?start=ref_123456");
    expect(parseReferralPayload("ref_123456")).toBe(123456);
  });

  it("rejects anything that is not a plain positive id", () => {
    for (const bad of [null, undefined, "", "ref_", "ref_0", "ref_007", "ref_-5", "ref_1.5", "REF_5", "ref_5x", "pay_quick", "ref_1234567890123456"]) {
      expect(parseReferralPayload(bad)).toBeNull();
    }
  });

  it("puts the discount into the invoice payload only when there is one", () => {
    expect(buildInvoicePayload("quick", 0)).toBe("quick");
    expect(buildInvoicePayload("fix", 12)).toBe("fix:12");
    expect(buildInvoicePayload("full", 90)).toBe("full:50");
    expect(parseInvoicePayload("quick")).toEqual({ tier: "quick", percent: 0 });
    expect(parseInvoicePayload("fix:12")).toEqual({ tier: "fix", percent: 12 });
    for (const bad of ["", "vip", "vip:10", "quick:", "quick:0", "quick:51", "quick:-1", "quick:1.5", "quick:abc", "quick:10:2", ":10"]) {
      expect(parseInvoicePayload(bad), bad).toBeNull();
    }
  });

  it("payloads stay far below Telegram's 128-byte limit", () => {
    expect(Buffer.byteLength(buildInvoicePayload("full", 50))).toBeLessThan(16);
  });
});

describe("the Stars invoice follows the discount", () => {
  it("charges the full price with no discount, exactly as before", () => {
    expect(buildStarsInvoice("42", "quick")).toMatchObject({ payload: "quick", currency: "XTR", prices: [{ amount: 500 }] });
  });

  it("charges the discounted amount and records the percent in the payload", () => {
    const invoice = buildStarsInvoice("42", "full", 20);
    expect(invoice.payload).toBe("full:20");
    expect(invoice.prices).toEqual([{ label: "ShipSafe Full Repo & Game Audit", amount: 2800 }]);
    expect(invoice.description).toContain("20% referral discount");
    expect(invoice.description.length).toBeLessThanOrEqual(255);
    expect(invoice.title.length).toBeLessThanOrEqual(32);
  });

  it("the maximum discount halves every price", () => {
    for (const tier of Object.values(PRICING_TIERS)) {
      expect(buildStarsInvoice("1", tier.id, 50).prices[0]?.amount).toBe(discountedStars(tier.starsAmount, 50));
    }
  });
});

describe("messages", () => {
  it("shows list prices to a user without a discount and points to the referral program", () => {
    const text = pricesText(0);
    expect(text).toContain("• Quick Config & Fix Review: $10 or 500 ⭐");
    expect(text).toContain("/referral");
    expect(text).not.toContain("instead of");
  });

  it("shows both prices when a discount applies", () => {
    expect(priceLine("full", 10)).toContain("$44.10 or 3,150 ⭐ instead of $49 / 3,500 ⭐");
    expect(pricesText(10)).toContain("Your referral discount: 10% off");
  });

  it("explains the program, shows the link, count and next step", () => {
    const text = referralText({ enabled: true, friends: 20, link: referralLink(42, "shipsafe_orders_bot") });
    expect(text).toContain("Every 15 friends who start the bot through your link give you 10% off, up to 50% at 75 friends");
    expect(text).toContain("https://t.me/shipsafe_orders_bot?start=ref_42");
    expect(text).toContain("Friends invited: 20");
    expect(text).toContain("Your discount: 10%");
    expect(text).toContain("Next discount: 20% off, 10 more friends to go.");
    expect(referralText({ enabled: true, friends: 29, link: "x" })).toContain("1 more friend to go.");
    expect(referralText({ enabled: true, friends: 3, link: "x" })).toContain("Your discount: 0%");
  });

  it("marks the maximum and stops promising more", () => {
    const text = referralText({ enabled: true, friends: 80, link: "https://t.me/x?start=ref_1" });
    expect(text).toContain("Your discount: 50% (maximum)");
    expect(text).not.toContain("Next discount");
  });

  it("is honest when the program is not switched on yet", () => {
    const text = referralText({ enabled: false, friends: 0, link: "x" });
    expect(text).toContain("being switched on");
    expect(text).not.toContain("https://");
  });

  it("tells the referrer about the new friend and the new discount", () => {
    expect(referrerNotification(3)).toContain("Friends: 3");
    expect(referrerNotification(3)).toContain("12 more for 10% off");
    expect(referrerNotification(14)).toContain("1 more for 10% off");
    expect(referrerNotification(15)).toContain("New discount unlocked: 10% off");
    expect(referrerNotification(30)).toContain("New discount unlocked: 20% off");
    expect(referrerNotification(75)).toContain("New discount unlocked: 50% off (maximum)");
    expect(referrerNotification(76)).toContain("You have the maximum discount");
  });
});

describe("in-memory store", () => {
  it("credits a friend once, on their very first start", async () => {
    const store = createMemoryReferralStore();
    expect(await store.registerStart(2, 1)).toEqual({ firstStart: true, credited: true, referrerFriends: 1 });
    expect(await store.registerStart(2, 1)).toEqual({ firstStart: false, credited: false, referrerFriends: null });
    expect(await store.friendCount(1)).toBe(1);
  });

  it("does not credit a user who had already started the bot, even through a link", async () => {
    const store = createMemoryReferralStore();
    await store.registerStart(2, null);
    expect(await store.registerStart(2, 1)).toMatchObject({ firstStart: false, credited: false });
    expect(await store.friendCount(1)).toBe(0);
  });

  it("does not credit inviting yourself or a start without a referrer", async () => {
    const store = createMemoryReferralStore();
    expect(await store.registerStart(5, 5)).toEqual({ firstStart: true, credited: false, referrerFriends: null });
    expect(await store.registerStart(6, null)).toEqual({ firstStart: true, credited: false, referrerFriends: null });
    expect(await store.friendCount(5)).toBe(0);
  });

  it("counts many friends up to and beyond the cap, with the discount capped", async () => {
    const store = createMemoryReferralStore();
    for (let friend = 100; friend < 160; friend += 1) await store.registerStart(friend, 1);
    expect(await store.friendCount(1)).toBe(60);
    expect(discountPercent(await store.friendCount(1))).toBe(40);
    for (let friend = 200; friend < 230; friend += 1) await store.registerStart(friend, 1);
    expect(await store.friendCount(1)).toBe(90);
    expect(discountPercent(await store.friendCount(1))).toBe(50);
  });

  it("keeps each referrer's count separate", async () => {
    const store = createMemoryReferralStore();
    await store.registerStart(10, 1);
    await store.registerStart(11, 1);
    await store.registerStart(12, 2);
    expect(await store.friendCount(1)).toBe(2);
    expect(await store.friendCount(2)).toBe(1);
    expect(await store.friendCount(3)).toBe(0);
  });
});

describe("Redis (Upstash) store", () => {
  function fakeRedis() {
    const data = new Map<string, string>();
    const calls: unknown[][] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const commands = JSON.parse(String(init?.body)) as Array<Array<string | number>>;
      calls.push(...commands);
      const results = commands.map(([name, key, value, flag]) => {
        const k = String(key);
        if (name === "SET") {
          if (flag === "NX" && data.has(k)) return { result: null };
          data.set(k, String(value));
          return { result: "OK" };
        }
        if (name === "INCR") {
          const next = Number(data.get(k) ?? 0) + 1;
          data.set(k, String(next));
          return { result: next };
        }
        if (name === "GET") return { result: data.get(k) ?? null };
        return { error: "unknown command" };
      });
      return new Response(JSON.stringify(results), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetcher, calls, data };
  }

  it("registers a first start with SET NX, then increments the referrer", async () => {
    const { fetcher, calls } = fakeRedis();
    const store = createRedisReferralStore({ url: "https://redis.example/", token: "tok" }, fetcher);
    expect(await store.registerStart(2, 1)).toEqual({ firstStart: true, credited: true, referrerFriends: 1 });
    expect(calls[0]).toEqual(["SET", "shipsafe:referral:seen:2", 1, "NX"]);
    expect(calls[1]).toEqual(["INCR", "shipsafe:referral:friends:1"]);
    expect(await store.registerStart(2, 1)).toMatchObject({ firstStart: false, credited: false });
    expect(await store.friendCount(1)).toBe(1);
  });

  it("sends the token as a bearer header to the pipeline endpoint without a double slash", async () => {
    const { fetcher } = fakeRedis();
    const store = createRedisReferralStore({ url: "https://redis.example//", token: "s3cret" }, fetcher);
    await store.friendCount(9);
    const [url, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
    expect(url).toBe("https://redis.example/pipeline");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
  });

  it("never credits yourself and reads a missing counter as zero", async () => {
    const { fetcher } = fakeRedis();
    const store = createRedisReferralStore({ url: "https://redis.example", token: "t" }, fetcher);
    expect(await store.registerStart(7, 7)).toEqual({ firstStart: true, credited: false, referrerFriends: null });
    expect(await store.friendCount(404)).toBe(0);
  });

  it("surfaces a store outage or a Redis error instead of guessing", async () => {
    const down = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(createRedisReferralStore({ url: "https://r.example", token: "t" }, down).friendCount(1)).rejects.toThrow("HTTP 503");
    const broken = vi.fn(async () => new Response(JSON.stringify([{ error: "ERR boom" }]), { status: 200 })) as unknown as typeof fetch;
    await expect(createRedisReferralStore({ url: "https://r.example", token: "t" }, broken).friendCount(1)).rejects.toThrow("ERR boom");
  });

  it("ignores a corrupt counter value", async () => {
    const odd = vi.fn(async () => new Response(JSON.stringify([{ result: "not-a-number" }]), { status: 200 })) as unknown as typeof fetch;
    expect(await createRedisReferralStore({ url: "https://r.example", token: "t" }, odd).friendCount(1)).toBe(0);
  });
});

describe("Redis over TCP (REDIS_URL)", () => {
  function fakeConnection() {
    const data = new Map<string, string>();
    const log: string[] = [];
    let open = 0;
    const connection: RedisConnection = {
      async set(key, value, options) {
        log.push(`SET ${key} ${options.NX ? "NX" : ""}`);
        if (data.has(key)) return null;
        data.set(key, value);
        return "OK";
      },
      async incr(key) {
        log.push(`INCR ${key}`);
        const next = Number(data.get(key) ?? 0) + 1;
        data.set(key, String(next));
        return next;
      },
      async get(key) {
        log.push(`GET ${key}`);
        return data.get(key) ?? null;
      },
      async quit() {
        open -= 1;
      },
    };
    const connect = vi.fn(async () => {
      open += 1;
      return connection;
    });
    return { connect, log, data, openCount: () => open };
  }

  it("credits a friend once and counts them for the referrer", async () => {
    const { connect, log } = fakeConnection();
    const store = createTcpReferralStore("rediss://default:pw@redis.example:6379", connect);
    expect(await store.registerStart(2, 1)).toEqual({ firstStart: true, credited: true, referrerFriends: 1 });
    expect(await store.registerStart(2, 1)).toMatchObject({ firstStart: false, credited: false });
    expect(await store.friendCount(1)).toBe(1);
    expect(log[0]).toBe("SET shipsafe:referral:seen:2 NX");
    expect(log[1]).toBe("INCR shipsafe:referral:friends:1");
    expect(connect).toHaveBeenCalledWith("rediss://default:pw@redis.example:6379");
  });

  it("never credits yourself, and reads a missing counter as zero", async () => {
    const { connect } = fakeConnection();
    const store = createTcpReferralStore("redis://x", connect);
    expect(await store.registerStart(7, 7)).toEqual({ firstStart: true, credited: false, referrerFriends: null });
    expect(await store.friendCount(404)).toBe(0);
  });

  it("closes every connection it opens, even after a failure", async () => {
    const { connect, openCount } = fakeConnection();
    const store = createTcpReferralStore("redis://x", connect);
    await store.friendCount(1);
    await store.registerStart(3, 1);
    expect(openCount()).toBe(0);

    const failing: RedisConnection = {
      set: async () => {
        throw new Error("boom");
      },
      incr: async () => 0,
      get: async () => null,
      quit: vi.fn(async () => undefined),
    };
    await expect(createTcpReferralStore("redis://x", async () => failing).registerStart(5, 1)).rejects.toThrow("boom");
    expect(failing.quit).toHaveBeenCalled();
  });

  it("surfaces a connection failure instead of guessing", async () => {
    const store = createTcpReferralStore("redis://x", async () => {
      throw new Error("connect ETIMEDOUT");
    });
    await expect(store.friendCount(1)).rejects.toThrow("ETIMEDOUT");
  });

  it("ignores a corrupt counter value", async () => {
    const { connect, data } = fakeConnection();
    data.set("shipsafe:referral:friends:1", "garbage");
    expect(await createTcpReferralStore("redis://x", connect).friendCount(1)).toBe(0);
  });
});

describe("store configuration", () => {
  it("is off without credentials, so no discount is ever invented", () => {
    expect(referralStoreFromEnv({})).toBeNull();
    expect(referralStoreFromEnv({ UPSTASH_REDIS_REST_URL: "https://r.example" })).toBeNull();
    expect(referralStoreFromEnv({ UPSTASH_REDIS_REST_TOKEN: "t" })).toBeNull();
    expect(referralStoreFromEnv({ UPSTASH_REDIS_REST_URL: "  ", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeNull();
  });

  it("turns on with a standard REDIS_URL, but only for redis:// or rediss://", () => {
    expect(referralStoreFromEnv({ REDIS_URL: "rediss://default:pw@host.example:6379" })).not.toBeNull();
    expect(referralStoreFromEnv({ REDIS_URL: "redis://host.example:6379" })).not.toBeNull();
    for (const bad of ["", "   ", "https://host.example", "host.example:6379", "postgres://x"]) expect(referralStoreFromEnv({ REDIS_URL: bad }), bad).toBeNull();
  });

  it("prefers the REST credentials when both are present", () => {
    expect(referralStoreFromEnv({ UPSTASH_REDIS_REST_URL: "https://r.example", UPSTASH_REDIS_REST_TOKEN: "t", REDIS_URL: "redis://x" })).not.toBeNull();
  });

  it("turns on with Upstash or Vercel KV credentials", () => {
    expect(referralStoreFromEnv({ UPSTASH_REDIS_REST_URL: "https://r.example", UPSTASH_REDIS_REST_TOKEN: "t" })).not.toBeNull();
    expect(referralStoreFromEnv({ KV_REST_API_URL: "https://r.example", KV_REST_API_TOKEN: "t" })).not.toBeNull();
  });
});
