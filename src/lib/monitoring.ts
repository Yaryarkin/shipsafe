import { z } from "zod";

/**
 * Demand test for a planned "continuous monitoring" subscription. Nothing is sold and nobody is charged:
 * people leave an email, the owner gets a Telegram message, and that tells us whether it's worth building.
 */
export const MONITORING_PLAN_IDS = ["web", "builds"] as const;
export type MonitoringPlanId = (typeof MONITORING_PLAN_IDS)[number];

export const MONITORING_PLANS: Record<MonitoringPlanId, { label: string; blurb: string; planned: string }> = {
  web: {
    label: "Websites & APIs",
    blurb: "Automatic scan every day, alert when a new issue appears, live score badge.",
    planned: "Planned: from $9/mo",
  },
  builds: {
    label: "Game & app builds",
    blurb: "Check every new .apk / .zip build before release, with a history of scores.",
    planned: "Planned: from $19/mo",
  },
};

export const monitoringRequestSchema = z.object({
  email: z
    .string({ required_error: "Email is required.", invalid_type_error: "Email must be a string." })
    .trim()
    .toLowerCase()
    .max(254, "Email is too long.")
    .email("Enter a valid email address."),
  plan: z.enum(MONITORING_PLAN_IDS).default("web"),
  site: z
    .string()
    .trim()
    .max(2048)
    .url("Enter the site URL as https://your-app.com.")
    .refine((value) => /^https?:\/\//i.test(value), "site must be an http(s) URL.")
    .optional(),
  /** Honeypot: hidden from humans, bots tend to fill it. */
  hp: z.string().max(200).optional(),
});

export const monitoringResponseSchema = z.object({
  ok: z.literal(true),
  delivered: z.boolean(),
});

export type MonitoringRequest = z.infer<typeof monitoringRequestSchema>;
export type MonitoringResponse = z.infer<typeof monitoringResponseSchema>;

export function buildMonitoringMessage(request: MonitoringRequest, now: Date = new Date()): string {
  const plan = MONITORING_PLANS[request.plan];
  return [
    `New monitoring waitlist signup — ${plan.label}`,
    "(demand test: nothing was sold, nobody was charged)",
    "",
    `Plan: ${plan.label} (${plan.planned})`,
    `Email: ${request.email}`,
    `Site: ${request.site ?? "(none)"}`,
    `Time: ${now.toISOString()}`,
  ].join("\n");
}

/** One self-contained server log line, so every signup can be recovered from Vercel logs alone. */
export function buildMonitoringLogLine(request: MonitoringRequest): string {
  return `[shipsafe] monitoring waitlist [${request.plan}]: ${request.email} · site: ${request.site ?? "(none)"}`;
}
