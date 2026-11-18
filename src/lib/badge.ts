import type { Grade } from "@/lib/scanner/types";
import { SITE_URL } from "@/lib/share";

/**
 * shields.io-style SVG badge for READMEs and itch.io pages: "ShipSafe | Grade A · 94/100".
 * The SVG is built only from fixed strings plus a grade from A–F and an integer 0–100 (validated
 * by the caller via parseScoreCardParams), so no user-controlled text can ever reach the markup.
 */

const GRADE_COLOR: Record<Grade, string> = {
  A: "#059669",
  B: "#059669",
  C: "#b45309",
  D: "#b45309",
  F: "#dc2626",
};
const LABEL_COLOR = "#27272a";
const NEUTRAL_COLOR = "#52525b";
const LABEL = "ShipSafe";

/** Approximate Verdana 11px text width (what shields.io uses), good enough for layout. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += /[A-Z0-9]/.test(char) ? 7.5 : /[il·.:\s]/.test(char) ? 3.6 : 6.4;
  return Math.round(width);
}

export function renderBadgeSvg(params: { score: number; grade: Grade } | null): string {
  const value = params ? `Grade ${params.grade} · ${params.score}/100` : "Check Security";
  const color = params ? GRADE_COLOR[params.grade] : NEUTRAL_COLOR;
  const labelWidth = textWidth(LABEL) + 20;
  const valueWidth = textWidth(value) + 20;
  const width = labelWidth + valueWidth;
  const title = `${LABEL}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="20" fill="${LABEL_COLOR}"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>`,
    `<rect width="${width}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">`,
    `<text x="${labelWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${LABEL}</text>`,
    `<text x="${labelWidth / 2}" y="13">${LABEL}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${value}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="13">${value}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

export function buildBadgeUrl(score: number, grade: Grade, siteUrl: string = SITE_URL): string {
  return `${siteUrl}/api/badge?grade=${grade}&score=${score}`;
}

/** Ready-to-paste README / itch.io markdown. */
export function buildBadgeMarkdown(score: number, grade: Grade, siteUrl: string = SITE_URL): string {
  return `[![ShipSafe Security Check](${buildBadgeUrl(score, grade, siteUrl)})](${siteUrl})`;
}
