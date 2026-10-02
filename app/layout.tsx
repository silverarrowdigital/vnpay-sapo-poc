import type { Metadata } from "next";
import Link from "next/link";
import { Manrope } from "next/font/google";
import CartMenu from "@/components/CartMenu";
import "./globals.css";

/**
 * One typeface for the whole interface: Manrope, 400 and 500.
 *
 * design/the-hour-tea-nextjs-design.md inspects the Figma source and finds every piece of
 * interface text set in Manrope — the decorative lettering in the brand's imagery is printed on
 * the packaging, so it is photography, not a font the UI can set. The serif and mono faces this
 * project shipped before came from reading the live site rather than the design source; the
 * files stay in app/fonts/ but nothing loads them.
 *
 * The storefront is Vietnamese, so the "vietnamese" subset is not optional: without it the
 * diacritics fall back to a system font and the page stops looking like one typeface. Verified
 * that Manrope publishes that subset before switching.
 *
 * next/font self-hosts it, so no request leaves for Google at runtime and there is no layout
 * shift. globals.css still exposes --font-body / --font-display / --font-mono; all three now
 * resolve to Manrope, which is what the design says, and keeping the three names means no
 * component had to be touched.
 */
const manrope = Manrope({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500"],
  variable: "--font-manrope",
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
    <html lang="vi" className={manrope.variable}>
      {/* suppressHydrationWarning: browser extensions (e.g. ruttl) inject attributes on <body> before React hydrates */}
      <body suppressHydrationWarning className="bg-page font-body text-ink">
        <p className="bg-banner px-4 py-2 text-center text-[11px] tracking-wide text-page uppercase">
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
