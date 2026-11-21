import type { Grade } from "@/lib/scanner/types";

/** Semantic color per grade: A/B safe, C/D warning, F critical. The only place grades get color. */
export const GRADE_TONE: Record<Grade, { stroke: string; text: string; badge: string }> = {
  A: { stroke: "#10b981", text: "text-safe", badge: "border-safe/25 bg-safe/10 text-safe" },
  B: { stroke: "#10b981", text: "text-safe", badge: "border-safe/25 bg-safe/10 text-safe" },
  C: { stroke: "#f59e0b", text: "text-warn", badge: "border-warn/25 bg-warn/10 text-warn" },
  D: { stroke: "#f59e0b", text: "text-warn", badge: "border-warn/25 bg-warn/10 text-warn" },
  F: { stroke: "#ef4444", text: "text-critical", badge: "border-critical/25 bg-critical/10 text-critical" },
};
