import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { BUSINESS, OPEN_GRAPH } from "@/lib/business";
import { getAppBaseUrl, isIndexableDeployment } from "@/lib/config";
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

        {/* The relative wrapper is what the home page's floating header positions against. */}
        <div className="relative">
          <SiteHeader />
          <main>{children}</main>
        </div>

        <SiteFooter />
      </body>
    </html>
  );
}
