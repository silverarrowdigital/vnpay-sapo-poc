# T1 — Product description dạng component (Sanity)

**Mục đích**: thay mô tả rich-text phẳng của Sapo bằng một dãy **block** biên tập được trên Sanity — slider ảnh, FAQ, video, bảng thông số — khớp đúng từng sản phẩm Sapo.

**Sapo vẫn là source of truth cho tên, giá, tồn kho.** Sanity chỉ giữ phần nội dung trình bày. Không bao giờ để Sanity quyết định giá.

---

## T1.1 — Dựng kết nối Sanity

**Cài**: `npm i @sanity/client` · `npm i -D sanity @sanity/vision`

> Dùng `@sanity/client` chứ không `next-sanity`: `CLAUDE.md` yêu cầu `lib/*` độc lập framework (không import `next`), còn `next-sanity` thì bọc sẵn cache của Next. Caching xử lý ở tầng page (T1.7). `sanity` là **devDependency** — chỉ để chạy/deploy Studio, không vào bundle.

**Env mới** (server-only, không `NEXT_PUBLIC_`, thêm vào `.env.example` kèm chú thích):

| Tên | Bắt buộc | Ghi chú |
|---|---|---|
| `SANITY_PROJECT_ID` | không | Thiếu ⇒ CMS coi như chưa bật, trang sản phẩm chạy như hiện tại |
| `SANITY_DATASET` | không | Mặc định `production` |
| `SANITY_API_VERSION` | không | Ghim ngày, mặc định `2026-10-01`. Không dùng `v1`/`vX` |
| `SANITY_READ_TOKEN` | không | Chỉ cần nếu sau này muốn xem bản nháp. MVP không dùng |

**`lib/config.ts`** — thêm:

```ts
export interface SanityConfig { projectId: string; dataset: string; apiVersion: string }
/** null khi chưa cấu hình — KHÔNG throw. CMS là tuỳ chọn, khác getSapoConfig(). */
export function getSanityConfig(): SanityConfig | null
```

Vẫn áp luật placeholder đang có: giá trị bắt đầu bằng `YOUR_` tính là **chưa cấu hình**.

**`lib/sanity.ts`** (server-only, không import `next`):

```ts
/** Client dùng chung, lazy + memo hoá. null khi chưa cấu hình. */
export function sanityClient(): SanityClient | null
/** Chạy một query GROQ. Trả null khi chưa cấu hình, lỗi mạng, hay quá 5 s. */
export async function groqQuery<T>(query: string, params?: Record<string, unknown>): Promise<T | null>
```

- `useCdn: true`, `perspective: "published"`.
- **Timeout 5 s** (`AbortSignal.timeout(5000)`): CMS chậm không được giữ trang sản phẩm lại.
- Lỗi ⇒ `log.warn("sanity.query_failed", { error })` rồi trả `null`. Không bao giờ throw lên page.

**Nghiệm thu**: `npm run typecheck`; `getSanityConfig()` trả `null` khi `.env.local` chưa có biến; có biến thì một query không khớp gì trả `null` chứ không nổ.

---

## T1.2 — Schema Sanity trong repo

```
sanity/
  sanity.config.ts        ← projectId, dataset, plugin: structureTool + visionTool
  sanity.cli.ts           ← cho `npx sanity deploy`
  schemas/
    index.ts
    productContent.ts
    author.ts             (T2)
    post.ts               (T2)
    blocks/
      index.ts            ← export mảng block type + helper blocksField(name)
      richText.ts  imageSlider.ts  faq.ts  videoEmbed.ts  specs.ts  callout.ts
```

**`productContent`** — document khớp 1-1 với một sản phẩm Sapo:

| Field | Kiểu | Validation |
|---|---|---|
| `title` | string | required. Nhãn nội bộ để tìm trong Studio |
| `sapoProductId` | number | **required**, integer, positive, **unique** (custom async: query xem đã có doc khác cùng id chưa) |
| `sapoAlias` | string | tuỳ chọn. Chỉ để người biên tập nhận ra sản phẩm — **không dùng để khớp** |
| `blocks` | array | `blocksField("blocks")` |

**Vì sao khớp bằng `sapoProductId`**, không phải alias hay variantId:

| Khoá | Đổi khi nào |
|---|---|
| `alias` | Đổi tên sản phẩm trong Sapo ⇒ alias đổi ⇒ mất liên kết |
| `variantId` | Xoá/tạo lại variant ⇒ id mới ⇒ mất liên kết |
| **`productId`** | Không đổi trong suốt đời sản phẩm ✅ |

**`blocks[]` — 6 loại:**

| `_type` | Field | Ghi chú bảo mật / a11y |
|---|---|---|
| `richText` | Portable Text | `styles` chỉ normal, h2, h3, blockquote; marks chỉ strong, em, link. `link.href` validate: chỉ `http`, `https`, `mailto` |
| `imageSlider` | `images[]` gồm image, alt, caption?; `aspect` enum square / 4-3 / 16-9 | `alt` **required** trên từng ảnh |
| `faq` | `heading?`, `items[]` gồm question, answer | `answer` là Portable Text giới hạn như `richText` |
| `videoEmbed` | `provider` enum youtube / vimeo, `videoId` string, `title` required, `poster?` image | `videoId` validate regex (11 ký tự word/dash cho YouTube, toàn số cho Vimeo). **Không có field URL, không có field HTML** |
| `specs` | `heading?`, `rows[]` gồm label, value | — |
| `callout` | `tone` enum info / warn / success, `heading?`, `body` text | `body` là plain text |

