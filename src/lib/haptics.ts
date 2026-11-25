/** Short vibration feedback on phones that support it. Silent no-op everywhere else. */
export type HapticKind = "tap" | "success" | "alert";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  success: [14, 40, 22],
  alert: [30, 50, 30, 50, 60],
};

export function haptic(kind: HapticKind): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Vibration is a nice-to-have; never let it break the app.
  }
}
