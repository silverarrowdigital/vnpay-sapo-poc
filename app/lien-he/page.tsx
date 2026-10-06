import type { Metadata } from "next";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Liên hệ",
  description: `Liên hệ ${BUSINESS.brand}: hotline, email, địa chỉ và các kênh hỗ trợ.`,
  alternates: { canonical: "/lien-he" },
};

/**
 * The existing site has a B2B enquiry form here; this one has no form, because a form needs
 * somewhere to send to (an inbox or a service) that has not been chosen. The details below are what
 * the existing site publishes. Say so rather than draw a form that goes nowhere.
 */
export default function ContactPage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-12">
      <h1 className="font-display mb-4 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">Liên hệ</h1>
      <p className="mb-10 max-w-[55ch] text-sm leading-relaxed text-ink-soft">
        Quý khách cần hỗ trợ về đơn hàng, hoặc muốn hợp tác quà tặng doanh nghiệp và trà nguyên liệu pha chế (B2B),
        vui lòng liên hệ qua các kênh dưới đây.
      </p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-4 text-sm">
        <dt className="text-ink-soft">Hotline</dt>
        <dd className="m-0">
          <a href={`tel:${BUSINESS.hotline}`} className="text-ink underline">{BUSINESS.hotline}</a>
          <span className="block text-xs text-ink-soft">{BUSINESS.hotlineHours}</span>
        </dd>
        <dt className="text-ink-soft">Email</dt>
        <dd className="m-0">
          <a href={`mailto:${BUSINESS.email}`} className="text-ink underline">{BUSINESS.email}</a>
        </dd>
        <dt className="text-ink-soft">Địa chỉ</dt>
        <dd className="m-0">
          {BUSINESS.legalName}
          <span className="block">{BUSINESS.address}</span>
        </dd>
        <dt className="text-ink-soft">Mạng xã hội</dt>
        <dd className="m-0 flex flex-wrap gap-x-4">
          <a href={BUSINESS.facebook} rel="noopener noreferrer" className="text-ink underline">
            Facebook
          </a>
          <a href={BUSINESS.instagram} rel="noopener noreferrer" className="text-ink underline">
            Instagram
          </a>
          <a href={BUSINESS.tiktok} rel="noopener noreferrer" className="text-ink underline">
            TikTok
          </a>
        </dd>
      </dl>
    </div>
  );
}
