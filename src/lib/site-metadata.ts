import type { Metadata } from "next";
import { ogImagePath, type ScoreCardParams } from "@/lib/og-params";

/** Shared SEO / social metadata for the layout (defaults) and the landing page (personal score cards). */

export const SITE_TITLE = "ShipSafe — 15-Second Pre-Launch Security & Config Audit";
export const SITE_DESCRIPTION =
  "Paste your URL or drop an .apk / .zip build and get a passive security audit in seconds: HTTPS, security headers, exposed .env/.git files, CORS, cookies, source maps, debuggable APKs and leaked API keys — with one-click AI fix prompts.";
const OG_DESCRIPTION =
  "Catch leaked keys, missing headers, exposed files and risky app/game builds before your users (or bots) do. Free, passive, ~15 seconds.";
const TWITTER_DESCRIPTION = "Headers • Exposed .env • Leaked Keys • App & Game Builds • AI Fix Prompts. Free passive pre-launch security check.";
const IMAGE_ALT = "ShipSafe — 15-Second Pre-Launch Security & Config Audit";

const DEFAULT_OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: IMAGE_ALT };
const DEFAULT_TWITTER_IMAGE = { url: "/twitter-image", width: 1200, height: 630, alt: IMAGE_ALT };

type SocialMetadata = Required<Pick<Metadata, "openGraph" | "twitter">>;

function social(images: { og: typeof DEFAULT_OG_IMAGE; twitter: typeof DEFAULT_TWITTER_IMAGE }, title: string, url: string): SocialMetadata {
  return {
    openGraph: {
      type: "website",
      url,
      siteName: "ShipSafe",
      title,
      description: OG_DESCRIPTION,
      locale: "en_US",
      images: [images.og],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: TWITTER_DESCRIPTION,
      images: [images.twitter],
    },
  };
}

/** Default social metadata (static ShipSafe card). */
export function defaultSocialMetadata(): SocialMetadata {
  return social({ og: DEFAULT_OG_IMAGE, twitter: DEFAULT_TWITTER_IMAGE }, SITE_TITLE, "/");
}

/**
 * Metadata for the landing page. With a valid shared score (?s=94&g=A[&p=62]) the link preview shows
 * the personal /api/og card; otherwise the static /opengraph-image.
 */
export function landingPageMetadata(params: ScoreCardParams | null): Metadata {
  if (!params) return defaultSocialMetadata();
  const image = { url: ogImagePath(params), width: 1200, height: 630, alt: `ShipSafe security score ${params.score}/100 (Grade ${params.grade})` };
  const title = `Scored ${params.score}/100 (Grade ${params.grade}) on ShipSafe`;
  return social({ og: image, twitter: image }, title, "/");
}
