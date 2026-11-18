import { ImageResponse } from "next/og";
import { scoreUpgrade, type ScoreCardParams } from "@/lib/og-params";
import type { Grade } from "@/lib/scanner/types";
import { SITE_URL } from "@/lib/share";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "ShipSafe — 15-Second Pre-Launch Security & Config Audit";

const COLORS = {
  bg: "#09090b",
  card: "#18181b",
  line: "#27272a",
  fg: "#fafafa",
  muted: "#a1a1aa",
  dim: "#71717a",
  emerald: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
};

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderRadius: 8,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.card,
        color: COLORS.muted,
        fontSize: 22,
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
      {label}
    </div>
  );
}

/** Dark engineering-style 1200x630 card used for Open Graph and Twitter previews. */
export function renderOgCard(): ImageResponse {
  const host = new URL(SITE_URL).host;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: COLORS.bg,
          padding: 64,
          fontFamily: "sans-serif",
          borderTop: `6px solid ${COLORS.emerald}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 32 32">
              <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill={COLORS.bg} stroke={COLORS.line} />
              <path
                d="M16 6.5 24 9.5v6.2c0 4.9-3.4 8.6-8 9.8-4.6-1.2-8-4.9-8-9.8V9.5z"
                fill="none"
                stroke={COLORS.fg}
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="m12.5 16 2.5 2.5 4.5-5" fill="none" stroke={COLORS.emerald} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: COLORS.fg, letterSpacing: -1 }}>ShipSafe</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              borderRadius: 999,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.card,
              color: COLORS.muted,
              fontSize: 22,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 999, background: COLORS.emerald }} />
            Passive scan · no signup
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.08,
              color: COLORS.fg,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            15-Second Pre-Launch Security &amp; Config Audit
          </div>
          <div style={{ display: "flex", fontSize: 32, color: COLORS.muted }}>
            Headers • Exposed .env • Leaked Keys • AI Fix Prompts
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Chip color={COLORS.red} label="Critical" />
            <Chip color={COLORS.amber} label="Warning" />
            <Chip color={COLORS.emerald} label="Passed" />
          </div>
          <div style={{ display: "flex", fontSize: 26, color: COLORS.dim }}>{host}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

const GRADE_ACCENT: Record<Grade, string> = {
  A: COLORS.emerald,
  B: COLORS.emerald,
  C: COLORS.amber,
  D: COLORS.amber,
  F: COLORS.red,
};

function ShieldLogo({ size }: { size: number }) {
  return (
    <svg width={String(size)} height={String(size)} viewBox="0 0 32 32">
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill={COLORS.bg} stroke={COLORS.line} />
      <path d="M16 6.5 24 9.5v6.2c0 4.9-3.4 8.6-8 9.8-4.6-1.2-8-4.9-8-9.8V9.5z" fill="none" stroke={COLORS.fg} strokeWidth="2" strokeLinejoin="round" />
      <path d="m12.5 16 2.5 2.5 4.5-5" fill="none" stroke={COLORS.emerald} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Personal score card for shared results (/api/og?score=94&grade=A[&prev=62][&target=…]).
 * All inputs are pre-validated by parseScoreCardParams; rendered as text, never as markup.
 */
export function renderScoreOgCard(params: ScoreCardParams): ImageResponse {
  const accent = GRADE_ACCENT[params.grade];
  const upgrade = scoreUpgrade(params);
  const host = new URL(SITE_URL).host;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: COLORS.bg,
          padding: 64,
          fontFamily: "sans-serif",
          borderTop: `8px solid ${accent}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <ShieldLogo size={60} />
            <div style={{ display: "flex", fontSize: 42, fontWeight: 700, color: COLORS.fg, letterSpacing: -1 }}>ShipSafe</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 20px",
              borderRadius: 999,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.card,
              color: COLORS.fg,
              fontSize: 24,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 999, background: COLORS.emerald }} />
            Verified by ShipSafe
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 30, color: COLORS.muted }}>
            {params.target ? `Security check · ${params.target}` : "Pre-launch security check"}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 168, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: -6 }}>{String(params.score)}</div>
              <div style={{ display: "flex", fontSize: 56, color: COLORS.dim, marginLeft: 12, marginBottom: 18 }}>/ 100</div>
            </div>
            <div
              style={{
                display: "flex",
                marginBottom: 24,
                padding: "10px 26px",
                borderRadius: 14,
                border: `2px solid ${accent}`,
                color: accent,
                fontSize: 48,
                fontWeight: 700,
              }}
            >
              {`Grade ${params.grade}`}
            </div>
          </div>
          {upgrade ? (
            <div style={{ display: "flex" }}>
              <div
                style={{
                  display: "flex",
                  padding: "10px 22px",
                  borderRadius: 999,
                  background: "rgba(16, 185, 129, 0.12)",
                  border: `1px solid ${COLORS.emerald}`,
                  color: COLORS.emerald,
                  fontSize: 30,
                }}
              >
                {`${upgrade.from} → ${upgrade.to} (+${upgrade.delta} pts)`}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, color: COLORS.muted }}>Headers • Exposed .env • Leaked Keys • App &amp; Game Builds</div>
          <div style={{ display: "flex", fontSize: 26, color: COLORS.dim }}>{host}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
