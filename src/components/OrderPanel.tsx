"use client";

import { ArrowRight, Check, Clock, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  formatStars,
  PAYMENT_METHODS,
  PAYMENT_OPTIONS,
  PRICING_TIERS,
  starsDeepLink,
  TIER_IDS,
  UI_DEFAULT_TIER,
  type PaymentMethodId,
  type TierId,
} from "@/lib/payments";
import { buildOrderReceipt } from "@/lib/receipt";
import { apiErrorSchema } from "@/lib/scanner/types";
import { isValidTxReference, waitlistResponseSchema } from "@/lib/waitlist";
import { CopyButton } from "./CopyButton";

/** Paste a Stripe Payment Link or Gumroad URL into NEXT_PUBLIC_PRO_CHECKOUT_URL to use card checkout instead. */
const CHECKOUT_URL = process.env.NEXT_PUBLIC_PRO_CHECKOUT_URL ?? "";
/** Non-blocking client flag only; the source of truth is POST /api/waitlist. */
const ORDER_STORAGE_KEY = "shipsafe:pro-order-email";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REQUEST_TIMEOUT_MS = 10_000;

type Status = "idle" | "submitting" | "error";
interface Submitted {
  orderId: string;
  tier: TierId;
  email: string;
  paid: boolean;
  site: string | null;
  txHash: string | null;
  submittedAt: string;
}

