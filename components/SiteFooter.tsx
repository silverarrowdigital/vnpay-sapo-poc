import Link from "next/link";
import { BUSINESS } from "@/lib/business";
import { POLICY_LINKS } from "@/lib/policies";

/**
 * The footer, drawn from design/site-v3 (T12.1): dark band, three columns (menu, business identity,
 * contact), the wordmark with social links, and a bottom row of policies.
 *
 * Every fact is read from lib/business.ts and lib/policies.ts, so the footer cannot disagree with
 * the contact page or the policies. Left out on purpose:
 *
 * - the newsletter form — no service has been chosen to receive sign-ups, and a form that goes
 *   nowhere is worse than none (the same reasoning as the contact page);
 * - the "Đăng ký Bộ Công Thương" link — that registration belongs to a domain, and it is the shop
 *   owner's to confirm it is the one this site runs on (docs/plan/T12, question 11).
 */
const MENU = [
  { href: "/", label: "Trang chủ" },
  { href: "/ve-chung-toi", label: "Chuyện của The Hour" },
  { href: "/shop", label: "Online Shop" },
  { href: "/lien-he", label: "Liên hệ" },
  { href: "/blog", label: "Blog" },
  { href: "/tra-cuu-don", label: "Tra cứu đơn hàng" },
] as const;

const LABEL = "text-[12px] leading-4 font-medium tracking-wider uppercase";

export default function SiteFooter() {
  return (
    <footer className="bg-ink text-page [&_a]:text-inherit">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-3">
        <div>
          <p className={`${LABEL} mb-4`}>Menu</p>
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            {MENU.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="no-underline hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className={`${LABEL} mb-4`}>Thông tin The Hour</p>
          <p className="m-0 text-[12px] leading-4">
            {BUSINESS.legalName}. {BUSINESS.registration}. Địa chỉ đăng ký kinh doanh: {BUSINESS.address}.
          </p>
        </div>

        <div>
          <p className={`${LABEL} mb-4`}>Liên hệ</p>
          <p className="m-0 text-sm leading-5">
            Quý khách vui lòng liên hệ với chúng tôi trong trường hợp có thắc mắc, cần sự hỗ trợ và phản hồi qua các kênh sau:
          </p>
          <ul className="m-0 mt-3 grid list-none gap-1 p-0 text-sm">
            <li>
              Hotline: <a href={`tel:${BUSINESS.hotline}`} className="underline">{BUSINESS.hotline}</a> ({BUSINESS.hotlineHours})
            </li>
            <li>
              Email: <a href={`mailto:${BUSINESS.email}`} className="underline">{BUSINESS.email}</a>
            </li>
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-6 border-t border-page/20 p-6 sm:p-10">
        <Link href="/" className="text-[32px] leading-none no-underline">
          The&nbsp;Hour&nbsp;Tea
        </Link>
        <p className={`${LABEL} m-0 flex flex-wrap gap-6`}>
          <a href={BUSINESS.facebook} rel="noopener noreferrer">Facebook</a>
          <a href={BUSINESS.instagram} rel="noopener noreferrer">Instagram</a>
          <a href={BUSINESS.tiktok} rel="noopener noreferrer">TikTok</a>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-page/20 px-6 py-5 text-[12px] leading-4 sm:px-10">
        <nav aria-label="Chính sách (chân trang)" className="flex flex-wrap gap-x-6 gap-y-2">
          {POLICY_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="no-underline hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="m-0">
          © {new Date().getFullYear()} {BUSINESS.brand}. Thanh toán trực tuyến qua VNPAY.
        </p>
      </div>
    </footer>
  );
}
