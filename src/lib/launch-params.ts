/**
 * Launch parameters: links such as `/?url=https://my-app.com&mode=url&scan=1` (for example from
 * the Telegram bot or a teammate) prefill the scanner. Everything is validated strictly; anything
 * else in the query string (share-card keys `s g p t`, `utm_*`, Telegram `start`) is left alone.
 */

export type LaunchMode = "url" | "build";

export interface LaunchParams {
  /** Normalized http(s) URL to prefill, or null. */
  url: string | null;
  mode: LaunchMode | null;
  /** True only when `scan=1` AND a valid URL is present (builds never auto-scan: they need a file). */
  autoScan: boolean;
}

/** Keys consumed (and then removed from the address bar) by the app. */
export const LAUNCH_KEYS = ["url", "site", "mode", "scan"] as const;

const MAX_URL_LENGTH = 2048;
const MODE_ALIASES: Record<string, LaunchMode> = {
  url: "url",
  web: "url",
  website: "url",
  site: "url",
  api: "url",
  build: "build",
  app: "build",
  game: "build",
  apk: "build",
  zip: "build",
};

type Raw = string | null | undefined;

/** Accepts "my-app.com", "https://my-app.com/path?x=1"; returns null for anything unsafe or malformed. */
export function normalizeLaunchUrl(value: Raw): string | null {
  if (!value) return null;
  const raw = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  // "my-app.com" gets https://; an explicit scheme (including javascript:, data:, file:) is kept so it is rejected below.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(?:javascript|data|file|ftp|vbscript|blob|mailto|tel):/i.test(raw);
  const withScheme = hasScheme ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname;
  if (!host.includes(".") && !host.includes(":")) return null; // "localhost", "intranet": nothing to scan publicly
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

export function parseLaunchMode(value: Raw): LaunchMode | null {
  if (!value) return null;
  return MODE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function parseLaunchParams(get: (key: string) => Raw): LaunchParams {
  const url = normalizeLaunchUrl(get("url") ?? get("site"));
  const requestedMode = parseLaunchMode(get("mode"));
  // A URL implies website mode unless the link explicitly asks for something else.
  const mode: LaunchMode | null = requestedMode ?? (url ? "url" : null);
  const scanFlag = /^(?:1|true|yes)$/i.test((get("scan") ?? "").trim());
  return { url: mode === "build" ? null : url, mode, autoScan: scanFlag && mode !== "build" && url !== null };
}

/** The query string without the launch keys, so state such as share parameters survives. Returns "" or "?a=b". */
export function stripLaunchParams(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of LAUNCH_KEYS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** A shareable link that opens the scanner prefilled (and optionally starts the scan). */
export function buildLaunchUrl(baseUrl: string, options: { url: string; autoScan?: boolean }): string {
  const params = new URLSearchParams({ url: options.url });
  if (options.autoScan) params.set("scan", "1");
  return `${baseUrl.replace(/\/+$/, "")}/?${params.toString()}`;
}