function readStoredEmail(): string | null {
  try {
    return window.localStorage.getItem(ORDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeEmail(email: string): void {
  try {
    window.localStorage.setItem(ORDER_STORAGE_KEY, email);
  } catch {
    // storage unavailable (private mode): the server already has the order
  }
}

/** "my-app.com" → "https://my-app.com/"; returns null for empty input and "invalid" for garbage. */
function normalizeSite(input: string): string | null | "invalid" {
  const value = input.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.href : "invalid";
  } catch {
    return "invalid";
  }
}

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-line bg-raised px-3 text-sm text-fg placeholder:text-faint focus:border-focus focus:outline-none disabled:opacity-60";

export function OrderPanel({ scannedUrl }: { scannedUrl?: string }) {
  const [tier, setTier] = useState<TierId>(UI_DEFAULT_TIER);
  const selected = PRICING_TIERS[tier];
  const [method, setMethod] = useState<PaymentMethodId>("solana");
  const cryptoOption = PAYMENT_OPTIONS.find((option) => option.id === method) ?? null;
  const [email, setEmail] = useState("");
  const [site, setSite] = useState("");
  const [txHash, setTxHash] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [previousEmail, setPreviousEmail] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreviousEmail(readStoredEmail());
    if (scannedUrl) setSite((current) => current || scannedUrl);
  }, [scannedUrl]);

  // Links from the bot or a teammate can preselect an audit: /order?tier=quick
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tier");
    if (requested && (TIER_IDS as readonly string[]).includes(requested)) setTier(requested as TierId);
  }, []);

  const submitting = status === "submitting";
  const isPaidOrder = txHash.trim().length > 0;

  const fail = (message: string) => {
    setStatus("error");
    setError(message);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const emailValue = email.trim();
    if (!EMAIL_PATTERN.test(emailValue)) return fail("Enter a valid email address.");
    const siteValue = normalizeSite(site);
    if (siteValue === "invalid") return fail("Enter the site to audit as https://your-app.com.");
    const txValue = txHash.trim();
    if (txValue && !isValidTxReference(txValue)) {
      return fail("Paste the transaction hash or an https:// block-explorer link.");
    }

    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: emailValue,
          tier,
          ...(siteValue ? { scannedUrl: siteValue } : {}),
          ...(txValue ? { txHash: txValue } : {}),
          ...(honeypot ? { hp: honeypot } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(data);
        throw new Error(parsedError.success ? parsedError.data.error.message : `Submission failed (HTTP ${response.status}).`);
      }
      const parsed = waitlistResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("Unexpected response from the server. Please try again.");
      }

      const normalizedEmail = emailValue.toLowerCase();
      storeEmail(normalizedEmail);
      setPreviousEmail(normalizedEmail);
      setSubmitted({
        orderId: parsed.data.orderId,
        tier,
        email: normalizedEmail,
        paid: Boolean(txValue),
        site: siteValue,
        txHash: txValue || null,
        submittedAt: new Date().toISOString(),
      });
      setTxHash("");
      setStatus("idle");
    } catch (caught) {
      if (caught instanceof Error && caught.name === "TimeoutError") fail("The request timed out. Please try again.");
      else fail(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <section aria-labelledby="pro-audit-title" className="reveal surface rounded-lg p-5 sm:p-8" style={{ "--i": 1 } as CSSProperties}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">ShipSafe Pro</p>
        <h2 id="pro-audit-title" className="mt-1.5 pr-8 text-xl font-semibold tracking-tight">
          Get a human security review
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The free scan sees what the public sees. An expert then reviews what it can&apos;t — from a quick config fix-up to a
          full audit of your code and database rules.
        </p>

        <div role="radiogroup" aria-label="Choose an audit" className="mt-4 grid gap-2 sm:grid-cols-3">
          {TIER_IDS.map((id) => {
            const option = PRICING_TIERS[id];
            const active = id === tier;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={submitting || Boolean(submitted)}
                onClick={() => setTier(id)}
                className={`rounded-lg border p-3.5 text-left transition-colors disabled:cursor-not-allowed ${
                  active ? "border-brand/60 bg-card" : "border-line bg-raised hover:border-line-strong"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-2xl font-semibold tabular-nums">${option.priceUsd}</span>
                  <span
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                      active ? "border-brand bg-brand" : "border-line-strong"
                    }`}
                    aria-hidden="true"
                  >
                    {active && <Check className="h-3 w-3 text-ink" strokeWidth={3} />}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-fg">{option.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{option.summary}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Delivered {option.delivery}
                </p>
              </button>
            );
          })}
        </div>

        <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {selected.name} includes
        </p>
        <ul className="mt-2 space-y-2">
          {selected.includes.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-soft">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t border-line pt-5">
          {CHECKOUT_URL ? (
            <a
              href={CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center gap-2 btn-primary rounded-md text-sm font-semibold text-ink transition-colors hover:bg-accent"
            >
              Continue to checkout
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : submitted ? (
            <div className="space-y-3" role="status">
              <div className="rounded-md border border-line bg-raised p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted">Order ID</p>
                    <p className="mt-0.5 font-mono text-2xl font-semibold tracking-wider text-fg" data-testid="order-id">
                      {submitted.orderId}
                    </p>
                  </div>
                  <CopyButton
                    label="Copy Order Receipt"
                    text={buildOrderReceipt({
                      orderId: submitted.orderId,
                      tier: submitted.tier,
                      email: submitted.email,
                      site: submitted.site,
                      txHash: submitted.txHash,
                      submittedAt: submitted.submittedAt,
                    })}
                  />
                </div>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">Product</dt>
                  <dd className="font-mono text-soft">
                    ${PRICING_TIERS[submitted.tier].priceUsd} {PRICING_TIERS[submitted.tier].name}
                  </dd>
                  <dt className="text-muted">Site</dt>
                  <dd className="truncate font-mono text-soft">{submitted.site ?? "(not provided)"}</dd>
                  <dt className="text-muted">Email</dt>
                  <dd className="truncate font-mono text-soft">{submitted.email}</dd>
                  {submitted.txHash && (
                    <>
                      <dt className="text-muted">Transaction</dt>
                      <dd className="break-all font-mono text-soft">{submitted.txHash}</dd>
                    </>
                  )}
                </dl>
                <p className="mt-3 text-xs text-muted">Save this receipt. Quote the Order ID in any follow-up about this order.</p>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-safe/25 bg-safe/10 px-3.5 py-3 text-sm text-safe">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {submitted.paid ? (
                    <>
                      Order received{submitted.site ? <> for <span className="font-mono">{new URL(submitted.site).host}</span></> : null}. We&apos;ll
                      verify your payment on-chain and email your {PRICING_TIERS[submitted.tier].shortName} to{" "}
                      <span className="font-mono">{submitted.email}</span> {PRICING_TIERS[submitted.tier].delivery}.
                    </>
                  ) : (
                    <>
                      Thanks — we got your message and will reply to <span className="font-mono">{submitted.email}</span> shortly.
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSubmitted(null)}
                className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
              >
                Submit another order
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <section aria-labelledby="pay-title">
                <h3 id="pay-title" className="text-sm font-medium">
                  Where &amp; how much to pay
                </h3>
                <div role="tablist" aria-label="Payment method" className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg border border-line bg-raised p-1">
                  {PAYMENT_METHODS.map((option) => {
                    const active = option.id === method;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        id={`pay-tab-${option.id}`}
                        aria-selected={active}
                        aria-controls="pay-panel"
                        disabled={submitting}
                        onClick={() => setMethod(option.id)}
                        className={`rounded-md px-2 py-2 text-left transition-colors ${active ? "bg-line text-fg" : "text-muted hover:text-fg"}`}
                      >
                        <span className="block text-xs font-medium sm:text-sm">{option.label}</span>
                        <span className="block text-[11px] text-muted">{option.sublabel}</span>
                      </button>
                    );
                  })}
                </div>

                <div id="pay-panel" role="tabpanel" aria-labelledby={`pay-tab-${method}`} className="mt-3">
                  {cryptoOption ? (
                    <>
                      <div className="rounded-md border border-line bg-raised p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">
                              Send <span className="font-mono text-fg">${selected.priceUsd}</span> in {cryptoOption.assets}
                            </span>
                            <span className="rounded border border-line bg-raised px-1.5 text-[11px] font-medium text-soft">
                              {cryptoOption.note}
                            </span>
                          </div>
                          <CopyButton text={cryptoOption.address} label="Copy address" />
                        </div>
                        <p className="mt-2 text-xs text-muted">{cryptoOption.network} address</p>
                        <p className="mt-0.5 break-all font-mono text-xs text-soft" aria-label={`${cryptoOption.network} address`}>
                          {cryptoOption.address}
                        </p>
                      </div>
                      <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-400/90">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Send exactly ${selected.priceUsd} on the {cryptoOption.network} network. Crypto transfers can&apos;t be reversed —
                        double-check the network and address before sending.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-md border border-line bg-raised p-4">
                      <p className="text-xs uppercase tracking-wide text-muted">Amount</p>
                      <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums" data-testid="stars-amount">
                        {formatStars(selected.starsAmount)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {selected.name} · pay by card or Apple Pay inside Telegram.
                      </p>
                      <a
                        href={starsDeepLink(tier)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 btn-primary rounded-md px-4 text-sm font-semibold text-ink transition-colors hover:bg-accent"
                      >
                        Pay with Telegram Stars
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </a>
                      <p className="mt-3 text-xs leading-relaxed text-muted">
                        The bot sends you an invoice for {formatStars(selected.starsAmount)}. After paying, reply to the bot with{" "}
                        <span className="text-fg">your email and the site URL</span> to audit — that&apos;s how we deliver your review.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {method !== "stars" && (
              <section aria-labelledby="order-title">
                <h3 id="order-title" className="text-sm font-medium">
                  2. Submit your order
                </h3>
                {previousEmail && (
                  <p className="mt-1 text-xs text-muted">
                    You already submitted from this browser as <span className="font-mono">{previousEmail}</span>. You can send another.
                  </p>
                )}
                <form onSubmit={handleSubmit} className="mt-2.5 space-y-2.5" noValidate aria-busy={submitting}>
                  <div className="space-y-1">
                    <label htmlFor="order-email" className="text-xs text-muted">
                      Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      id="order-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      required
                      value={email}
                      disabled={submitting}
                      onChange={(event) => setEmail(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="order-site" className="text-xs text-muted">
                      Site to audit
                    </label>
                    <input
                      id="order-site"
                      type="url"
                      inputMode="url"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="https://your-app.com"
                      value={site}
                      disabled={submitting}
                      onChange={(event) => setSite(event.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="order-tx" className="text-xs text-muted">
                      Transaction hash or explorer link <span className="text-faint">(optional — leave empty to just ask a question)</span>
                    </label>
                    <input
                      id="order-tx"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="e.g. 5h3x… or https://solscan.io/tx/…"
                      value={txHash}
                      disabled={submitting}
                      onChange={(event) => setTxHash(event.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>

                  {/* Honeypot: visually hidden, skipped by keyboard and screen readers. */}
                  <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
                    <label htmlFor="order-hp">Leave this field empty</label>
                    <input
                      id="order-hp"
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

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 btn-primary rounded-md px-4 text-sm font-semibold text-ink transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {submitting ? "Sending…" : isPaidOrder ? `Submit paid order ($${selected.priceUsd})` : "Send inquiry"}
                  </button>
                  <p className="text-center text-xs text-muted">
                    We verify every payment on-chain before starting. Questions first? Leave the transaction field empty.
                  </p>
                </form>
              </section>
              )}
            </div>
          )}
        </div>
    </section>
  );
}
