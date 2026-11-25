import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { ScanProvider } from "@/components/ScanProvider";
import { SITE_URL } from "@/lib/share";
import { defaultSocialMetadata, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site-metadata";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

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
  themeColor: "#07080a",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh text-fg">
        <ScanProvider>
          <AppShell>{children}</AppShell>
        </ScanProvider>
      </body>
    </html>
  );
}
