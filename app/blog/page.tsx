import Link from "next/link";
import type { Metadata } from "next";
import { PLACEHOLDER_POSTS, formatPostDate } from "./placeholder";

export const metadata: Metadata = {
  title: "Blog — VNPAY → Sapo PoC",
  description: "Bài viết về trà và cách thưởng thức.",
};

/**
 * Blog index, laid out to match the reference (T3.7).
 *
 * The data is still `placeholder.ts`. T2 replaces that import with `lib/blog.ts` reading Sanity —
 * the markup here is final, which is the whole reason T3 runs before T2.
 *
 * Unlike the product pages this one is not `force-dynamic`: nothing on it is a price or a stock
 * level, so there is nothing that must never be served stale.
 */
export default function BlogIndexPage() {
  const posts = PLACEHOLDER_POSTS;

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
                  <div className="aspect-[16/10] overflow-hidden rounded-xl bg-cream" />
                  <p className="mt-4 mb-2 text-xs text-ink-soft">
                    {post.author} <span aria-hidden="true">|</span> {formatPostDate(post.publishedAt)}
                  </p>
                  <h2 className="font-display m-0 line-clamp-2 text-xl leading-snug font-normal group-hover:underline">
                    {post.title}
                  </h2>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-16 mb-4 rounded border border-line bg-white py-4 text-center text-sm">Tiếp theo</p>
      </div>
    </>
  );
}
