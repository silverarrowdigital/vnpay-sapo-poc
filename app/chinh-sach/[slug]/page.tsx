import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PolicyBody from "@/components/PolicyBody";
import { BUSINESS } from "@/lib/business";
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
  return { title: policy.title, description: policy.description, alternates: { canonical: `/chinh-sach/${slug}` } };
}

export default async function PolicyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) notFound();

  return (
    <article className="mx-auto w-full max-w-[760px] px-4 py-12">
      <nav aria-label="Chính sách" className="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-xs tracking-wide uppercase">
        {POLICIES.map((p) => (
          <Link
            key={p.slug}
            href={`/chinh-sach/${p.slug}`}
            aria-current={p.slug === slug ? "page" : undefined}
            className={p.slug === slug ? "font-medium text-ink underline" : "text-ink-soft no-underline hover:underline"}
          >
            {p.title}
          </Link>
        ))}
      </nav>

      <h1 className="font-display mb-8 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">{policy.title}</h1>
      <PolicyBody lines={policyLines(policy)} />

      <p className="mt-12 border-t border-line pt-6 text-xs text-ink-soft">
        {BUSINESS.legalName} · {BUSINESS.address}. Cần hỗ trợ: <a href={`mailto:${BUSINESS.email}`} className="text-ink underline">{BUSINESS.email}</a>,
        hotline {BUSINESS.hotline} ({BUSINESS.hotlineHours}).
      </p>
    </article>
  );
}
