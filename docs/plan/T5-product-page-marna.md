# T5 — Dựng lại trang chi tiết sản phẩm theo drinkmarna.com

**Nguồn**: https://drinkmarna.com/products/chocolate-chip
**Tư liệu đã lưu**: `design/reference/marna/product-text.txt` (rút 2026-10-02) kèm `README.md` cùng thư mục.

**Mục đích**: lấy **toàn bộ** cấu trúc và nội dung trang sản phẩm của ref, dịch sang tiếng Việt, thay cho khung 5 khối hiện tại.

---

## Phạm vi

| Giữ nguyên | |
|---|---|
| Nút **Mua ngay** và **Thêm vào giỏ** | Không đụng tới. Đây là đường tiền. |
| Khối **FAQ** | Dùng lại `faq` đang có |
| Giá, tồn kho, ảnh sản phẩm từ Sapo | Nguồn sự thật không đổi |
| Giỏ hàng, checkout, VNPAY, IPN, Sapo | **Không một dòng nào** |

| Bỏ qua | Vì sao |
|---|---|
| **Subscription plan** (*Choose your plan · Subscribe & Save · Every 2/4/6/8 weeks*) | Bạn đã quyết bỏ. Dự án cũng không có cơ chế đăng ký định kỳ |
| **Reviews** | Tạm bỏ theo yêu cầu. Sapo không cấp dữ liệu này, như `CLAUDE.md` đã ghi |
| **Tea Club box builder** (*0/4 BLENDS ADDED*) | Là biến thể của subscription |
| **Upgrade to Tea Club / Free Shipping Unlocked** | Cùng lý do |
| **Notify Me** khi hết hàng | Trang hiện đã có trạng thái "Hết hàng"; thêm cơ chế báo hàng về là việc khác |

---

## Bản đồ: ref → khối của ta

Thứ tự đúng như trang gốc.

### Trong khung mua (cột bên phải, cạnh giá)

| Nội dung ref | Hiện có? |
|---|---|
| `15+ servings / 50g` | **chưa** |
| Mô tả một dòng | **chưa** |
| `Tea type: Black Tea` | **chưa** |
| `Caffeine: MEDIUM` | **chưa** |
| `Tasting Notes: Chocolate, Cocoa, Cookies` | **chưa** |
| `Perfect for: …` | **chưa** |
| `Benefits:` 3 huy hiệu | **chưa** |
| Giá · số lượng · thêm vào giỏ | **có** |

### Dưới phần mô tả

| # | Phần ref | Khối | Trạng thái |
|---|---|---|---|
| 1 | Đoạn mở đầu + 3 gạch đầu dòng lợi ích | `richText` | có |
| 2 | Accordion `INGREDIENTS` / `QUALITY` / `SHIPPING` | `faq` | có |
| 3 | Gallery 7 ảnh | `imageSlider` | có |
| 4 | `AS SEEN IN:` hàng logo | `logoRow` | có — **lần đầu dùng thật** |
| 5 | `BREWING PROFILE` — Serving/Temp/Minutes + thang Delicate↔Bold | **`brewProfile`** | **mới** |
| 6 | `Pure Ingredients, Powerful Benefits` + `Perfect If` (6 ý) | `richText` | có |
| 7 | `The Experience` | `richText` | có |
| 8 | `Inside Each Cup` — 3 thẻ nguyên liệu, mỗi thẻ một dãy nhãn | **`ingredientCards`** | **mới** |
| 9 | `Tea In Its Purest Form` — đối chiếu Tea Bags ↔ lá rời | `comparisonTable` | có |
| 10 | `FAQ` 10 câu | `faq` | có |

**Chỉ hai khối mới, không phải mười.** Phần lớn ref ánh xạ được vào khối sẵn có — đó là lợi tức của T4.

---

## T5.0 — Chốt phần nội dung KHÔNG chép được (làm trước, chặn mọi bước sau)

Bạn yêu cầu chép y hệt rồi dịch. Phần lớn chép được. Nhưng **một số câu là phát biểu sự thật về doanh nghiệp Marna**, dịch nguyên văn sang trang của bạn là nói sai về chính mình:

