# Design token trích từ thehourtea.com

Bản kiểm kê cho [T0.2](../docs/plan/T0-design-tokens.md). Mọi giá trị đều có nguồn để bạn kiểm lại.

- Trích ngày: **2026-10-01**
- Nền tảng trang mẫu: **Shopify Oxygen / Hydrogen** (React SSR) + **Tailwind CSS**
- Nguồn: `design/reference/site/` — tải lại bằng `node scripts/fetch-reference.mjs`

| Nguồn | File |
|---|---|
| CSS chính (124 KB, minified, Tailwind) | `site/css/app-DnN_kR_S.css` |
| CSS font | `site/css/custom-font-BI0aa5iJ.css` |
| 7 trang HTML đã SSR | `site/{index,shop,collection,product,blogs,blog-detail,cart,about}.html` |
| Font thương hiệu | `site/fonts/TheHourTeaSerif.ttf`, `TheHourTeaMono.ttf` |

---

## 1. Màu — **bản đo lại (T3.1, 2026-10-01)**

> Mục 1 cũ bên dưới **sai** và chỉ giữ lại để đối chiếu. Nó đọc khai báo `:root` của CSS gốc, trong khi trang thật set màu bằng utility ở chỗ khác. Kết quả: nền ra trắng (thật là be), nút chính ra cam `#BF4800` (thật là xanh lá).

Cách đo: giải mã PNG trong `shots/` rồi lấy **màu phổ biến nhất trong từng vùng**, không phải một pixel đơn lẻ. `%` là tỉ lệ màu đó chiếm vùng đo — càng cao càng chắc là nền chứ không phải nội dung.

| Token `@theme` | Giá trị | Vai trò | Độ tin cậy |
|---|---|---|---|
| `--color-page` | `#e7dacc` | Nền toàn trang | 100% / 94%, khớp ở cả 2 trang |
| `--color-banner` | `#edd2b9` | Thanh thông báo trên cùng | 95% |
| `--color-cream` | `#f4ebe1` | Dải section sáng hơn | 100% / 98% |
| `--color-card` | `#f1f0ed` | Nền thẻ feature (ngả lạnh) | 66% |
| `--color-primary` | `#357a38` | Nút chính "MUA NGAY" | 95% |
| `--color-ink` | `#141414` | Chữ chính | từ `:root` gốc |

**Nền ô ảnh sản phẩm không phải token.** Đo ra `#d7cbb4` / `#d4c9b3` nhưng chỉ chiếm 19–20% vùng — đó là **phông trong ảnh chụp sản phẩm**, mỗi ảnh một khác, không phải màu thiết kế. Ô ảnh dùng `--color-cream` làm nền chờ.

**`#BF4800` không thấy dùng làm nút ở bất kỳ đâu** trên 8 trang đã tải. Nó có trong `:root` của site gốc nhưng không xuất hiện trong giao diện đo được. Đã bỏ khỏi lớp token.

### Hình học lưới sản phẩm (đo bằng dò biên tile)

| | |
|---|---|
| Số cột | 3 |
| Rộng mỗi tile | **328px** |
| Khe | **16px** |
| Khung nội dung | **1016px** (3×328 + 2×16) |
| Lề trái trên ảnh ref | 404px — đó là **sidebar lọc đang rỗng**, không phải lề |

Ref có hệ thống filter thật (`FilterCustom`, facet `tra_ngon` / `cong_dung` / `tea_by_hour`), nên lưới của nó bị đẩy sang phải. Dự án không có facet nào từ Sapo ⇒ căn giữa lưới thay vì chừa một rãnh trống.

---

## 1b. Màu — bản cũ (SAI, giữ để đối chiếu)

Chỉ **3 màu** nằm trong `:root` (`app-*.css:1125`). Tailwind lưu dạng RGB cách nhau bằng khoảng trắng để dùng với modifier opacity (`bg-primary/5`).

| Biến trang mẫu | Giá trị gốc | Hex | Vai trò | Token đề xuất cho dự án |
|---|---|---|---|---|
| `--color-primary` | `20 20 20` | `#141414` | Chữ chính, nền tối | `--text`, `--bg-invert` |
| `--color-contrast` | `255 255 255` | `#FFFFFF` | Nền, chữ trên nền tối | `--bg`, `--text-invert` |
| `--color-accent` | `191 72 0` | `#BF4800` | Nhấn (cam đất rang) | `--accent` |
| `--color-shop-pay` | `#5a31f4` | — | Nút Shop Pay của Shopify | **Bỏ** — không liên quan dự án này |

Màu thực sự dùng trong markup (đếm trên 6 trang, `grep class=`):

