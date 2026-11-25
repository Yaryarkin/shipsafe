import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";

// History is stored in the visitor's browser, so there is nothing here for a search engine to index.
export const metadata: Metadata = {
  title: "History & badges",
  alternates: { canonical: "/history" },
  robots: { index: false, follow: true },
};

export default function HistoryPage() {
  return <HistoryView />;
}
