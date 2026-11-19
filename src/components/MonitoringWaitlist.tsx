"use client";

import { useState, type FormEvent } from "react";
import { apiErrorSchema } from "@/lib/scanner/types";
import {
  MONITORING_PLAN_IDS,
  MONITORING_PLANS,
  monitoringResponseSchema,
  type MonitoringPlanId,
} from "@/lib/monitoring";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = 15_000;

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-line bg-ink px-3 text-sm text-fg placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60";

function normalizeSite(raw: string): string | undefined | "invalid" {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.includes(".") ? url.href : "invalid";
  } catch {
    return "invalid";
  }
}

export function MonitoringWaitlist({ defaultSite }: { defaultSite?: string }) {
  const [plan, setPlan] = useState<MonitoringPlanId>("web");
  const [email, setEmail] = useState("");
  const [site, setSite] = useState(defaultSite ?? "");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") return;
    const emailValue = email.trim();
    if (!EMAIL_PATTERN.test(emailValue)) return setError("Enter a valid email address.");
    const siteValue = normalizeSite(site);
    if (siteValue === "invalid") return setError("Enter the site as https://your-app.com.");

    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch("/api/monitoring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: emailValue,
          plan,
          ...(siteValue ? { site: siteValue } : {}),
          ...(honeypot ? { hp: honeypot } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(data);
        throw new Error(parsedError.success ? parsedError.data.error.message : `Request failed (HTTP ${response.status}).`);
      }
      if (!monitoringResponseSchema.safeParse(data).success) {
        throw new Error("Unexpected response from the server. Please try again.");
      }
      setStatus("done");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <section id="monitoring" aria-labelledby="monitoring-title" className="scroll-mt-20 rounded-xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="monitoring-title" className="text-base font-semibold">
          Continuous monitoring
        </h2>
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-400">
          Coming soon
        </span>
      </div>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">
        A single scan is a snapshot. We&apos;re building automatic re-scans that alert you the moment something new leaks. Join the
        waitlist to get early access — <strong className="font-medium text-zinc-200">free, no payment, no spam</strong>.
      </p>

      {status === "done" ? (
        <p className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300" role="status">
          You&apos;re on the list. We&apos;ll email you once when early access opens.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Plan</legend>
            {MONITORING_PLAN_IDS.map((id) => {
              const item = MONITORING_PLANS[id];
              const selected = plan === id;
              return (
                <label
                  key={id}
                  className={`cursor-pointer rounded-md border p-3 text-sm transition-colors ${
                    selected ? "border-emerald-500/60 bg-emerald-500/5" : "border-line bg-ink hover:border-zinc-600"
                  }`}
                >
                  <input type="radio" name="monitoring-plan" value={id} checked={selected} onChange={() => setPlan(id)} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-zinc-500">{item.planned}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-400">{item.blurb}</span>
                </label>
              );
            })}
          </fieldset>

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={status === "submitting"}
              className={inputClass}
            />
            <input
              type="text"
              inputMode="url"
              placeholder="https://your-app.com (optional)"
              aria-label="Site (optional)"
              value={site}
              onChange={(event) => setSite(event.target.value)}
              disabled={status === "submitting"}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={status === "submitting"}
              className="h-10 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
            >
              {status === "submitting" ? "Sending…" : "Join the waitlist"}
            </button>
          </div>

          {/* Honeypot: visually hidden, skipped by keyboard and screen readers. */}
          <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="monitoring-hp">Leave this field empty</label>
            <input
              id="monitoring-hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
