import type { Metadata } from "next";
import Link from "next/link";
import { Manrope } from "next/font/google";
import CartMenu from "@/components/CartMenu";
import { BUSINESS, OPEN_GRAPH } from "@/lib/business";
import { getAppBaseUrl, isIndexableDeployment } from "@/lib/config";
import { POLICY_LINKS } from "@/lib/policies";
import { formatVnd } from "@/lib/product";
import { FREE_SHIPPING_THRESHOLD_VND } from "@/lib/shipping";
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
  // Relative URLs below (canonical, Open Graph) resolve against the public address. Without
  // APP_BASE_URL (a preview, a fresh clone) it falls back to localhost, which is harmless because
  // those deployments are not indexable.
  metadataBase: new URL(getAppBaseUrl() ?? "http://localhost:3000"),
  title: { default: `${BUSINESS.brand} — Trà Việt cao cấp`, template: `%s | ${BUSINESS.brand}` },
  description: "Trà Việt từ The Hour Tea. Đặt hàng trực tuyến, thanh toán qua VNPAY, giao hàng toàn quốc.",
  robots: isIndexableDeployment() ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: OPEN_GRAPH,
};

/**
 * Main navigation. It followed the reference storefront link for link until 2026-10-06; `Wholesale`
 * has been dropped since — that address answers 404 on the reference site itself, and a header link
 * to a page that does not exist is not something to ship. A wholesale page can return when there is
 * one to link to.
 */
const NAV = [
  { href: "/", label: "Online shop" },
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
          {/* Read from the same constant the delivery fee uses: this banner once said 489k while the
              code charged below 500,000, a promise the checkout then broke. */}
          Freeship đơn từ {formatVnd(FREE_SHIPPING_THRESHOLD_VND)}.
        </p>

        <header className="mx-auto flex w-full max-w-[1416px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 lg:py-6">
          {/* A text wordmark: no logo artwork has been supplied for this build. */}
          <Link href="/" className="font-display mr-auto text-2xl leading-none no-underline">
            The&nbsp;Hour&nbsp;Tea
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
          <div className="mx-auto grid w-full max-w-[1416px] gap-10 px-4 py-12 text-xs text-ink-soft sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid content-start gap-2">
              <p className="m-0 text-sm font-medium text-ink">{BUSINESS.legalName}</p>
              <p className="m-0">{BUSINESS.registration}.</p>
              <p className="m-0">Địa chỉ đăng ký kinh doanh: {BUSINESS.address}.</p>
            </div>

            <div className="grid content-start gap-2">
              <p className="m-0 text-sm font-medium text-ink">Hỗ trợ</p>
              <p className="m-0">
                Hotline: <a href={`tel:${BUSINESS.hotline}`} className="text-ink underline">{BUSINESS.hotline}</a> ({BUSINESS.hotlineHours})
              </p>
              <p className="m-0">
                Email: <a href={`mailto:${BUSINESS.email}`} className="text-ink underline">{BUSINESS.email}</a>
              </p>
              {/* The lookup page lives in the footer rather than the main nav: a customer looking
                  for their order looks at the bottom of the page — or follows the link on /success. */}
              <p className="m-0">
                <Link href="/tra-cuu-don" className="text-ink no-underline hover:underline">
                  Tra cứu đơn hàng
                </Link>
              </p>
              <p className="m-0 flex gap-4">
                <a href={BUSINESS.facebook} rel="noopener noreferrer" className="text-ink underline">
                  Facebook
                </a>
                <a href={BUSINESS.instagram} rel="noopener noreferrer" className="text-ink underline">
                  Instagram
                </a>
                <a href={BUSINESS.tiktok} rel="noopener noreferrer" className="text-ink underline">
                  TikTok
                </a>
              </p>
            </div>

            <div className="grid content-start gap-2">
              <p className="m-0 text-sm font-medium text-ink">Chính sách</p>
              {POLICY_LINKS.map((l) => (
                <p key={l.href} className="m-0">
                  <Link href={l.href} className="text-ink no-underline hover:underline">
                    {l.label}
                  </Link>
                </p>
              ))}
            </div>
          </div>
          <p className="m-0 border-t border-line px-4 py-4 text-center text-[11px] text-ink-soft">
            © {new Date().getFullYear()} {BUSINESS.brand}. Thanh toán trực tuyến qua VNPAY.
          </p>
        </footer>
      </body>
    </html>
  );
}
