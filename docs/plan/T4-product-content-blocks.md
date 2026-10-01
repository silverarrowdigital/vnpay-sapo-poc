# T4 — Khối nội dung cho trang sản phẩm

**Mục đích**: dựng thêm 4 loại khối CMS để phần nội dung dưới trang sản phẩm có cấu trúc phong phú như trang tham chiếu, thay vì chỉ vài đoạn văn.

---

## Phạm vi — đọc trước khi sửa dòng nào

**Chỉ đụng vào hệ khối CMS.** Không sửa route, không sửa layout, không sửa style toàn cục.

| Không đụng tới | |
|---|---|
| Menu, header, footer | Giữ nguyên |
| Trang chủ, blog, checkout, trang kết quả | Giữ nguyên |
| **Giỏ hàng** (drawer) | Giữ nguyên |
| Bảng màu, font, bo góc trong `@theme` | Giữ nguyên |
| Phần trên trang sản phẩm — breadcrumb, 2 cột ảnh/thông tin, giá, tồn kho, nút thêm giỏ và mua ngay | Giữ nguyên |

**Chỉ thay đổi**: phần dưới mục "Mô tả sản phẩm", nơi `BlockRenderer` dựng khối từ Sanity.

Hệ quả: không có route mới, không có thay đổi nào chạm tới luồng thanh toán.

## Cấu trúc khối

Thứ tự mặc định, phỏng theo trang tham chiếu. Trong Studio người biên tập kéo thả đổi thứ tự và dùng lại khối bao nhiêu lần tuỳ ý — `faq` xuất hiện hai lần ngay trong danh sách này.

| # | Khối | Trạng thái | Nội dung |
|---|---|---|---|
| 1 | `logoRow` | **mới** | Hàng logo, kiểu "đã xuất hiện trên" |
| 2 | `steps` | **mới** | Hướng dẫn từng bước, có thứ tự |
| 3 | `faq` | có sẵn | Accordion mô tả sản phẩm |
| 4 | `featureGrid` | **mới** | Dãy ô: ảnh + tên + mô tả |
| 5 | `comparisonTable` | **mới** | Bảng so sánh |
| 6 | `faq` | có sẵn | Accordion câu hỏi thường gặp |

**Quan trọng về diện mạo**: 4 khối mới dùng đúng token The Hour Tea hiện có — nền kem, chữ `#141414`, nhấn xanh `#357a38`, serif cho tiêu đề. Lấy *cấu trúc* của trang tham chiếu, không lấy diện mạo của nó.

---

## T4.1 — Bốn schema mới

Đặt trong `sanity/schemas/blocks/`, đăng ký vào `blockTypes` ở `blocks/index.ts`. Tên `name` chính là `_type` tới trình duyệt, nên phải khớp đúng union trong `lib/blocks.ts`.

### `logoRow`

```
heading?    string
logos[]     image + alt (bắt buộc), min 1 max 12
```

`alt` bắt buộc như mọi khối ảnh khác trong repo: một logo không mô tả được thì trình đọc màn hình không đọc được.

### `steps`

```
heading?    string
steps[]     min 1
  title     string, bắt buộc
  body?     text
  image?    image + alt
```

Số thứ tự **không** nhập tay — component tự đánh số theo vị trí trong mảng. Nhập tay thì chèn thêm một bước ở giữa là phải sửa lại hết.

### `featureGrid`

```
heading?    string
cards[]     min 1
  image?    image + alt
  title     string, bắt buộc
  body      text, bắt buộc
```

### `comparisonTable`

```
heading?    string
columns[]   string, min 2        ← hàng tiêu đề, cột đầu là nhãn hàng
rows[]      min 1
  label     string, bắt buộc
  cells[]   string               ← số phần tử nên bằng columns - 1
```

Ô dùng chuỗi tự do thay vì enum có/không, để vừa ghi được "Có", "Không", vừa ghi được giá trị như "100%". Nếu số ô lệch số cột thì component bù ô trống chứ không vỡ layout — dữ liệu người nhập không bao giờ được làm sập trang.

**Nghiệm thu**: `npx sanity schema validate` 0 lỗi; `npm run typecheck` sạch; `npm run studio:deploy`; tạo thử mỗi loại một khối trên Studio và lưu được.

---

## T4.2 — Kiểu trong `lib/blocks.ts`

Thêm 4 nhánh vào union `ContentBlock`. Nhớ luật: file này **chỉ có kiểu, không import gì ngoài type**, vì component `"use client"` phải import được.

Ảnh đã được GROQ resolve sẵn thành `url` + `w` + `h`, nên kiểu ở đây nhận URL chứ không nhận asset reference — giống `SliderImage` đang có.

**Nghiệm thu**: `npm run typecheck` sạch.

