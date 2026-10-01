# T2 — Blog trên Sanity

**Mục đích**: thêm `/blog` (trang tổng) và `/blog/<slug>` (chi tiết), nội dung lưu ở Sanity.

**Phụ thuộc T1.1–T1.6.** Nếu T1 làm đúng thì T2 gần như miễn phí: `post.body` dùng **lại y nguyên** mảng block của T1 và `BlockRenderer` của T1. Không viết lại component nào.

**Khác T1 một điểm về xử lý lỗi**: trang sản phẩm có nội dung dự phòng (`product.description`) nên Sanity lỗi thì degrade. Trang blog **không có gì để dự phòng**, nên Sanity lỗi thì hiện thẻ lỗi — đúng khuôn `app/page.tsx` đang làm khi Sapo chết.

---

## T2.1 — Schema `post` và `author`

**`post`**:

| Field | Kiểu | Validation |
|---|---|---|
| `title` | string | required |
| `slug` | slug | required, unique, `source: "title"` |
| `excerpt` | text | required, max 200 ký tự (dùng cho card + meta description) |
| `coverImage` | image + `alt` | `alt` required khi có ảnh |
| `publishedAt` | datetime | required |
| `author` | reference → `author` | tuỳ chọn |
| `tags` | array of string | tuỳ chọn, dùng cho "bài liên quan" |
| `body` | array | `blocksField("body")` — **cùng helper với T1.2** |
| `seo` | object `{ title?, description? }` | tuỳ chọn, override metadata |

**`author`**: `name` (required), `role`, `avatar` (image + alt), `bio` (text).

`orderings` trong schema: mới nhất trước (`publishedAt desc`) để Studio dễ dùng.

**Nghiệm thu**: `npx sanity schema validate`; `npx sanity deploy`; tạo 3 bài thử trên Studio, mỗi bài dùng ít nhất một block khác nhau (một bài có slider, một bài có video, một bài chỉ rich text).

---

## T2.2 — `lib/blog.ts`

```ts
export interface PostSummary { slug: string; title: string; excerpt: string; publishedAt: string;
                               cover?: { url: string; alt: string; w: number; h: number };
                               author?: { name: string }; tags: string[] }
export interface Post extends PostSummary { body: ContentBlock[] }

/** Một trang danh sách. Throw khi Sanity lỗi — trang blog không có nội dung dự phòng. */
export async function listPosts(opts?: { page?: number; perPage?: number }): Promise<{ posts: PostSummary[]; total: number }>
/** null khi slug không tồn tại (⇒ notFound()). Throw khi Sanity lỗi. */
export async function getPostBySlug(slug: string): Promise<Post | null>
/** Tối đa 3 bài cùng tag. Lỗi ⇒ trả [] (phần này được degrade, nó chỉ là bonus). */
export async function relatedPosts(post: PostSummary): Promise<PostSummary[]>
export async function allPostSlugs(): Promise<string[]>
```

GROQ cho danh sách (lọc bài hẹn giờ, phân trang bằng slice):

```groq
{
  "posts": *[_type == "post" && defined(slug.current) && publishedAt <= now()]
            | order(publishedAt desc) [$from...$to] {
      "slug": slug.current, title, excerpt, publishedAt, tags,
      "cover": { "url": coverImage.asset->url, "alt": coverImage.alt,
                 "w": coverImage.asset->metadata.dimensions.width,
                 "h": coverImage.asset->metadata.dimensions.height },
      author->{ name }
    },
  "total": count(*[_type == "post" && defined(slug.current) && publishedAt <= now()])
}
```

Chi tiết bài: cùng projection, cộng `body[]{...}` expand ảnh/video **y như T1.5** — tách projection đó thành một hằng chuỗi dùng chung (`BLOCKS_PROJECTION` trong `lib/content.ts`) để hai chỗ không lệch nhau.

`tags` luôn trả về mảng (`coalesce(tags, [])`), để UI không phải phòng `undefined`.

**Nghiệm thu**: script tạm trong scratchpad gọi `listPosts({ page: 1 })` → đúng số bài; `page: 99` → mảng rỗng, không nổ; `getPostBySlug("khong-ton-tai")` → `null`.

---