Mỗi block có `preview` (title + subtitle) để mảng trong Studio đọc được, không phải toàn chữ "Object".

**Nghiệm thu**: `npx sanity schema validate` không lỗi; `npm run typecheck` không lỗi (folder `sanity/` nằm trong `tsconfig.json`); `npm run lint` không lỗi — nếu `eslint-config-next` càu nhàu về folder này thì thêm nó vào `ignores` của `eslint.config.mjs` và ghi lý do.

---

## T1.3 — Deploy Studio hosted

```bash
npx sanity login
npx sanity init --env .env.local   # hoặc trỏ vào project đã có
npx sanity deploy                  # → https://<ten>.sanity.studio
```

Thêm script vào `package.json`:

```json
"studio:dev": "sanity dev",
"studio:deploy": "sanity deploy"
```

**Nghiệm thu**: mở được URL studio, thấy document type `Product content`, tạo thử một doc và lưu được.

---

## T1.4 — Mở khoá khớp: đưa `productId` ra tới UI

`SapoCatalogEntry` **đã có** `productId` (`lib/sapo.ts`), nhưng `toCatalogProduct()` ở `lib/catalog.ts:22` bỏ nó đi. Không có nó thì không khớp được với Sanity.

- `lib/product.ts`: `DisplayProduct` thêm `productId?: number`; `CatalogProduct = DisplayProduct & { variantId: number; productId: number }`.
- `lib/catalog.ts`: `toCatalogProduct` truyền `productId: entry.productId`. Nhánh fallback (`PRODUCT`, không có Sapo) để `productId` undefined.

**Nghiệm thu**: `npm run typecheck`. Kiểm tra `lib/store.ts` / `lib/order.ts` / `PendingOrder` **không** bị ảnh hưởng (chúng lưu `variantId`, không lưu `productId`) — nếu có thì dừng lại hỏi, vì đổi shape của record đã lưu là chuyện của namespace Redis (xem `CLAUDE.md`).

---

## T1.5 — `lib/content.ts`: đọc block từ Sanity

```ts
export async function getProductContent(productId: number): Promise<ContentBlock[] | null>
```

GROQ **tự expand ảnh ngay trong query**, nên không cần `@sanity/image-url`:

```groq
*[_type == "productContent" && sapoProductId == $pid][0]{
  blocks[]{
    ...,
    _type == "imageSlider" => {
      aspect,
      "images": images[]{ alt, caption,
                          "url": image.asset->url,
                          "w":   image.asset->metadata.dimensions.width,
                          "h":   image.asset->metadata.dimensions.height }
    },
    _type == "videoEmbed" => { provider, videoId, title, "poster": poster.asset->url }
  }
}.blocks
```

Sanity CDN nhận query param trực tiếp, nên component chỉ cần nối `?w=800&q=75&auto=format` vào `url` — không thêm dependency nào.

Trả `null` khi: chưa cấu hình Sanity · không có doc · query lỗi/timeout · mảng rỗng. Mọi trường hợp đều ⇒ trang sản phẩm dùng `product.description` như cũ.

**Kiểu block để ở `lib/blocks.ts`** — file **chỉ có `type`/`interface`, không import gì**, vì component `"use client"` phải import được. Đây là ngoại lệ thứ hai cho luật "chỉ `lib/product.ts` là client-safe" trong `CLAUDE.md`; T1.8 ghi lại.

```ts
export type ContentBlock =
  | { _type: "richText";    _key: string; content: PortableTextBlock[] }
  | { _type: "imageSlider"; _key: string; aspect: "square" | "4-3" | "16-9"; images: SliderImage[] }
  | { _type: "faq";         _key: string; heading?: string; items: FaqItem[] }
  | { _type: "videoEmbed";  _key: string; provider: "youtube" | "vimeo"; videoId: string; title: string; poster?: string }
  | { _type: "specs";       _key: string; heading?: string; rows: { label: string; value: string }[] }
  | { _type: "callout";     _key: string; tone: "info" | "warn" | "success"; heading?: string; body: string };
```

**Nghiệm thu**: tạo doc Sanity với `sapoProductId` = productId thật, gọi `getProductContent(<id>)` qua một script tạm trong scratchpad → in ra mảng block. Gọi với id không tồn tại → `null`. Xoá `SANITY_PROJECT_ID` → `null`, không nổ.

---

## T1.6 — Component render block

```
components/blocks/
  BlockRenderer.tsx   ← server component: switch theo _type. **Type lạ ⇒ return null**, không nổ
  RichText.tsx        ← render Portable Text bằng component của ta (KHÔNG dangerouslySetInnerHTML)
  ImageSlider.tsx     ← "use client"
  Faq.tsx             ← details/summary: zero JS
  VideoEmbed.tsx      ← "use client"
  Specs.tsx           ← dl hoặc table
  Callout.tsx         ← server
```

