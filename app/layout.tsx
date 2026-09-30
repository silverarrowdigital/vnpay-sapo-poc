import type { Metadata } from "next";
import Link from "next/link";
import CartBadge from "@/components/CartBadge";
import "./globals.css";

export const metadata: Metadata = {
  title: "VNPAY → Sapo PoC",
  description: "Minimal headless checkout: VNPAY Sandbox payment creates an order in Sapo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      {/* suppressHydrationWarning: browser extensions (e.g. ruttl) inject attributes on <body> before React hydrates */}
      <body suppressHydrationWarning>
        <header className="site-header">
          <Link href="/" className="brand">
            Headless PoC
          </Link>
          <span className="badge">VNPAY Sandbox</span>
          <CartBadge />
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
