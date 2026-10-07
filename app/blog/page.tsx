import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { POSTS_PER_PAGE, listPosts } from "@/lib/blog";
import { OPEN_GRAPH } from "@/lib/business";
import { errorMessage, log } from "@/lib/log";

/** Each page of the list is its own address: page 2 must not declare page 1 its canonical. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const page = readPage((await searchParams).page);
  const url = page === 1 ? "/blog" : `/blog?page=${page}`;
  return {
    title: "Blog",
    description: "Bài viết về trà và cách thưởng thức.",
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, title: "Blog", url },
  };
}

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

/**
 * The blog index (T12.4), in the layout of design/site-v3/blogs.html: a page heading, a three-column
 * grid of cards (3:2 cover, "author | date", title) and a pager. The posts themselves are unchanged.
 */
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
      <div className="mx-auto w-full max-w-[1416px] px-4 py-24 lg:px-10">
        <h1 className="m-0 text-3xl font-normal">Không đọc được bài viết</h1>
        <p className="mt-3 text-sm text-ink-soft">Hệ thống nội dung đang không phản hồi. Vui lòng thử lại sau.</p>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  if (page > lastPage && total > 0) notFound();

  return (
    <div className="mx-auto w-full max-w-[1416px] px-4 lg:px-10">
      <div className="py-[clamp(48px,5vw,96px)]">
        <h1 className="m-0 text-[clamp(2.125rem,3.6vw,3rem)] leading-[1.3] font-normal">Nhâm nhi và đọc</h1>
      </div>

      {posts.length === 0 ? (
        <p className="py-10 text-ink-soft">Chưa có bài viết nào.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-x-12 gap-y-16 p-0 min-[520px]:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="group grid content-start gap-4 text-ink no-underline">
                <div className="relative aspect-[3/2] overflow-hidden rounded-sm bg-placeholder">
                  {post.cover !== null && (
                    <Image
                      src={post.cover.url}
                      alt={post.cover.alt}
                      fill
                      sizes="(min-width: 1024px) 440px, (min-width: 520px) 50vw, 100vw"
                      className="object-cover"
                    />
                  )}
                </div>
                <p className="m-0 text-[12px] leading-4 font-medium tracking-wider text-ink-soft uppercase">
                  {post.authorName ?? "The Hour Tea"} <span aria-hidden="true">|</span> {formatPostDate(post.publishedAt)}
                </p>
                <h2 className="m-0 line-clamp-3 text-[22px] leading-[30px] font-normal group-hover:underline">{post.title}</h2>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Phân trang" className="mt-12 flex items-center justify-center gap-6 pb-[clamp(64px,6vw,112px)] text-sm">
          {page > 1 && (
            <Link
              href={page === 2 ? "/blog" : `/blog?page=${page - 1}`}
              rel="prev"
              className="inline-flex min-h-[52px] items-center rounded-sm border border-ink px-6 text-ink no-underline"
            >
              Trang trước
            </Link>
          )}
          <span className="text-xs text-ink-soft tabular-nums">
            {page} / {lastPage}
          </span>
          {page < lastPage && (
            <Link
              href={`/blog?page=${page + 1}`}
              rel="next"
              className="inline-flex min-h-[52px] items-center rounded-sm border border-ink px-6 text-ink no-underline"
            >
              Tiếp theo
            </Link>
          )}
        </nav>
      )}
      {lastPage <= 1 && <div className="pb-[clamp(64px,6vw,112px)]" />}
    </div>
  );
}

/** Rendered identically on server and client, so hydration cannot disagree about a date. */
function formatPostDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}, ${d.getUTCFullYear()}`;
}
