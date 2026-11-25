import { stripLaunchParams } from "@/lib/launch-params";

/**
 * The four views of ShipSafe. Each is a real route, so the browser's back button, deep links and
 * sharing all work, while the scan state lives in one provider that survives navigation.
 */
export type ViewId = "scan" | "report" | "history" | "order";

export interface NavItem {
  id: ViewId;
  href: string;
  label: string;
  /** Short label for the phone tab bar. */
  short: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "scan", href: "/", label: "Scanner", short: "Scan" },
  { id: "report", href: "/report", label: "Report & fixes", short: "Report" },
  { id: "history", href: "/history", label: "History & badges", short: "History" },
  { id: "order", href: "/order", label: "Bot & orders", short: "Order" },
] as const;

export const REPORT_PATH = "/report";
export const ORDER_PATH = "/order";

/** Which view a pathname belongs to; unknown paths count as the scanner. */
export function viewForPath(pathname: string): ViewId {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return NAV_ITEMS.find((item) => item.href !== "/" && (clean === item.href || clean.startsWith(`${item.href}/`)))?.id ?? "scan";
}

/**
 * The query string that travels with the user between views: everything except the launch keys,
 * which the app consumes once. Share-card keys, utm_* and Telegram parameters therefore survive.
 */
export function carriedQueryFrom(search: string): string {
  return stripLaunchParams(search);
}

/** `/report` + `?utm_source=telegram` → `/report?utm_source=telegram`. */
export function hrefWithQuery(path: string, carriedQuery: string): string {
  return carriedQuery && carriedQuery !== "?" ? `${path}${carriedQuery.startsWith("?") ? carriedQuery : `?${carriedQuery}`}` : path;
}
