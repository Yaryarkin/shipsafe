import type { ReadinessStatus } from "@/lib/readiness";
import { LogoMark } from "./Logo";

const STATUS_COLOR: Record<ReadinessStatus, string> = {
  ready: "#10b981",
  attention: "#f59e0b",
  blocked: "#ef4444",
};

const CENTER = 100;
const OUTER = 92;

/** 60 ticks around the ring, every fifth one longer, like the scale of a precision instrument. */
/** Rounded so the server and the browser print identical numbers (no hydration mismatch). */
const round = (value: number) => Math.round(value * 100) / 100;

const TICKS = Array.from({ length: 60 }, (_, index) => {
  const angle = (index / 60) * Math.PI * 2;
  const major = index % 5 === 0;
  const inner = OUTER - (major ? 9 : 5);
  return {
    key: index,
    major,
    x1: round(CENTER + Math.sin(angle) * inner),
    y1: round(CENTER - Math.cos(angle) * inner),
    x2: round(CENTER + Math.sin(angle) * OUTER),
    y2: round(CENTER - Math.cos(angle) * OUTER),
  };
});

/**
 * Hero radar: a ring with a tick scale, range rings and a crosshair, with the ShipSafe mark turning
 * at its center (always, no hover needed). While a scan runs the ring and scale light up in the
 * brand color and a sweep rotates; once a verdict exists a small marker at 12 o'clock takes the
 * verdict's color. Pure SVG + CSS transforms, no blur or glow.
 */
export function Radar({ scanning = false, status = null, className = "" }: { scanning?: boolean; status?: ReadinessStatus | null; className?: string }) {
  const lit = scanning;
  const ring = lit ? "#38bdf8" : "#2e3646";
  const tick = lit ? "#38bdf8" : "#2e3646";
  const label = scanning ? "Radar: scan in progress" : status ? `Radar: ${status === "ready" ? "ready to ship" : status === "attention" ? "needs attention" : "blocked by critical issues"}` : "Radar: ready to scan";

  return (
    <div className={`relative aspect-square w-full ${className}`} role="img" aria-label={label}>
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="radar-sweep-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0.28" />
          </linearGradient>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={OUTER + 5} fill="none" stroke="#1e222d" strokeWidth="1" />
        <circle className="radar-ring" cx={CENTER} cy={CENTER} r={OUTER} fill="none" stroke={ring} strokeWidth="1.5" opacity={lit ? 0.9 : 1} />
        <circle cx={CENTER} cy={CENTER} r="68" fill="none" stroke="#1e222d" strokeWidth="1" />
        <circle cx={CENTER} cy={CENTER} r="46" fill="none" stroke="#1e222d" strokeWidth="1" strokeDasharray="2 4" />
        <circle cx={CENTER} cy={CENTER} r="28" fill="#0e1015" stroke="#1e222d" strokeWidth="1" />

        <line x1={CENTER} y1={CENTER - OUTER + 10} x2={CENTER} y2={CENTER + OUTER - 10} stroke="#1e222d" strokeWidth="1" />
        <line x1={CENTER - OUTER + 10} y1={CENTER} x2={CENTER + OUTER - 10} y2={CENTER} stroke="#1e222d" strokeWidth="1" />

        <g className="radar-ring" stroke={tick} strokeLinecap="butt">
          {TICKS.map((item) => (
            <line key={item.key} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} strokeWidth={item.major ? 1.5 : 1} opacity={item.major ? 1 : 0.7} />
          ))}
        </g>

        {/* The sweep exists only during a scan, so nothing spins in the dark when idle. */}
        {scanning && (
          <g className="radar-sweep">
            <path d={`M${CENTER} ${CENTER} L${CENTER} ${CENTER - OUTER + 2} A${OUTER - 2} ${OUTER - 2} 0 0 1 ${CENTER + 58} ${CENTER - 70} Z`} fill="url(#radar-sweep-fill)" />
            <line x1={CENTER} y1={CENTER} x2={CENTER} y2={CENTER - OUTER + 2} stroke="#38bdf8" strokeWidth="1.5" />
          </g>
        )}

        {(scanning || status) && <circle cx={CENTER} cy={CENTER - OUTER - 5} r="3.5" fill={scanning ? "#38bdf8" : status ? STATUS_COLOR[status] : "#38bdf8"} />}
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <LogoMark className="h-[24%] w-[24%]" />
      </div>
    </div>
  );
}
