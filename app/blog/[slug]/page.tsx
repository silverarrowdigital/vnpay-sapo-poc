import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PLACEHOLDER_POSTS, findPlaceholderPost, formatPostDate } from "../placeholder";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return PLACEHOLDER_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const post = findPlaceholderPost(slug);
  if (post === undefined) return {};
  return {
    title: `${post.title} — VNPAY → Sapo PoC`,
    description: post.excerpt,
    openGraph: { type: "article", title: post.title, description: post.excerpt, publishedTime: post.publishedAt },
  };
}

/**
 * Article page, laid out to match the reference (T3.7): an oversized serif title at full width, a
 * small meta line, a full-bleed cover band, then the body in a narrow measure.
 *
 * The body is placeholder prose. In T2 it becomes `<BlockRenderer blocks={post.body} />` — the same
 * component the product pages already use — which is why the measure and the vertical rhythm are
 * settled here rather than later.
 */
export default async function BlogPostPage({ params }: { params: Params }) {
  const { slug } = await params;
  const post = findPlaceholderPost(slug);
  if (post === undefined) notFound();

  return (
    <article>
      <div className="mx-auto w-full max-w-[1416px] px-4">
        <h1 className="font-display mt-10 mb-16 text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.08] font-normal">
          {post.title}
        </h1>
        <p className="mb-10 text-xs text-ink-soft">
          {formatPostDate(post.publishedAt)} · {post.author}
        </p>
      </div>

      {/* Cover band. A real image lands here once the CMS carries one. */}
      <div className="h-[280px] w-full bg-cream lg:h-[420px]" />

      <div className="mx-auto w-full max-w-[778px] px-4 py-16">
        <div className="text-sm leading-relaxed">
          <p className="mb-5">{post.excerpt}</p>
          <p className="mb-5">
            Đây là nội dung giữ chỗ của bước T3.7. Bố cục, bề rộng dòng chữ và nhịp dọc ở đây là bản cuối — bước T2 chỉ
            thay phần thân bài này bằng khối nội dung đọc từ Sanity, dùng đúng component mà trang sản phẩm đang dùng.
          </p>

          <h2 className="mt-10 mb-3 text-base font-semibold">Vì sao dựng giao diện trước</h2>
          <p className="mb-5">
            Thiết kế tham chiếu đã có sẵn trang danh sách và trang chi tiết blog. Dựng vỏ trước nghĩa là khi nối dữ liệu
            thật vào, không có dòng markup nào phải viết lại.
          </p>

          <h2 className="mt-10 mb-3 text-base font-semibold">Những gì sẽ thay đổi ở T2</h2>
          <ul className="mb-5 list-disc pl-5">
            <li className="mb-1">Danh sách bài đọc từ Sanity thay vì mảng tĩnh.</li>
            <li className="mb-1">Thân bài render bằng BlockRenderer, có slider, FAQ và video.</li>
            <li className="mb-1">Ảnh bìa thật thay cho dải màu giữ chỗ.</li>
          </ul>
        </div>

        <p className="mt-14">
          <Link href="/blog" className="text-sm">
            ← Tất cả bài viết
          </Link>
        </p>
      </div>
    </article>
  );
}
