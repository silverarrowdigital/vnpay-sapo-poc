import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PolicyBody from "@/components/PolicyBody";
import { BUSINESS, OPEN_GRAPH } from "@/lib/business";
import { POLICIES, getPolicy, policyLines } from "@/lib/policies";

type Params = Promise<{ slug: string }>;

/** The four policies are fixed, so the pages are built ahead of time and an unknown slug is a 404. */
export function generateStaticParams() {
  return POLICIES.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) return {};
  return {
    title: policy.title,
    description: policy.description,
    alternates: { canonical: `/chinh-sach/${slug}` },
    openGraph: { ...OPEN_GRAPH, title: policy.title, url: `/chinh-sach/${slug}` },
  };
}

/**
 * One policy (T12.3), in the layout of design/site-v3/policy.html: a page heading, then a single
 * 800px column of text. The design's page is one long "Terms of Service" that still names Zalopay
 * and cash on delivery; the shop takes VNPAY only, so the four pages and their corrected text
 * (lib/policies.ts) stay and only the layout is the design's.
 */
export default async function PolicyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) notFound();

  return (
    <article className="mx-auto w-full max-w-[1416px] px-4 lg:px-10">
      <nav
        aria-label="Chính sách"
        className="flex flex-wrap gap-x-6 gap-y-2 pt-[clamp(24px,2.5vw,48px)] text-[12px] leading-4 font-medium tracking-wider uppercase"
      >
        {POLICIES.map((p) => (
          <Link
            key={p.slug}
            href={`/chinh-sach/${p.slug}`}
            aria-current={p.slug === slug ? "page" : undefined}
            className={p.slug === slug ? "text-ink underline" : "text-ink-soft no-underline hover:underline"}
          >
            {p.title}
          </Link>
        ))}
      </nav>

      <div className="py-[clamp(32px,4vw,72px)]">
        <h1 className="m-0 text-[clamp(2.125rem,3.6vw,3rem)] leading-[1.3] font-normal">{policy.title}</h1>
      </div>

      <div className="max-w-[800px] pb-[clamp(64px,6vw,112px)]">
        <PolicyBody lines={policyLines(policy)} />

        <p className="mt-12 border-t border-line pt-6 text-xs text-ink-soft">
          {BUSINESS.legalName} · {BUSINESS.address}. Cần hỗ trợ:{" "}
          <a href={`mailto:${BUSINESS.email}`} className="text-ink underline">
            {BUSINESS.email}
          </a>
          , hotline {BUSINESS.hotline} ({BUSINESS.hotlineHours}).
        </p>
      </div>
    </article>
  );
}
