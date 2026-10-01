# T2 — Blog trên Sanity

**Bản viết lại 2026-10-01.** Hai thứ đổi so với bản đầu:

1. **Vỏ giao diện đã dựng xong ở T3.7.** `/blog` và `/blog/[slug]` đã có bố cục cuối theo design ref. T2 không còn phải viết markup — chỉ thay nguồn dữ liệu.
2. **Project Sanity đang ở gói Free**, nên tiết kiệm lượt gọi API là **yêu cầu bắt buộc**, không phải tối ưu để dành.

---

## Ràng buộc $0 — đọc trước khi viết dòng code nào

Trên gói Free, thứ chạm trần trước tiên là **số lượt gọi API**. Hạn mức cụ thể xem ở `sanity.io/manage/project/73i5sv8l` → Usage; con số đó thay đổi theo thời gian nên không ghi vào đây.

**Mục tiêu kiến trúc: lưu lượng tới Sanity phụ thuộc vào tần suất bạn sửa nội dung, không phụ thuộc vào lượng khách truy cập.** Đạt được điều đó thì traffic tăng bao nhiêu cũng không đổi hoá đơn.

Bốn luật, áp cho mọi bước bên dưới:

| # | Luật | Vì sao |
|---|---|---|
| 1 | **Mọi query blog phải được cache.** Blog không có giá hay tồn kho, nên cache dài — 1 giờ trở lên, không phải 5 phút như nội dung sản phẩm | Không cache thì mỗi lượt xem trang là một lượt gọi API |
| 2 | **`/api/revalidate` + webhook Sanity làm *trong* T2**, không để sau | Có webhook thì cache đặt dài tuỳ thích mà nội dung vẫn cập nhật tức thì. Không có nó thì buộc cache ngắn, tức nhiều query hơn |
| 3 | **`generateStaticParams` cho trang bài viết** | Build xong là tĩnh; không query lúc chạy |
| 4 | **Ảnh bìa đi qua `next/image`**, không trỏ thẳng CDN Sanity mỗi lượt xem | Băng thông asset cũng tính vào quota |

### Những gì đã có lợi sẵn

- `useCdn: true` và `perspective: "published"` trong `lib/sanity.ts`.
- GROQ resolve URL ảnh ngay trong query ⇒ không phát sinh lượt gọi asset riêng.
- **Ảnh sản phẩm đến từ Sapo, không phải Sanity** ⇒ băng thông ảnh phía Sanity hiện gần như bằng 0.
- Studio hosted ở `*.sanity.studio` không tốn phí.

---

## T2.0 — Gỡ `SANITY_READ_TOKEN` (làm trước tiên)

**Đây là rủi ro $0 lớn nhất, và nó do bước T1 tạo ra.**

Token được thêm vì đọc ẩn danh không thấy nội dung: `datasets visibility get` báo `public` và query ẩn danh trả HTTP 200, nhưng `count(*[_type == "productContent"])` ra `0` khi ẩn danh và `1` khi có xác thực. Dataset có document kiểu `system.group` — tính năng document access group của Sanity — gần như chắc chắn là nguyên nhân.

Vấn đề: **request có token thường không được phục vụ từ CDN.** Nghĩa là mỗi lần cache hết hạn, nó đi thẳng origin — vào đúng nhóm quota đắt hơn, và chậm hơn.

Gỡ được token thì được cả ba: rẻ hơn, nhanh hơn, bớt một secret phải quản.

Các bước:

1. Mở `sanity.io/manage/project/73i5sv8l` → phần API / Access, tìm cấu hình quyết định ai đọc được nội dung đã publish.
2. Bật đọc ẩn danh cho nội dung đã publish.
3. Kiểm chứng **không có token**:
   ```
   curl -s "https://73i5sv8l.api.sanity.io/v2026-10-01/data/query/production?query=count(*[_type==%22productContent%22])"
   ```
   Phải trả `"result":1`. Hiện tại nó trả `0`.
4. Xoá `SANITY_READ_TOKEN` khỏi `.env.local`, restart, kiểm tra trang sản phẩm vẫn hiện đủ khối.
5. Xoá token trong Sanity (`npx sanity tokens list` rồi `tokens delete <id> -y`) — một credential không ai dùng mà không hết hạn là thứ nên dọn.
6. Cập nhật `.env.example` và `CLAUDE.md`: token chuyển từ "trên thực tế bắt buộc" về "không cần".

**Nếu không bật được đọc ẩn danh**: giữ token, nhưng khi đó luật 1 và 2 ở trên quan trọng gấp đôi — ghi rõ vào `CLAUDE.md` rằng mỗi lần cache miss là một lượt gọi origin.

**Nghiệm thu**: lệnh curl ẩn danh ở bước 3 trả `1`; trang sản phẩm hiện đủ 6 khối khi `.env.local` không có token nào.

---

## T2.1 — Schema `post` và `author`

| Field | Kiểu | Validation |
|---|---|---|
| `title` | string | required |
| `slug` | slug | required, unique, `source: "title"` |
| `excerpt` | text | required, max 200 |
| `coverImage` | image + `alt` | `alt` required khi có ảnh |
| `publishedAt` | datetime | required |
| `author` | reference → `author` | tuỳ chọn |
| `tags` | array of string | tuỳ chọn |
| `body` | array | `blocksField("body")` — **cùng helper với `productContent`** |
| `seo` | object `{ title?, description? }` | tuỳ chọn |

