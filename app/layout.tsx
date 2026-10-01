import type { Metadata } from "next";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import CartMenu from "@/components/CartMenu";
import "./globals.css";

/**
 * Fonts, exposed to CSS as variables that app/globals.css composes into --font-body /
 * --font-display / --font-mono. next/font self-hosts all three, so no request leaves for
 * Google at runtime and there is no layout shift.
 *
 * The storefront is Vietnamese, so the "vietnamese" subset is not optional: without it the
 * diacritics fall back to a system font and the headings stop matching the body.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-jakarta",
  display: "swap",
});

const brandSerif = localFont({
  src: "./fonts/TheHourTeaSerif.ttf",
  weight: "400",
  style: "normal",
  variable: "--font-brand-serif",
  display: "swap",
});

const brandMono = localFont({
  src: "./fonts/TheHourTeaMono.ttf",
  weight: "400",
  style: "normal",
  variable: "--font-brand-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VNPAY → Sapo PoC",
  description: "Minimal headless checkout: VNPAY Sandbox payment creates an order in Sapo.",
};

/**
 * Main navigation, copied from the reference storefront (T3.2).
 *
 * `WHOLESALE`, `VỀ CHÚNG TÔI` and `LIÊN HỆ` have no route in this project, so they 404. That is
 * the agreed behaviour: the header matches the reference, and a link to something unbuilt says so
 * honestly rather than being quietly dropped or pointed somewhere misleading.
 */
const NAV = [
  { href: "/", label: "Online shop" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/ve-chung-toi", label: "Về chúng tôi" },
  { href: "/lien-he", label: "Liên hệ" },
  { href: "/blog", label: "Blog" },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${jakarta.variable} ${brandSerif.variable} ${brandMono.variable}`}>
      {/* suppressHydrationWarning: browser extensions (e.g. ruttl) inject attributes on <body> before React hydrates */}
      <body suppressHydrationWarning className="bg-page font-body text-ink">
        <p className="bg-banner px-4 py-2 text-center text-[11px] tracking-wide uppercase">
          Freeship đơn từ 489k.
        </p>

        <header className="mx-auto flex w-full max-w-[1416px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 lg:py-6">
          {/* A wordmark, not the reference's logo artwork — this is a different project. */}
          <Link href="/" className="font-display mr-auto text-2xl leading-none no-underline">
            Hour&nbsp;PoC
          </Link>

          <nav aria-label="Chính">
            <ul className="flex list-none flex-wrap items-center gap-x-6 gap-y-2 p-0 text-[12px] tracking-wider uppercase">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="no-underline hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <CartMenu />
        </header>

        <main>{children}</main>

        <footer className="mt-24 border-t border-line">
          <div className="mx-auto flex w-full max-w-[1416px] flex-col gap-2 px-4 py-10 text-xs text-ink-soft sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0">Bản dựng thử nghiệm — thanh toán qua VNPAY Sandbox, đơn hàng ghi vào Sapo.</p>
            <p className="m-0 font-mono">VNPAY → Sapo PoC</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
