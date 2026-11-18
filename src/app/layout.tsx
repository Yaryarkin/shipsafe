import type { Metadata, Viewport } from "next";
import { SITE_URL } from "@/lib/share";
import { defaultSocialMetadata, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site-metadata";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s · ShipSafe",
  },
  description: SITE_DESCRIPTION,
  applicationName: "ShipSafe",
  keywords: [
    "security headers check",
    "pre-launch security audit",
    "exposed .env",
    "leaked API keys",
    "Supabase RLS",
    "CSP checker",
    "APK security check",
    "game build security",
    "vibe coding security",
    "Next.js security",
  ],
  alternates: { canonical: "/" },
  ...defaultSocialMetadata(),
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink text-fg">{children}</body>
    </html>
  );
}
