import type { Metadata } from "next";
import { OrderView } from "@/components/OrderView";

export const metadata: Metadata = {
  title: "Bot & orders: get a human security review",
  description: "Order a human security review of your site, API or build. Pay with Telegram Stars or crypto.",
  alternates: { canonical: "/order" },
};

export default function OrderPage() {
  return <OrderView />;
}
