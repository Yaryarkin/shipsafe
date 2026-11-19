import { describe, expect, it } from "vitest";
import {
  buildMonitoringLogLine,
  buildMonitoringMessage,
  MONITORING_PLAN_IDS,
  MONITORING_PLANS,
  monitoringRequestSchema,
  monitoringResponseSchema,
} from "../monitoring";

describe("monitoringRequestSchema", () => {
  it("accepts an email alone and defaults to the web plan", () => {
    const parsed = monitoringRequestSchema.parse({ email: "  Founder@Example.COM " });
    expect(parsed.email).toBe("founder@example.com");
    expect(parsed.plan).toBe("web");
    expect(parsed.site).toBeUndefined();
  });

  it.each(MONITORING_PLAN_IDS)("accepts plan %s", (plan) => {
    expect(monitoringRequestSchema.parse({ email: "a@example.com", plan }).plan).toBe(plan);
  });

  it.each(["premium", "WEB", "", 1])("rejects unknown plan %s", (plan) => {
    expect(monitoringRequestSchema.safeParse({ email: "a@example.com", plan }).success).toBe(false);
  });

  it.each(["", "not-an-email", "a@b", "x".repeat(250) + "@example.com"])("rejects bad email %s", (email) => {
    expect(monitoringRequestSchema.safeParse({ email }).success).toBe(false);
  });

  it("requires an http(s) site when one is given", () => {
    expect(monitoringRequestSchema.safeParse({ email: "a@example.com", site: "https://my-app.com/" }).success).toBe(true);
    expect(monitoringRequestSchema.safeParse({ email: "a@example.com", site: "javascript:alert(1)" }).success).toBe(false);
    expect(monitoringRequestSchema.safeParse({ email: "a@example.com", site: "my-app.com" }).success).toBe(false);
  });

  it("requires an email", () => {
    expect(monitoringRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("monitoring notifications", () => {
  const now = new Date("2026-11-20T09:00:00.000Z");
  const request = monitoringRequestSchema.parse({ email: "a@example.com", plan: "builds", site: "https://my-game.com/" });

  it("tells the owner it is a demand test, with plan, email, site and time", () => {
    const text = buildMonitoringMessage(request, now);
    expect(text.split("\n")[0]).toBe("New monitoring waitlist signup — Game & app builds");
    expect(text).toContain("nothing was sold, nobody was charged");
    expect(text).toContain("Plan: Game & app builds (Planned: from $19/mo)");
    expect(text).toContain("Email: a@example.com");
    expect(text).toContain("Site: https://my-game.com/");
    expect(text).toContain("Time: 2026-11-20T09:00:00.000Z");
  });

  it("marks a missing site", () => {
    const text = buildMonitoringMessage(monitoringRequestSchema.parse({ email: "a@example.com" }), now);
    expect(text).toContain("Site: (none)");
  });

  it("writes one recoverable log line", () => {
    expect(buildMonitoringLogLine(request)).toBe("[shipsafe] monitoring waitlist [builds]: a@example.com · site: https://my-game.com/");
  });

  it("marks every plan as planned pricing, never as a live offer", () => {
    for (const id of MONITORING_PLAN_IDS) expect(MONITORING_PLANS[id].planned).toMatch(/^Planned:/);
  });
});

describe("monitoringResponseSchema", () => {
  it("accepts a well-formed response and rejects others", () => {
    expect(monitoringResponseSchema.safeParse({ ok: true, delivered: false }).success).toBe(true);
    expect(monitoringResponseSchema.safeParse({ ok: false, delivered: true }).success).toBe(false);
    expect(monitoringResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });
});
