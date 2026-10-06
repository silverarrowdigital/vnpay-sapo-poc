import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { allPostSlugs, getPostBySlug } from "@/lib/blog";
import { errorMessage, log } from "@/lib/log";
import { OPEN_GRAPH } from "@/lib/business";

/**
 * Cached for an hour and tagged `blog`, same as the index — see the note there for why the window
 * is long and what clears it.
 *
 * `null` rather than `undefined` for a missing post, because the cache serialises its value and
 * "no such post" has to survive the round trip.
 */
const cachedPost = unstable_cache(async (slug: string) => (await getPostBySlug(slug)) ?? null, ["blog-post"], {
  revalidate: 3600,
  tags: ["blog"],
});

type Params = Promise<{ slug: string }>;

/**
 * Prerenders every post at build time, so a reader costs no Sanity request at all.
 *
 * A build that cannot reach Sanity returns an empty list rather than failing: the pages then
 * render on demand instead, which is worse for quota but better than a broken deploy.
 */
export async function generateStaticParams() {
  try {
    return (await allPostSlugs()).map((slug) => ({ slug }));
  } catch (err) {
    log.warn("blog.slugs_unavailable", { error: errorMessage(err) });
    return [];
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const post = await cachedPost(slug);
    if (post === null) return {};
    const title = post.seo?.title ?? post.title;
    const description = post.seo?.description ?? post.excerpt;
    return {
      title,
      description,
      openGraph: {
        ...OPEN_GRAPH,
        type: "article",
        title,
        description,
        publishedTime: post.publishedAt,
        images: post.cover !== null ? [post.cover.url] : undefined,
      },
    };
  } catch {
    // A CMS outage must not break the page's own error handling; fall through to the default.
    return {};
  }
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const { slug } = await params;

  let post;
  try {
    post = await cachedPost(slug);
  } catch (err) {
    log.error("blog.unavailable", { error: errorMessage(err) });
    return (
      <div className="mx-auto w-full max-w-[1416px] px-4 py-24">
        <h1 className="font-display text-3xl font-normal">Không đọc được bài viết</h1>
        <p className="mt-3 text-sm text-ink-soft">Hệ thống nội dung đang không phản hồi. Vui lòng thử lại sau.</p>
        <Link href="/blog" className="mt-6 inline-block text-sm">
          ← Tất cả bài viết
        </Link>
      </div>
    );
  }

  if (post === null) notFound();

  return (
    <article>
      <div className="mx-auto w-full max-w-[1416px] px-4">
        <h1 className="font-display mt-10 mb-16 text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.08] font-normal">
          {post.title}
        </h1>
        <p className="mb-10 text-xs text-ink-soft">
          {formatPostDate(post.publishedAt)} · {post.authorName ?? "The Hour Tea"}
        </p>
      </div>

      {post.cover !== null && (
        <div className="relative h-[280px] w-full bg-cream lg:h-[420px]">
          <Image src={post.cover.url} alt={post.cover.alt} fill sizes="100vw" priority className="object-cover" />
        </div>
      )}

      <div className="mx-auto w-full max-w-[778px] px-4 py-16">
        {/* The same renderer the product pages use — which is the whole reason the blog needed no
            new rendering code. */}
        {post.body.length > 0 ? (
          <BlockRenderer blocks={post.body} />
        ) : (
          <p className="text-sm leading-relaxed">{post.excerpt}</p>
        )}

        {post.tags.length > 0 && (
          <ul className="mt-12 flex list-none flex-wrap gap-2 p-0">
            {post.tags.map((tag) => (
              <li key={tag} className="rounded-full border border-line px-3 py-1 font-mono text-xs text-ink-soft">
                {tag}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-14">
          <Link href="/blog" className="text-sm">
            ← Tất cả bài viết
          </Link>
        </p>
      </div>
    </article>
  );
}

/** Rendered identically on server and client, so hydration cannot disagree about a date. */
function formatPostDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}, ${d.getUTCFullYear()}`;
}
