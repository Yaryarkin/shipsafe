import type { Metadata } from "next";
import { ReportView } from "@/components/ReportView";

// The report lives in the visitor's browser, so there is nothing here for a search engine to index.
export const metadata: Metadata = {
  title: "Report & fixes",
  alternates: { canonical: "/report" },
  robots: { index: false, follow: true },
};

export default function ReportPage() {
  return <ReportView />;
}
