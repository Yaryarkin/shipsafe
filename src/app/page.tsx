import type { Metadata } from "next";
import { ScannerView } from "@/components/ScannerView";
import { parseScoreCardParams, SHARE_PARAM_KEYS } from "@/lib/og-params";
import { landingPageMetadata } from "@/lib/site-metadata";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Shared result links (/?s=94&g=A[&p=62]) get a personal score card in X / Discord / Telegram previews. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const query = await searchParams;
  return landingPageMetadata(parseScoreCardParams((key) => query[key], SHARE_PARAM_KEYS));
}

export default function HomePage() {
  return <ScannerView />;
}
