import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/share";

/**
 * Allow everything. API routes are POST-only so crawlers can't index them anyway, and listing
 * internal paths in robots.txt is exactly what ShipSafe's own robots check warns about.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