## T2.3 — `app/blog/page.tsx` (trang tổng)

- Server component. Phân trang qua `?page=` — **Next 16: `searchParams` là Promise, phải `await`.** Đọc `node_modules/next/dist/docs/` nếu không chắc.
- `components/PostCard.tsx`: cover (ratio cố định, `width`/`height` từ GROQ nên không layout shift), title, excerpt, ngày `toLocaleDateString("vi-VN")`, tác giả. Cả thẻ là một `Link` — đúng lối `app/page.tsx` đang làm với tile sản phẩm.
- Điều hướng trang: "Trước / Sau" bằng `Link` (`?page=n`), không JS. `rel="prev"`/`rel="next"`.
- **3 trạng thái, không bỏ sót trạng thái nào** — đúng khuôn `app/page.tsx`:
  - Sanity lỗi → thẻ `.alert.err`, "Không đọc được bài viết."
  - Không có bài → thẻ `.alert.warn`, "Chưa có bài viết nào."
  - `page` ngoài khoảng → `notFound()`.
- `generateMetadata`: title + description tĩnh cho trang blog.

**Nghiệm thu**: `/blog` liệt kê đúng 3 bài thử; `/blog?page=2` ra 404 (chưa đủ bài); tắt `SANITY_PROJECT_ID` → hiện thẻ lỗi, **không** crash cả app.

---

## T2.4 — `app/blog/[slug]/page.tsx` (chi tiết)

- `params` là Promise (`await params`) — như `app/products/[handle]/page.tsx` đang làm.
- Bố cục: breadcrumb (`.crumb`, dùng lại class có sẵn) → cover → `h1` → dòng meta (ngày + tác giả) → `<BlockRenderer blocks={post.body} />` → "Bài liên quan".
- `getPostBySlug` trả `null` ⇒ `notFound()`.
- `generateMetadata`: `seo.title ?? title`, `seo.description ?? excerpt`, `openGraph` (`type: "article"`, `publishedTime`, `images: [cover.url]`), `alternates.canonical`. Bọc `try/catch` rồi trả `{}` khi lỗi — đúng khuôn `generateMetadata` của trang sản phẩm.
- `generateStaticParams` từ `allPostSlugs()`: **chỉ thêm nếu quyết định ở T1.7a cho phép cache**. Trang blog không có giá/tồn kho nên **không cần** `force-dynamic`; đây là trang đầu tiên của dự án được cache, nên ghi lý do vào `CLAUDE.md`.
- Typography bài viết: thêm mục `/* --- article --- */` vào `globals.css` dùng token T0 — bề rộng dòng ~65ch, khoảng cách dọc giữa các block.

**Nghiệm thu**: mở cả 3 bài, slider/video/rich text render đúng; slug sai → 404; xem `view-source` thấy đúng `<title>`/`og:image`; `npm run build` không lỗi.

---

## T2.5 — Nối vào phần còn lại của site

- `app/layout.tsx`: thêm link `Blog` vào `.site-header` (cạnh `brand` và `CartBadge`). Đánh dấu trang đang xem bằng `aria-current="page"`.
- `app/sitemap.ts`: `/`, `/blog`, mỗi `/blog/<slug>`, mỗi `/products/<alias>`. Cần `APP_BASE_URL` — đã có trong `lib/config.ts`. **Đọc docs Next 16 về `sitemap`/`robots` trước khi viết.**
- (Tuỳ chọn, nếu còn thời gian) `app/blog/tag/[tag]/page.tsx`.

**Nghiệm thu**: `npm run build`; `/sitemap.xml` liệt kê đủ URL; `npm run typecheck && npm run lint`.

---

## T2.6 — Ghi vào `CLAUDE.md`

- Bảng đường dẫn: `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `components/PostCard.tsx`, `lib/blog.ts`, `app/sitemap.ts`.
- Mục "Sanity flow": schema `post`/`author`, GROQ danh sách + chi tiết, `BLOCKS_PROJECTION` dùng chung giữa product content và blog.
- Mục "Important implementation decisions": **blog được phép hiện lỗi, product page thì không** — vì blog không có nội dung dự phòng. Và: blog là trang đầu tiên **không** `force-dynamic`, lý do kèm theo.
