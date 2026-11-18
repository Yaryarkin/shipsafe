import { STARTING_PRICE_USD } from "@/lib/payments";
import type { Finding } from "@/lib/scanner/types";

/**
 * Contextual paid-audit offer shown inside a finding at the moment of highest pain: every critical
 * finding, plus non-passed findings about database rules, leaked secrets or debuggable builds.
 */

const HIGH_PAIN_IDS = /supabase|firebase|google-services|^secrets\.|android-debuggable|credentials-file|signing-keys|env-file|electron/;

export const WEB_AUDIT_OFFER = `Need help locking down RLS rules, keys & server routes? Get a human audit from $${STARTING_PRICE_USD} →`;
export const BUILD_AUDIT_OFFER = `Shipping a game or mobile app? We manually audit builds, APIs & anti-cheat endpoints from $${STARTING_PRICE_USD} →`;

export function auditOfferFor(finding: Finding, isBuild: boolean): string | null {
  if (finding.severity === "passed") return null;
  const relevant = finding.severity === "critical" || HIGH_PAIN_IDS.test(finding.id);
  if (!relevant) return null;
  return isBuild ? BUILD_AUDIT_OFFER : WEB_AUDIT_OFFER;
}