`author`: `name` (required), `role`, `avatar` (image + alt), `bio`.

`orderings`: `publishedAt desc`.

**Nghiệm thu**: `npx sanity schema validate`; `npm run studio:deploy`; tạo 3 bài thật, mỗi bài dùng một loại khối khác nhau.

---

## T2.2 — `lib/blog.ts`

```ts
export async function listPosts(opts?: { page?: number; perPage?: number }): Promise<{ posts: PostSummary[]; total: number }>
export async function getPostBySlug(slug: string): Promise<Post | null>
export async function allPostSlugs(): Promise<string[]>
```

- Dùng lại **`BLOCKS_PROJECTION`** từ `lib/content.ts` cho `body`, để blog và sản phẩm không lệch nhau.
- Lọc `publishedAt <= now()` để bài hẹn giờ không lộ sớm.
- `coalesce(tags, [])` để UI không phải phòng `undefined`.
- Khác `lib/content.ts` một điểm: **trang blog được phép hiện lỗi**. Trang sản phẩm có mô tả Sapo làm dự phòng; blog không có gì để dự phòng, nên lỗi Sanity ⇒ thẻ lỗi, đúng khuôn `app/page.tsx` khi Sapo chết.

**Nghiệm thu**: script tạm gọi `listPosts({ page: 1 })` ra đúng số bài; `page: 99` ra mảng rỗng; `getPostBySlug("khong-ton-tai")` ra `null`.

---

## T2.3 — Nối dữ liệu vào vỏ đã dựng

**Không sửa markup.** `app/blog/page.tsx` và `app/blog/[slug]/page.tsx` đã có bố cục cuối từ T3.7.

- Thay `import { PLACEHOLDER_POSTS } from "./placeholder"` bằng `listPosts()` / `getPostBySlug()`.
- Thân bài: thay đoạn giữ chỗ bằng `<BlockRenderer blocks={post.body} />`.
- Ảnh bìa: thay dải màu giữ chỗ bằng `next/image` (luật 4). Cần cấu hình `images.remotePatterns` trong `next.config.ts` cho `cdn.sanity.io` — **đọc tài liệu Next 16 trước**, cấu hình ảnh đã đổi qua các phiên bản.
- `generateStaticParams` lấy từ `allPostSlugs()` (luật 3).
- **Cache** `listPosts` theo luật 1.
- Xoá `app/blog/placeholder.ts`.

**Nghiệm thu**: ba bài thật hiện đúng; slug sai ra 404; `view-source` thấy đúng `<title>` và `og:image`; so với `shots/blog-*` và `shots/blog-details-*`.

---

## T2.4 — `/api/revalidate` + webhook Sanity

Luật 2. Đây là thứ cho phép cache dài mà nội dung vẫn tươi.

- `app/api/revalidate/route.ts`: nhận webhook của Sanity, **xác minh chữ ký** bằng secret dùng chung (`SANITY_WEBHOOK_SECRET`), rồi gọi `revalidateTag`.
- Không xác minh chữ ký thì bất kỳ ai cũng gọi được để xoá cache liên tục — vừa là lỗ hổng vừa là cách đốt quota.
- Tạo webhook trong Sanity: `npx sanity hooks` (xem `--help` trước) hoặc trong trang manage.
- Thêm `SANITY_WEBHOOK_SECRET` vào `.env.example` và `lib/config.ts`.

**Nghiệm thu**: sửa một bài trên Studio → publish → tải lại `/blog`, nội dung mới hiện ngay, không phải chờ hết cache.

---

## T2.5 — Nav và sitemap

- Link `Blog` trong header đã có từ T3.2 — chỉ cần xác nhận `aria-current` đúng.
- `app/sitemap.ts`: `/`, `/blog`, mỗi `/blog/<slug>`, mỗi `/products/<alias>`. Dùng `APP_BASE_URL`. **Đọc docs Next 16 về `sitemap` trước khi viết.**

---

## T2.6 — Ghi lại

- `CLAUDE.md`: schema `post`/`author`; `BLOCKS_PROJECTION` dùng chung; blog được phép hiện lỗi còn trang sản phẩm thì không, kèm lý do; route `/api/revalidate`; **mục mới về ràng buộc gói Free và bốn luật ở trên**.
- Kết quả T2.0: token còn hay đã gỡ, và vì sao.
- `docs/plan/README.md`: đánh dấu T2 xong.

---

## Kiểm tra cuối: lưu lượng có độc lập với traffic không

Sau khi xong, mở Usage trên `sanity.io/manage`, ghi lại số lượt gọi API. Tải `/blog` và vài trang bài viết chừng 20 lần. Kiểm lại.

**Số lượt gọi gần như không được tăng.** Nếu nó tăng tỉ lệ với số lần tải trang thì một trong bốn luật chưa được áp đúng chỗ — tìm ra trước khi deploy, vì trên production thì khách thật mới là thứ nhân con số đó lên.