---

## T4.3 — Mở rộng `BLOCKS_PROJECTION`

Trong `lib/content.ts`. Ba khối có ảnh cần nhánh điều kiện để resolve asset thành URL kèm kích thước:

```groq
_type == "logoRow" => {
  "logos": logos[]{ alt, "url": asset->url,
                    "w": asset->metadata.dimensions.width,
                    "h": asset->metadata.dimensions.height }
},
_type == "steps" => {
  "steps": steps[]{ title, body, "image": image.asset->url }
},
_type == "featureGrid" => {
  "cards": cards[]{ title, body, "image": image.asset->url,
                    "alt": image.alt }
}
```

`comparisonTable` không có ảnh nên `...` mang nó qua nguyên vẹn.

Projection này **dùng chung với blog** (`lib/blog.ts` đọc `post.body` bằng đúng nó), nên 4 khối mới tự động dùng được trong bài viết luôn — không phải làm gì thêm.

**Nghiệm thu**: tạo doc thử có đủ 4 khối, gọi `getProductContent` qua script tạm, xác nhận mọi ảnh ra URL và **không còn `_ref` thô** nào trong kết quả.

---

## T4.4 — Bốn component

Trong `components/blocks/`, đăng ký vào `BlockRenderer`.

| Component | Ghi chú |
|---|---|
| `LogoRow` | Flex wrap, căn giữa. Server component |
| `Steps` | Danh sách `<ol>` — thứ tự là thông tin, nên dùng thẻ có ngữ nghĩa thay vì `<div>` đánh số. Server component |
| `FeatureGrid` | **3 ô một hàng** ở desktop, 2 ở tablet, 1 ở mobile. Server component |
| `ComparisonTable` | `<table>` thật với `<th scope>` — xem bên dưới |

Tất cả đều là server component: không có cái nào cần trạng thái. Đây là điểm cộng cho hiệu năng — chúng không thêm JavaScript nào vào trang.

### Bảng so sánh — điểm cần cẩn thận

Bản gốc **11 cột × 8 hàng**. Giữ đúng dạng bảng, cuộn ngang ở màn hình hẹp.

- Bọc trong `<div class="overflow-x-auto">` — **chỉ bảng được tràn**, thân trang không bao giờ được cuộn ngang.
- Cột nhãn `position: sticky; left: 0` để cuộn ngang vẫn biết đang đọc hàng nào.
- `<th scope="col">` cho hàng tiêu đề, `<th scope="row">` cho cột nhãn. Thiếu `scope` thì bảng 11 cột là không đọc nổi bằng trình đọc màn hình.
- Thêm `tabindex="0"` và `role="region"` kèm `aria-label` cho vùng cuộn, để cuộn được bằng bàn phím.

**Nghiệm thu**: `npm run build`; render đủ 4 khối; ở 390px không có cuộn ngang ở thân trang mà chỉ trong bảng; cột nhãn dính khi cuộn; `FeatureGrid` đúng 3 ô một hàng ở desktop.

---

## T4.5 — Nội dung cho Test Product 1

Nhập trên Studio theo thứ tự ở đầu file.

**Phần chữ là nội dung gốc, không sao chép từ trang tham chiếu.** Cấu trúc thì sao chép được; câu chữ marketing của một thương hiệu khác thì không. Hoặc bạn tự viết, hoặc nói tôi soạn bản nháp mới dựa trên sản phẩm thật.

Ảnh cho `logoRow` và `featureGrid` upload thẳng lên Sanity — Sapo chỉ giữ một ảnh cho mỗi sản phẩm.

Nhắc lại luật đã có: **`_id` không được chứa dấu chấm**. Tạo từ Studio thì không lo vì Sanity sinh UUID; chỉ cắn khi đặt id bằng tay.

**Nghiệm thu**: mở `/products/test-product-1` trên production, đủ 6 khối hiện đúng thứ tự.

---

## T4.6 — Ghi lại

- `CLAUDE.md`: thêm 4 khối vào mục Sanity; ghi rằng chúng dùng được cho cả trang sản phẩm lẫn bài viết nhờ `BLOCKS_PROJECTION` dùng chung.
- Lưu ý về bảng cuộn ngang và cột nhãn dính, để sau này không ai "sửa" nó thành bảng co lại cho vừa màn hình.
- `docs/plan/README.md`: đánh dấu T4 xong.

---

## Ước lượng

Khoảng **1 ngày**, phần lớn nằm ở 4 component và CSS. Schema và projection nhanh.

Rủi ro duy nhất đáng kể là bảng so sánh: 11 cột trên màn hình điện thoại là bài toán thật, và làm sai thì nó đẩy cả trang cuộn ngang — lỗi dễ lọt vì ở desktop trông vẫn ổn.
