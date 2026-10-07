import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { allPostSlugs, getPostBySlug, listPosts } from "@/lib/blog";
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

/** The newest posts, for "Các bài viết liên quan": one list shared by every article, so it costs one request per cache window. */
const cachedRecent = unstable_cache(async () => (await listPosts({ page: 1, perPage: 4 })).posts, ["blog-recent"], {
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

  // "Related" is simply the newest other posts: nothing in the CMS links posts to each other. A CMS
  // hiccup here only drops the section; the article itself already loaded.
  let related: Awaited<ReturnType<typeof cachedRecent>> = [];
  try {
    related = (await cachedRecent()).filter((p) => p.slug !== slug).slice(0, 3);
  } catch (err) {
    log.warn("blog.related_unavailable", { error: errorMessage(err) });
  }

  return (
    <article className="mx-auto w-full max-w-[1416px] px-4 lg:px-10">
      {/* T12.4: the layout of design/site-v3/article.html. The body below is unchanged — the same
          BlockRenderer the product pages use. */}
      <div className="max-w-[1120px] py-[clamp(48px,5vw,96px)] pb-12">
        <p className="m-0 mb-4 text-[12px] leading-4 font-medium tracking-wider uppercase">
          {formatPostDate(post.publishedAt)} · {post.authorName ?? "The Hour Tea"}
        </p>
        <h1 className="m-0 text-[clamp(2.125rem,3.6vw,3rem)] leading-[1.3] font-normal">{post.title}</h1>
      </div>

      {post.cover !== null && (
        <div className="relative aspect-[21/9] w-full max-w-[1280px] overflow-hidden rounded-sm bg-placeholder">
          <Image src={post.cover.url} alt={post.cover.alt} fill sizes="(min-width: 1280px) 1280px, 100vw" priority className="object-cover" />
        </div>
      )}

      <div className="max-w-[800px] py-12 pb-[clamp(48px,5vw,96px)]">
        {post.body.length > 0 ? <BlockRenderer blocks={post.body} /> : <p className="m-0">{post.excerpt}</p>}

        {post.tags.length > 0 && (
          <ul className="mt-12 flex list-none flex-wrap gap-2 p-0">
            {post.tags.map((tag) => (
              <li key={tag} className="rounded-sm border border-line px-3 py-1 text-xs text-ink-soft">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related" className="pb-[clamp(64px,6vw,112px)]">
          <h2 id="related" className="m-0 mb-8 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.3] font-normal">
            Các bài viết liên quan
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-x-12 gap-y-12 p-0 min-[520px]:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}`} className="group grid content-start gap-4 text-ink no-underline">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-sm bg-placeholder">
                    {p.cover !== null && (
                      <Image src={p.cover.url} alt={p.cover.alt} fill sizes="(min-width: 1024px) 440px, (min-width: 520px) 50vw, 100vw" className="object-cover" />
                    )}
                  </div>
                  <p className="m-0 text-[12px] leading-4 font-medium tracking-wider text-ink-soft uppercase">
                    {p.authorName ?? "The Hour Tea"} <span aria-hidden="true">|</span> {formatPostDate(p.publishedAt)}
                  </p>
                  <h3 className="m-0 text-[22px] leading-[30px] font-normal group-hover:underline">{p.title}</h3>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="m-0 pb-[clamp(48px,5vw,96px)]">
        <Link href="/blog" className="text-sm text-ink">
          ← Tất cả bài viết
        </Link>
      </p>
    </article>
  );
}

/** Rendered identically on server and client, so hydration cannot disagree about a date. */
function formatPostDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}, ${d.getUTCFullYear()}`;
}