Chi tiết quan trọng:

- **`BlockRenderer` bỏ qua `_type` không biết.** Người biên tập có thể thêm block mới trên Studio trước khi code được deploy ⇒ trang vẫn chạy, chỉ thiếu block đó.
- **`RichText`**: render Portable Text — `block` → `p` / `h2` / `h3` / `blockquote`, marks → `strong` / `em` / `a`. Link ra ngoài domain: `rel="noopener noreferrer"` + `target="_blank"`. Dùng `@portabletext/react` nếu gọn hơn; tự viết thì không thêm dep nào.
- **`ImageSlider`**: CSS `scroll-snap-type: x mandatory` + nút prev/next gọi `scrollBy`. Không thư viện carousel. `aria-roledescription="carousel"`, nút có `aria-label`, điều hướng được bằng bàn phím. Ảnh dùng `img` với `loading="lazy"` + `width`/`height` (có `w`/`h` từ GROQ nên không layout shift) + `srcset` từ query param của Sanity CDN. Giữ nguyên lối dùng `img` thẳng như `app/page.tsx` đang làm, kèm `eslint-disable` cùng lý do.
- **`VideoEmbed`**: **click-to-load**. Lúc đầu chỉ hiện `poster` (hoặc nền token) + nút play; bấm mới chèn `iframe`. ⇒ Không có request nào sang YouTube/Vimeo trước khi khách chủ động bấm. `src` ghép từ enum + id, **không bao giờ từ chuỗi người dùng nhập**: `https://www.youtube-nocookie.com/embed/<id>` · `https://player.vimeo.com/video/<id>`. iframe có `title`, `allowFullScreen`, `loading="lazy"`, `referrerPolicy="strict-origin-when-cross-origin"`.
- **CSS**: thêm một mục `/* --- content blocks --- */` vào `app/globals.css`, dùng token của T0. Không hardcode màu hay px.

**Nghiệm thu**: `npm run build`; render thử cả 6 block trên một sản phẩm; FAQ mở/đóng được khi JS bị tắt; video không gửi request nào tới youtube trước khi bấm (xem tab Network).

---

## T1.7 — Gắn vào trang sản phẩm

Sửa `app/products/[handle]/page.tsx`:

```tsx
const blocks = product.productId ? await getProductContent(product.productId) : null;
...
{blocks ? <BlockRenderer blocks={blocks} />
        : product.description && <p>{product.description}</p>}
```

Giữ nguyên toàn bộ phần giá / tồn kho / `AddToCartForm`.

### T1.7a — Caching: đọc docs trước khi viết

Trang đang `export const dynamic = "force-dynamic"` — **đúng và phải giữ**, vì giá và tồn kho không được phục vụ cũ. Nhưng nội dung CMS thì nên cache (nó đổi mỗi tuần, không phải mỗi request).

Next 16 có `use cache` / `cacheComponents` / `cacheLife`, khác hẳn Next 13–14. **Đọc `node_modules/next/dist/docs/` phần caching trước khi chọn**, rồi:

- Nếu `cacheComponents` dùng được: bọc `getProductContent` trong một hàm `"use cache"` + `cacheLife` cỡ phút.
- Nếu không: để `getProductContent` chạy mỗi request (timeout 5 s là đủ an toàn) và ghi vào `CLAUDE.md` là chưa cache, kèm lý do.

Không đoán API. Nếu docs không rõ ⇒ chọn phương án không cache và ghi chú lại.

**Nghiệm thu**:

- Sản phẩm **có** doc Sanity → hiện block.
- Sản phẩm **không có** doc → hiện `product.description` như trước, không có khoảng trắng lạ.
- Xoá `SANITY_PROJECT_ID` khỏi `.env.local`, restart → trang sản phẩm vẫn mua được bình thường. **Đây là bài kiểm tra quan trọng nhất của T1.**
- Chạy hết một lượt checkout (`npm run dev` + `npm run watch:ipn`) → vẫn tạo được đơn Sapo. T1 không được làm hỏng luồng thanh toán.

---

## T1.8 — Ghi vào `CLAUDE.md`

Thêm:

- Bảng đường dẫn: `lib/sanity.ts`, `lib/content.ts`, `lib/blocks.ts`, `components/blocks/*`, `sanity/`.
- Bảng env: 4 biến `SANITY_*`, tất cả **không bắt buộc**.
- Mục mới **"Sanity flow — verified docs"**: GROQ query thật đã dùng, lý do khớp bằng `sapoProductId`, lý do không dùng `next-sanity`.
- Mục "Security rules": luật video enum + id, luật Portable Text không ra HTML, luật link chỉ http/https/mailto.
- Mục "Important implementation decisions": **Sanity lỗi thì degrade, Sapo lỗi thì chặn bán** — kèm lý do.
- Mục "Coding conventions": `lib/blocks.ts` là module client-safe thứ hai (chỉ có kiểu, không import gì).
