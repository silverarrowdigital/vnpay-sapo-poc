import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { POSTS_PER_PAGE, listPosts } from "@/lib/blog";
import { errorMessage, log } from "@/lib/log";

export const metadata: Metadata = {
  title: "Blog — VNPAY → Sapo PoC",
  description: "Bài viết về trà và cách thưởng thức.",
};

/**
 * Cached for an hour, not the five minutes product content gets.
 *
 * Nothing here is a price or a stock level, so there is nothing that must never be served stale —
 * and on Sanity's free plan the binding limit is API requests. Caching this long is what keeps
 * traffic to Sanity proportional to how often the blog is edited rather than how many people read
 * it. `/api/revalidate` clears the `blog` tag the moment something is published, so the long
 * window costs no freshness. See docs/plan/T2-blog.md.
 */
const cachedListPosts = unstable_cache(
  async (page: number) => listPosts({ page }),
  ["blog-list"],
  { revalidate: 3600, tags: ["blog"] },
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw ?? "1");
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

export default async function BlogIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const page = readPage((await searchParams).page);

  let posts;
  let total;
  try {
    ({ posts, total } = await cachedListPosts(page));
  } catch (err) {
    // The blog has no fallback content, so it says it is broken rather than looking empty.
    // This is the opposite of a product page, which degrades to Sapo's own description.
    log.error("blog.unavailable", { error: errorMessage(err) });
    return (
      <div className="mx-auto w-full max-w-[1416px] px-4 py-24">
        <h1 className="font-display text-3xl font-normal">Không đọc được bài viết</h1>
        <p className="mt-3 text-sm text-ink-soft">Hệ thống nội dung đang không phản hồi. Vui lòng thử lại sau.</p>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  if (page > lastPage && total > 0) notFound();

  return (
    <>
      {/* Full-bleed hero band. The reference uses a photograph here; this is the ink tone from the
          token set until the CMS supplies one. */}
      <section className="flex min-h-[320px] items-center justify-center bg-ink px-4 py-20 lg:min-h-[420px]">
        <h1 className="font-display m-0 text-center text-[clamp(2.5rem,6vw,4.5rem)] leading-tight font-normal text-white">
          Nhâm nhi <em className="italic">và đọc</em>
        </h1>
      </section>

      <div className="mx-auto w-full max-w-[1416px] px-4">
        <hr className="mt-14 mb-12 border-0 border-t border-line" />

        {posts.length === 0 ? (
          <p className="py-10 text-sm text-ink-soft">Chưa có bài viết nào.</p>
        ) : (
          <ul className="grid list-none grid-cols-1 gap-x-8 gap-y-12 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`} className="group block no-underline">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-cream">
                    {post.cover !== null && (
                      <Image
                        src={post.cover.url}
                        alt={post.cover.alt}
                        fill
                        sizes="(min-width: 1024px) 440px, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <p className="mt-4 mb-2 text-xs text-ink-soft">
                    {post.authorName ?? "Hour PoC"} <span aria-hidden="true">|</span>{" "}
                    {formatPostDate(post.publishedAt)}
                  </p>
                  <h2 className="font-display m-0 line-clamp-2 text-xl leading-snug font-normal group-hover:underline">
                    {post.title}
                  </h2>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {lastPage > 1 && (
          <nav aria-label="Phân trang" className="mt-16 mb-4 flex items-center justify-between gap-4 text-sm">
            {page > 1 ? (
              <Link href={page === 2 ? "/blog" : `/blog?page=${page - 1}`} rel="prev" className="no-underline">
                ← Trang trước
              </Link>
            ) : (
              <span />
            )}
            <span className="font-mono text-xs text-ink-soft">
              {page} / {lastPage}
            </span>
            {page < lastPage ? (
              <Link href={`/blog?page=${page + 1}`} rel="next" className="no-underline">
                Tiếp theo →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </>
  );
}

/** Rendered identically on server and client, so hydration cannot disagree about a date. */
function formatPostDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}, ${d.getUTCFullYear()}`;
}
