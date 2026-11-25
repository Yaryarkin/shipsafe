import type { Grade } from "@/lib/scanner/types";
import { SITE_URL } from "@/lib/share";

/**
 * shields.io-style SVG badge for READMEs and itch.io pages: "ShipSafe | Grade A · 94/100".
 * The SVG is built only from fixed strings plus a grade from A–F and an integer 0–100 (validated
 * by the caller via parseScoreCardParams), so no user-controlled text can ever reach the markup.
 * `style` and `variant` are picked from allow-lists, never echoed.
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

export const BADGE_STYLES = ["flat", "flat-square"] as const;
export const BADGE_VARIANTS = ["full", "grade", "score"] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

export interface BadgeOptions {
  style?: BadgeStyle;
  variant?: BadgeVariant;
}

export const DEFAULT_BADGE_STYLE: BadgeStyle = "flat";
export const DEFAULT_BADGE_VARIANT: BadgeVariant = "full";

/** Reads `style` / `variant` from query parameters; unknown values fall back to the defaults. */
export function parseBadgeOptions(get: (key: string) => string | null | undefined): Required<BadgeOptions> {
  const style = get("style");
  const variant = get("variant");
  return {
    style: (BADGE_STYLES as readonly string[]).includes(style ?? "") ? (style as BadgeStyle) : DEFAULT_BADGE_STYLE,
    variant: (BADGE_VARIANTS as readonly string[]).includes(variant ?? "") ? (variant as BadgeVariant) : DEFAULT_BADGE_VARIANT,
  };
}

/** Approximate Verdana 11px text width (what shields.io uses), good enough for layout. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += /[A-Z0-9]/.test(char) ? 7.5 : /[il·.:\s]/.test(char) ? 3.6 : 6.4;
  return Math.round(width);
}

function valueText(params: { score: number; grade: Grade }, variant: BadgeVariant): string {
  if (variant === "grade") return `Grade ${params.grade}`;
  if (variant === "score") return `${params.score}/100`;
  return `Grade ${params.grade} · ${params.score}/100`;
}

export function renderBadgeSvg(params: { score: number; grade: Grade } | null, options: BadgeOptions = {}): string {
  const style = options.style ?? DEFAULT_BADGE_STYLE;
  const variant = options.variant ?? DEFAULT_BADGE_VARIANT;
  const value = params ? valueText(params, variant) : "Check Security";
  const color = params ? GRADE_COLOR[params.grade] : NEUTRAL_COLOR;
  const labelWidth = textWidth(LABEL) + 20;
  const valueWidth = textWidth(value) + 20;
  const width = labelWidth + valueWidth;
  const radius = style === "flat-square" ? 0 : 3;
  const title = `${LABEL}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="${radius}" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="20" fill="${LABEL_COLOR}"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>`,
    style === "flat" ? `<rect width="${width}" height="20" fill="url(#s)"/>` : "",
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

/** Default style and variant are left out so existing README badges keep their exact URL. */
export function buildBadgeUrl(score: number, grade: Grade, siteUrl: string = SITE_URL, options: BadgeOptions = {}): string {
  let url = `${siteUrl}/api/badge?grade=${grade}&score=${score}`;
  if (options.style && options.style !== DEFAULT_BADGE_STYLE) url += `&style=${options.style}`;
  if (options.variant && options.variant !== DEFAULT_BADGE_VARIANT) url += `&variant=${options.variant}`;
  return url;
}

export const BADGE_ALT = "ShipSafe Security Check";

/** Ready-to-paste README / itch.io markdown. */
export function buildBadgeMarkdown(score: number, grade: Grade, siteUrl: string = SITE_URL, options: BadgeOptions = {}): string {
  return `[![${BADGE_ALT}](${buildBadgeUrl(score, grade, siteUrl, options)})](${siteUrl})`;
}

export const BADGE_FORMATS = ["markdown", "html", "rst", "url"] as const;
export type BadgeFormat = (typeof BADGE_FORMATS)[number];

export const BADGE_FORMAT_LABELS: Record<BadgeFormat, string> = {
  markdown: "Markdown",
  html: "HTML",
  rst: "reStructuredText",
  url: "Image URL",
};

/** Copy-ready snippet for a README (Markdown), a docs site (HTML, reST) or any image field (URL). */
export function buildBadgeSnippet(format: BadgeFormat, score: number, grade: Grade, siteUrl: string = SITE_URL, options: BadgeOptions = {}): string {
  const image = buildBadgeUrl(score, grade, siteUrl, options);
  switch (format) {
    case "markdown":
      return buildBadgeMarkdown(score, grade, siteUrl, options);
    case "html":
      return `<a href="${siteUrl}"><img src="${image}" alt="${BADGE_ALT}: Grade ${grade}, ${score}/100" height="20"></a>`;
    case "rst":
      return `.. image:: ${image}\n   :target: ${siteUrl}\n   :alt: ${BADGE_ALT}`;
    case "url":
      return image;
  }
}