| Utility | Số lần | Suy ra |
|---|---|---|
| `text-black` | 43 | Chữ mặc định là đen thuần, **không** phải `--color-primary` |
| `font-serif` + `text-white` / `hover:text-white` | 19 + 19 | Trạng thái đảo màu trên nền ảnh/nền tối |
| `bg-primary/5` | 19 | Nền surface rất nhạt (#141414 ở 5% ≈ `#F4F4F4`) |
| `bg-white` | 17 | Surface chính |
| `border-black/25`, `border-black/15` | 13 + 6 | Viền là đen pha trong suốt, **không** phải màu xám riêng |
| `bg-gray-300` | 12 | Placeholder ảnh |
| `text-black/25` | 5 | Chữ mờ (muted) |

**Kết luận**: đây là hệ đen–trắng + một màu nhấn. Viền và chữ mờ sinh ra từ `color-mix`/alpha của đen, không phải biến màu riêng — nên lớp token của ta chỉ cần `--text`, `--bg`, `--surface`, `--accent` rồi suy phần còn lại.

**Đã chốt (2026-10-01)**: dùng `#BF4800` làm `--accent`. Utility `*-accent` không thấy dùng trên 8 trang đã tải, nhưng đây là màu duy nhất trong `:root` của trang mẫu nên nó là lựa chọn có căn cứ nhất. Tạm thời; đổi về sau chỉ là sửa một dòng trong `:root`.

Độ tương phản `#BF4800` trên nền trắng: **5.07:1** — đạt WCAG AA cho chữ thường, nên dùng được cho link và nút.

---

## 2. Font

Từ `custom-font-BI0aa5iJ.css` (`@font-face`) và tần suất utility:

| Họ | Dùng cho | Số lần | Nguồn file |
|---|---|---|---|
| **The Hour Tea Serif** | Tiêu đề (`font-serif`) | 79 | Font riêng — đã tải về `site/fonts/` |
| **The Hour Tea Mono** | Nhãn, chi tiết nhỏ (`font-mono`) | 26 | Font riêng — đã tải về `site/fonts/` |
| Inter | Thân chữ | — | Google Fonts (OFL), weight 200/400/500/700/900 |
| Plus Jakarta Sans | Thân chữ | — | Google Fonts (OFL), variable |

Lưu ý khi áp dụng:

- Hai font thương hiệu là **tài sản riêng của bạn** — ta self-host bằng `next/font/local` từ `app/fonts/`. Chúng ở định dạng `.ttf` (`format("opentype")`); nên **convert sang `.woff2`** trước khi dùng: `.ttf` 50 KB + 40 KB, woff2 thường nhỏ hơn ~60%.
- Inter và Plus Jakarta Sans là Google Fonts mã nguồn mở → dùng `next/font/google`, **không** copy file `.ttf` từ CDN Shopify. Nhẹ hơn và sạch về bản quyền.
- Trang mẫu khai `Inter` weight 200 **và** 400 trỏ cùng file `Light`. Có thể là lỗi cấu hình của họ; đừng copy lại.

**Đã chốt (2026-10-01)**: thân chữ là **Plus Jakarta Sans**; Inter bỏ hẳn, không khai `@font-face` cho nó.

Đã áp trong `app/layout.tsx`:

| Token | Nguồn | Cách nạp |
|---|---|---|
| `--font-body` | Plus Jakarta Sans | `next/font/google`, subset `latin, latin-ext, vietnamese` |
| `--font-display` | The Hour Tea Serif | `next/font/local` ← `app/fonts/TheHourTeaSerif.ttf` |
| `--font-mono` | The Hour Tea Mono | `next/font/local` ← `app/fonts/TheHourTeaMono.ttf` |

Subset `vietnamese` là bắt buộc, không phải tuỳ chọn: thiếu nó thì dấu tiếng Việt rơi về font hệ thống và tiêu đề thôi khớp với thân chữ.

**Bạn nên kiểm**: giấy phép của hai font thương hiệu có cho dùng trên dự án thứ hai này không. Chúng là tài sản của bạn nên gần như chắc chắn có, nhưng nếu là typeface mua về rồi đổi tên thì giấy phép thường tính theo từng domain.

---

## 3. Thang chữ

`:root` (`app-*.css:1125`) + responsive override:

| Biến | Giá trị | rem → px |
|---|---|---|
| `--font-size-fine` | `.75rem` | 12px |
| `--font-size-copy` | `1rem` | 16px |
| `--font-size-lead` | `1.125rem` | 18px |
| `--font-size-heading` | `2rem`, **`1.5rem` khi ≤32em** | 32 → 24px |
| `--font-size-display` | `3rem` | 48px |

Nhưng markup phần lớn dùng thang Tailwind mặc định, không dùng mấy biến trên:

`text-sm` (128) · `text-base` (40) · `text-2xl` (31) · `text-copy` (23) · `md:text-xl` (19) · `md:text-2xl` (19) · `text-xl` (8) · `lg:text-2xl` (8) · `text-4xl` (3) · `lg:text-5xl` (3) · `text-6xl` (1)

**Suy ra**: chữ cơ sở nhỏ (`text-sm` = 14px chiếm áp đảo), tiêu đề nhảy bậc lớn tới 2xl–6xl, và kích thước đổi theo breakpoint. Thang đề xuất:

```
--step--1: 0.75rem   (12px)  fine
--step-0:  0.875rem  (14px)  mặc định — text-sm
--step-1:  1rem      (16px)  copy
--step-2:  1.5rem    (24px)  text-2xl
--step-3:  2rem      (32px)  heading
--step-4:  3rem      (48px)  display
--step-5:  3.75rem   (60px)  text-6xl, chỉ dùng ở hero
```

---

## 4. Khoảng cách

Thang Tailwind mặc định (bước 0.25rem = 4px). Giá trị hay dùng:

`gap-3` (45) · `gap-2` (43) · `gap-4` (35) · `gap-5` (33) · `px-6` (32) · `py-6` (30) · `px-5` (27) · `gap-1` (19) · `gap-9` (18) · `px-2` (14) · `mt-14` (12) · `gap-6` (11)

**Suy ra**: bước 4px, nhóm hay dùng là 8/12/16/20/24px cho gap và 20/24px cho padding ngang. Lề ngang của section là `px-5`/`px-6` = **20–24px** — khớp với yêu cầu "gutter 16px tối thiểu".

---

## 5. Bán kính

| Utility | Số lần | Giá trị |
|---|---|---|
| `rounded-full` | 49 | `9999px` — nút và pill |
| `rounded-xl` | 22 | `0.75rem` = 12px |
| `rounded-[1.5em]` | 12 | theo cỡ chữ — card lớn |
| `rounded-[1.25em]` | 4 | — |
| `rounded-[0.4em]` | 4 | — |

**Suy ra**: thẩm mỹ bo tròn mạnh. Nút là viên thuốc (`rounded-full`), card bo 12px hoặc theo `em`. Token đề xuất: `--radius-sm: 0.4em`, `--radius-md: 0.75rem`, `--radius-lg: 1.5em`, `--radius-pill: 9999px`.

**Không tìm thấy `box-shadow` nào đáng kể** (chỉ `shadow` và `shadow-md` mỗi cái 1 lần). Giao diện phẳng, phân tách bằng viền `border-black/15..25` chứ không bằng bóng. ⇒ Lớp token của ta **không cần** `--shadow-*`; dùng viền.

---

## 6. Breakpoint và container

| Breakpoint | px | Số rule |
|---|---|---|
| `32rem` | 512 | 17 ← **chính** |
| `48rem` | 768 | 4 |
| `64rem` | 1024 | 2 |
| `75rem` | 1200 | 8 |
| `90rem` | 1440 | 3 |

196 class có prefix responsive (`sm:`/`md:`/`lg:`/`xl:`), nên bố cục đổi thật theo breakpoint, không chỉ co giãn.

| Container | Giá trị | Nguồn |
|---|---|---|
| `.container-large` | `max-width: 115em` + `margin: auto` | `app-*.css`, dùng 17 lần |
| `.max-w-theme` | `max-width: 1920px` | dùng 19 lần |
| `max-w-prose` | `65ch` (Tailwind mặc định) | dùng 23 lần — **đúng bằng bề rộng bài viết T2.4 cần** |

`--height-nav`: `3.5rem` (56px), đổi thành **`6rem` (96px) khi ≥32em**. Header mobile thấp, desktop cao.

---

## 7. Dark mode (quyết định T0.3)

Trang mẫu **không có** `prefers-color-scheme` nào trong `app-*.css`. Nó chỉ có một theme sáng; các chỗ "tối" là nền ảnh/nền đen cục bộ (`bg-black` + `text-white`), không phải theme.

**Đã chốt (2026-10-01): bỏ dark mode.** Khối `@media (prefers-color-scheme: dark)` đã bị xoá khỏi `app/globals.css`. Giữ nó nghĩa là phải tự phát minh một theme tối không có bản mẫu đối chiếu và tự kiểm contrast — công việc thật, không có giá trị cho PoC.

---

## 8. Trạng thái

- [x] **Screenshot** — 11 ảnh trong `design/reference/shots/` (products, product-details, blog, blog-details, cart; desktop + mobile).
- [x] Màu nhấn: `#BF4800` (mục 1).
- [x] Thân chữ: Plus Jakarta Sans (mục 2).
- [x] Dark mode: bỏ (mục 7).
- [x] **Lớp token đã áp** vào `app/globals.css` + `app/layout.tsx` — T0.4 xong.
- [ ] Convert 2 font thương hiệu `.ttf` → `.woff2` (tiết kiệm ~55 KB; cần tool ngoài repo).
- [ ] Nới `--container` từ 720px ra bề rộng trang mẫu (`.container-large` = 115em) — việc của **T3.2**, không phải T0.
- [ ] `--height-nav` (3.5rem → 6rem ở ≥32em) chưa đưa vào token vì chưa dùng; thuộc **T3.2**.
- [ ] Căn lại breakpoint: dự án đang dùng 520px/600px, trang mẫu dùng 32rem (512px) / 48rem (768px) — thuộc **T3.5**.

### Ghi chú bố cục cho T3 (từ screenshot)

- **Giỏ hàng là popup trong trang**, không phải một trang riêng (xác nhận bởi bạn, 2026-10-01). Dự án hiện có `/checkout` là một route riêng. T3.3 phải quyết: giữ route riêng (đơn giản, khác trang mẫu) hay chuyển sang drawer/popup (giống trang mẫu, cần client state và bẫy focus). **Chưa quyết.**
