import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import { BUSINESS, OPEN_GRAPH } from "@/lib/business";
import { getContactConfig } from "@/lib/config";

// The form appears only when an inbox is configured, and that is read from the environment per
// request rather than frozen at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Liên hệ",
  description: `Liên hệ ${BUSINESS.brand}: hotline, email, địa chỉ và các kênh hỗ trợ.`,
  alternates: { canonical: "/lien-he" },
  openGraph: { ...OPEN_GRAPH, title: "Liên hệ", url: "/lien-he" },
};

/**
 * Contact (T12.3), drawn from design/site-v3/contact.html. The design's heading and labels are in
 * English ("Let's Talk", "Send Message") and are kept: they are the owner's own words.
 *
 * The enquiry form needs somewhere to send to. `CONTACT_EMAIL` names that inbox; unset, the form
 * is not drawn and the page is just the contact details, which is what it was before. A form that
 * goes nowhere is worse than none.
 */
export default function ContactPage() {
  const formEnabled = getContactConfig() !== undefined;

  return (
    <div className="mx-auto grid w-full max-w-[1416px] gap-[clamp(32px,8vw,128px)] px-4 py-[clamp(48px,5vw,96px)] pb-[clamp(64px,6vw,112px)] lg:grid-cols-[minmax(0,608px)_minmax(0,800px)] lg:justify-between lg:px-10">
      <div className="grid content-start gap-6">
        <h1 lang="en" className="m-0 text-[clamp(2.125rem,4vw,3rem)] leading-[1.2] font-normal">
          Let&apos;s Talk
        </h1>
        <p className="m-0">
          Đối tác B2B hợp tác quà doanh nghiệp, trà nguyên liệu pha chế{formEnabled ? ", hãy điền vào form" : ", hãy liên hệ qua các kênh"} dưới
          đây, The Hour sẽ liên hệ trong thời gian sớm nhất.
        </p>
        <p className="m-0 flex flex-wrap gap-6 text-[12px] leading-4 font-medium tracking-wider uppercase">
          <a href={BUSINESS.facebook} rel="noopener noreferrer" className="text-ink">Facebook</a>
          <a href={BUSINESS.instagram} rel="noopener noreferrer" className="text-ink">Instagram</a>
          <a href={BUSINESS.tiktok} rel="noopener noreferrer" className="text-ink">TikTok</a>
        </p>
        <h2 lang="en" className="m-0 text-xl leading-[26px] font-normal">
          Contact information:
        </h2>
        <p lang="en" className="m-0">
          Please contact us in case of any questions, support and feedback via the following channels:
        </p>
        <p className="m-0">
          Hotline:
          <br />
          <a href={`tel:${BUSINESS.hotline}`} className="text-ink">{BUSINESS.hotline}</a>
          <br />({BUSINESS.hotlineHours})
        </p>
        <p className="m-0">
          Email:
          <br />
          <a href={`mailto:${BUSINESS.email}`} className="text-ink">{BUSINESS.email}</a>
        </p>
        <p className="m-0">
          {BUSINESS.legalName}
          <br />
          {BUSINESS.address}
        </p>
      </div>
      {formEnabled && <ContactForm />}
    </div>
  );
}