| Câu trong ref | Vấn đề |
|---|---|
| *"Marna has partnered with Fortnum & Mason and Harrods, to Soho House, luxury hotels…"* | Quan hệ đối tác của một công ty khác |
| *"Since launching, Marna has set a new standard…"* | Nói về Marna |
| *"We ship all orders from our UK warehouse within 24-48 hours"* | Kho ở Anh, thời gian giao của họ |
| `help@drinkmarna.com` | Email của họ |
| `£9.99` · `45p per cup` · `Free UK delivery` · `£3.50 shipping — free over £35` | Tiền tệ và chính sách của họ. Giá của ta đến từ Sapo |
| *"Crafted in London"* | Nơi sản xuất |
| `Our Marna Tea Club` trong câu trả lời FAQ | Sản phẩm của họ |
| *"a single tea bag can shed 11.6 billion microplastics… \*"* | Số liệu có dẫn nguồn — giữ thì phải giữ cả nguồn |

**Cần bạn quyết cho từng dòng**: thay bằng thông tin thật của cửa hàng, hay bỏ hẳn. Tôi không bịa số liệu hay đối tác.

Ngoài ra `Metabolism`, `Mood Support`, `Focus`, `Antioxidants` là công bố công dụng trên trang bán thực phẩm — ở Việt Nam thuộc phạm vi quảng cáo thực phẩm bị siết. Nêu một lần, bạn quyết.

**Nghiệm thu**: có một danh sách chốt cho từng dòng trên.

---

## T5.1 — Hai schema mới

Trong `sanity/schemas/blocks/index.ts`, đăng ký vào `blockTypes`. Tên `name` chính là `_type` tới trình duyệt nên phải khớp union trong `lib/blocks.ts`.

### `brewProfile`

```
heading?      string                   "HƯỚNG DẪN PHA"
rows[]        min 1   label + value    Lượng/1 thìa · Nhiệt độ/100°C · Phút/3–4
scaleMin      string                   "Thanh nhẹ"
scaleMax      string                   "Đậm"
scaleValue    number 0–100             vị trí trên thang
scaleNote?    text
```

Gộp bảng và thang vào **một** khối vì trang gốc vẽ chúng thành một mảng. `specs` vẫn giữ nguyên cho mục đích khác.

### `ingredientCards`

```
heading?   string               "Trong mỗi tách"
intro?     text
cards[]    min 1
  name     string, bắt buộc     "Hồng trà Ceylon"
  image?   image + alt bắt buộc
  tags[]   string, min 1        Polyphenol · Chống oxy hoá · Năng lượng bền
```

Khác `featureGrid` ở chỗ nội dung là **dãy nhãn**, không phải một đoạn mô tả.

**Nghiệm thu**: `npx sanity schema validate` 0 lỗi; `npm run studio:deploy`; tạo thử mỗi loại một khối và lưu được.

---

## T5.2 — Trường meta cho khung mua (**đổi hợp đồng, đọc kỹ**)

Phần `Tea type / Caffeine / Tasting Notes / Perfect for / Benefits` nằm **trong khung mua**, không nằm trong danh sách khối. Nên nó là **trường của document**, không phải block:

```
meta {
  servings?      string    "15+ lần pha / 50g"
  summary?       text      mô tả một dòng
  teaType?       string
  caffeine?      string    enum: thấp / vừa / cao
  tastingNotes?  string
  perfectFor?    text
  benefits[]     string    tối đa 4 huy hiệu
}
```

Hệ quả: `getProductContent()` hiện trả `ContentBlock[]`, phải đổi thành `{ meta, blocks }`.

> **Cảnh báo bắt buộc.** Đổi hình dạng dữ liệu trả về = đổi hình dạng thứ nằm trong cache, mà **khoá cache không đổi theo** (xem mục projection trong `CLAUDE.md`). Deploy xong **phải** gọi `/api/revalidate` ngay, nếu không trang sẽ nhận dữ liệu hình dạng cũ — im lặng, không báo lỗi. Đúng lỗi đã dính ngày 2026-10-02. Đưa bước này vào nghiệm thu, đừng để nhớ bằng đầu.

**Nghiệm thu**: `npm run typecheck`; publish một document có meta, chạy `npm run check:revalidate`, trang hiện đủ các dòng meta.

---

## T5.3 — Kiểu và projection

- `lib/blocks.ts`: thêm 2 nhánh vào `ContentBlock`. **Chỉ kiểu, không import gì ngoài type.**
- `lib/content.ts`: `ingredientCards` có ảnh nên cần nhánh điều kiện dùng lại `IMAGE_FIELDS`; `brewProfile` không có ảnh nên `...` mang qua nguyên vẹn. Thêm `meta` vào truy vấn document.
- Nhớ luật đã học: trường optional về tới code là `null`, trường chưa từng động tới thì **vắng hẳn**. Kiểu phải là `?: T | null`.

