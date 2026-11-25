/**
 * Device model for the adaptive layout. Pure functions only (no window access), so everything here
 * is unit-testable and safe to import from server components.
 *
 *   mobile  < 768px          single column, bottom tab bar, 44px+ touch targets
 *   tablet  768px – 1024px   2-column hybrid; sidebar in landscape, side-by-side summary in portrait
 *   desktop > 1024px         multi-panel workspace
 *
 * The CSS breakpoints (Tailwind `md` = 768px and `lg` = 1025px, see globals.css) use the same numbers.
 */

export type DeviceType = "mobile" | "tablet" | "desktop";
export type Orientation = "portrait" | "landscape";
export type UaHint = "mobile" | "tablet" | "desktop" | "unknown";

export const TABLET_MIN_WIDTH = 768;
/** First width that counts as desktop: "desktop > 1024px". */
export const DESKTOP_MIN_WIDTH = 1025;

export interface DeviceInfo {
  device: DeviceType;
  orientation: Orientation;
  /** The primary input is a finger: coarse pointer, or no hover available. */
  isTouch: boolean;
  /** What the user agent says it is. Advisory only: layout is decided by width. */
  uaHint: UaHint;
  reducedMotion: boolean;
}

/** What the server renders and what the first client render must match (hydration-safe). */
export const SERVER_DEVICE: DeviceInfo = {
  device: "desktop",
  orientation: "landscape",
  isTouch: false,
  uaHint: "unknown",
  reducedMotion: false,
};

export function deviceForWidth(width: number): DeviceType {
  if (!Number.isFinite(width) || width < TABLET_MIN_WIDTH) return "mobile";
  return width < DESKTOP_MIN_WIDTH ? "tablet" : "desktop";
}

export function orientationFor(width: number, height: number): Orientation {
  return height > width ? "portrait" : "landscape";
}

/**
 * Reads the user-agent hints. `uaDataMobile` comes from `navigator.userAgentData.mobile`, which is
 * the most reliable signal where it exists. iPadOS 13+ reports itself as a Mac, so a "Macintosh"
 * with several touch points counts as a tablet.
 */
export function classifyUserAgent(input: { userAgent?: string; uaDataMobile?: boolean | null; maxTouchPoints?: number }): UaHint {
  const ua = input.userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return "tablet";
  if (/Macintosh/i.test(ua) && (input.maxTouchPoints ?? 0) > 1) return "tablet";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "mobile" : "tablet";
  if (/iPhone|iPod|Windows Phone|Mobi/i.test(ua)) return "mobile";
  if (input.uaDataMobile === true) return "mobile";
  if (ua) return "desktop";
  return input.uaDataMobile === false ? "desktop" : "unknown";
}

export function sameDeviceInfo(a: DeviceInfo, b: DeviceInfo): boolean {
  return a.device === b.device && a.orientation === b.orientation && a.isTouch === b.isTouch && a.uaHint === b.uaHint && a.reducedMotion === b.reducedMotion;
}
