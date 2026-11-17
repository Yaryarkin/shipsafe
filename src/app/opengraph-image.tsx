import { renderOgCard } from "@/lib/og-card";

export const alt = "ShipSafe — 15-Second Pre-Launch Security & Config Audit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderOgCard();
}