**Nghiệm thu**: tạo document thử đủ 2 khối mới + meta, chạy projection thật, xác nhận **không còn `_ref` thô** và ảnh ra đủ `url/alt/w/h`.

---

## T5.4 — Hai component mới

Trong `components/blocks/`, đăng ký vào `BlockRenderer`. Cả hai là **server component** — không cái nào cần trạng thái, nên không thêm JavaScript nào.

| Component | Ghi chú |
|---|---|
| `BrewProfile` | Bảng label/value + thang. Thang vẽ bằng `<meter>` hoặc một thanh có `role="img"` kèm `aria-label` đọc thành câu; **không** để nó thành hình câm |
| `IngredientCards` | Lưới thẻ, mỗi thẻ một `<ul>` nhãn. 3 thẻ/hàng desktop, 2 tablet, 1 mobile |

**Nghiệm thu**: `npm run build`; render đủ ở 390px **không có cuộn ngang ở thân trang**; chuỗi không có dấu cách vẫn ngắt được (đã có `overflow-wrap` ở `.blocks`, phải xác nhận thang và thẻ nằm trong đó).

---

## T5.5 — Khung mua hiển thị meta

Sửa `app/products/[handle]/page.tsx`. **Đây là trang bán hàng** nên:

- Không chạm `AddToCartForm`, không chạm giá, không chạm tồn kho.
- Meta thiếu thì **không để lại nhãn rỗng** — thiếu dòng nào bỏ dòng đó.
- CMS hỏng thì khung mua vẫn đủ giá, tồn kho và nút mua. Luật này đã có và đã kiểm; T5 không được làm hỏng.

**Nghiệm thu**: chạy lại đúng 3 tình huống đã dùng ngày 2026-10-02 — CMS tốt / CMS lỗi / CMS tắt — cả ba phải còn giá, tồn kho, nút thêm vào giỏ. Riêng CMS lỗi phải thấy `product_content.unavailable` **một lần mỗi request** (bằng chứng thất bại không bị cache).

---

## T5.6 — Nhập nội dung đã dịch cho một sản phẩm

Dịch toàn bộ `design/reference/marna/product-text.txt` sang tiếng Việt, trừ các dòng đã chốt bỏ ở T5.0.

**Ảnh là chỗ kẹt, biết trước còn hơn vỡ kế hoạch**: gallery 7 ảnh và hàng logo `AS SEEN IN` của trang gốc đều do JavaScript tải, nên bản lưu HTML **chỉ có đúng 2 URL ảnh**. Giống hệt chỗ đã vướng ở T4.5. Cần bạn cấp ảnh, hoặc bỏ `imageSlider` và `logoRow` ở lần dựng đầu.

**Nghiệm thu**: mở trang sản phẩm trên production, đủ các phần theo đúng thứ tự bản đồ ở trên.

---

## T5.7 — Nhân khung và ghi lại

- Nhân khung cho các sản phẩm còn lại, **sinh từ một định nghĩa duy nhất rồi đối chiếu từng khối** như đã làm ở T4 — không chép tay.
- `CLAUDE.md`: thêm 2 khối (thành 12), ghi `meta` và hợp đồng mới của `getProductContent`.
- `docs/huong-dan-them-san-pham.md`: cập nhật, vì khung đã đổi và có thêm phần meta phải điền.
- `docs/plan/README.md`: đánh dấu T5.

---

## Ước lượng

| Bước | |
|---|---|
| T5.1 schema | 1–2 giờ |
| T5.2 meta + đổi hợp đồng | 2–3 giờ |
| T5.3 kiểu + projection | 1 giờ |
| T5.4 hai component | 2–3 giờ |
| T5.5 khung mua | 2 giờ |
| T5.6 dịch + nhập | 3–4 giờ |
| T5.7 nhân khung + tài liệu | 1–2 giờ |

Khoảng **1,5–2 ngày**, chưa kể thời gian bạn quyết T5.0 và cấp ảnh.

## Ba rủi ro, xếp theo mức độ

1. **T5.5 sửa đúng trang bán hàng.** Mọi bước khác chỉ thêm khối; bước này đụng vào khung chứa nút mua. Nghiệm thu 3 tình huống CMS là bắt buộc, không phải tuỳ chọn.
2. **T5.2 đổi hình dạng cache.** Đã dính một lần, mất 5 phút nội dung mà không báo lỗi gì. Revalidate sau deploy là một dòng trong quy trình, không phải chuyện nhớ.
3. **Thiếu ảnh.** Đã chặn `logoRow` ở T4.5, sẽ chặn lại ở T5.6 nếu không chuẩn bị trước.
