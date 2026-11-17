import type { Metadata, Viewport } from "next";
import { SITE_URL } from "@/lib/share";
import "./globals.css";

const TITLE = "ShipSafe — 15-Second Pre-Launch Security & Config Audit";
const DESCRIPTION =
  "Paste your URL and get a passive security audit in seconds: HTTPS, security headers, exposed .env/.git files, CORS, cookies, source maps and leaked API keys in client bundles — with one-click AI fix prompts.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · ShipSafe",
  },
  description: DESCRIPTION,
  applicationName: "ShipSafe",
  keywords: [
    "security headers check",
    "pre-launch security audit",
    "exposed .env",
    "leaked API keys",
    "Supabase RLS",
    "CSP checker",
    "vibe coding security",
    "Next.js security",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "ShipSafe",
    title: TITLE,
    description: "Catch leaked keys, missing headers and exposed files before your users (or bots) do. Free, passive, ~15 seconds.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "Headers • Exposed .env • Leaked Keys • AI Fix Prompts. Free passive pre-launch security check.",
  },
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
