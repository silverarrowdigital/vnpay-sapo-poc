# T3 — Sao chép giao diện từ design reference

**Bản viết lại ngày 2026-10-01.** Bản cũ đặt mục tiêu "trích token rồi dựng lại component theo cấu trúc hiện có" — tức là mockup theo style. Mục tiêu thật là **sao chép trung thực các trang trong `design/reference/`**. Toàn bộ file này thay cho bản cũ.

---

## Quyết định đã chốt (2026-10-01)

| | Chốt | Ghi chú |
|---|---|---|
| CSS | **Tailwind** | Site ref là Tailwind (656 utility class). Dùng chung từ vựng thì đối chiếu được 1-1 với markup gốc. Thay cho quyết định "plain CSS" trước đó, vốn dựa một phần vào kết quả dò Tailwind mà tôi đọc sai |
| Checkout / Success | **Thiết kế mới theo hệ** | Không có trong ref. Dùng đúng token, font, nút, input của ref |
| Nav | **Giữ đủ như ref**, trang chưa có thì 404 | Trung thực về thứ chưa làm, không giả vờ |
| Thứ tự | **T3 trước, rồi T2** | Ref có sẵn blog list + blog detail, nên T2 viết thẳng vào giao diện cuối |

## Phải sửa trước: lớp token T0 sai

T0 trích giá trị từ khai báo `:root` trong CSS. Nhưng trang thật dùng utility class ở chỗ khác, nên kết quả lệch ở những chỗ căn bản nhất — nhìn screenshot là thấy:

| Token | T0 đặt | Thực tế trên ref |
|---|---|---|
| `--bg` | `#ffffff` trắng | **Be/hồng đất ấm** |
| Nút chính | `--accent` `#BF4800` | **Xanh lá** ("MUA NGAY"). `#BF4800` không thấy dùng làm nút |
| Nền section | một màu duy nhất | **Nhiều dải tint khác nhau** (khối reviews, khối feature card, thân trang đều khác nhau) |

⇒ **T3.1 trích lại token từ trang đã render**, không từ `:root`. Mọi giá trị trong `design/TOKENS.md` mục 1 phải coi là chưa đáng tin cho tới khi bước đó xong.

---

## Phạm vi: ref có gì, dự án có gì

| Trang ref | Route dự án | Trạng thái |
|---|---|---|
| products (shop) | `/` | Sao chép |
| product-details | `/products/[handle]` | Sao chép |
| blog | `/blog` | Sao chép — dựng vỏ ở T3, nội dung ở T2 |
| blog-details | `/blog/[slug]` | Sao chép — như trên |
| cart (popup trong trang) | giỏ hàng | Sao chép |
| — | `/checkout` | **Không có ref** → thiết kế mới theo hệ |
| — | `/success` | **Không có ref** → thiết kế mới theo hệ |

### Có trong ref nhưng dựng không được, và vì sao

Phải nói trước để không ai kỳ vọng sai về chữ "y chang":

- **Bộ chọn variant** (4 pill: 95G / 200G / 5×95G / 10×95G). Dự án lấy **một variant đầu theo `position`** cho mỗi sản phẩm (giới hạn MVP đã ghi trong `CLAUDE.md`). Không có dữ liệu để dựng 4 pill. ⇒ Bỏ khối này, ghi chú lại.
- **Customer Reviews** (điểm sao, histogram). Không có nguồn dữ liệu nào trong dự án — Sapo không cấp, Sanity chưa có schema. ⇒ Bỏ hẳn.
- **Logo cổng thanh toán** (ZaloPay / Mastercard / VISA). Đây là tài sản thương hiệu của bên thứ ba, và dự án chỉ chạy VNPAY. ⇒ Thay bằng một dòng nói rõ thanh toán qua VNPAY.
- **Thư viện ảnh dạng lưới nhiều ảnh** ở trang chi tiết. Sapo trả **một ảnh** cho mỗi sản phẩm (đã kiểm: cả 4 sản phẩm đều có đúng 1 ảnh). ⇒ Dựng đúng lưới, nhưng nó sẽ chỉ có 1 ô cho tới khi Sapo có thêm ảnh. Có thể bù bằng block `imageSlider` của Sanity.
- **WHOLESALE, VỀ CHÚNG TÔI, LIÊN HỆ**. Giữ trong nav, bấm vào ra 404 (quyết định đã chốt).

### Tôi sao chép được tới đâu

Tôi có **output đã build** của site, không có source React. Nên tái dựng được cấu trúc DOM và CSS rất sát, nhưng markup sẽ viết lại để gắn vào dữ liệu Sapo/Sanity. Giống về mặt nhìn; không phải bản sao component.

---

## Các bước

### T3.0 — Chuyển sang Tailwind

- `npm i -D tailwindcss @tailwindcss/postcss postcss`, cấu hình theo **tài liệu Tailwind v4** (đọc trước, đừng theo thói quen v3: v4 bỏ `tailwind.config.js` cho phần lớn trường hợp và khai token bằng `@theme` trong CSS).
- `app/globals.css`: giữ `@import "tailwindcss"`, chuyển lớp token thành `@theme`.
- **Chưa đụng component nào ở bước này.** Mục tiêu: `npm run build` xanh với Tailwind đã bật, giao diện chưa đổi.
- Cập nhật `CLAUDE.md` mục "Coding conventions" — câu "no UI framework, plain CSS" không còn đúng.

**Nghiệm thu**: `typecheck`, `lint`, `build` đều exit 0; 4 trang hiện tại vẫn hiện như trước.

### T3.1 — Trích lại token từ trang đã render

- Lấy màu từ **screenshot và markup đã render**, không từ `:root`: nền trang, nền từng dải section, màu nút chính (xanh lá), màu chữ, màu viền.
- Đối chiếu từng giá trị với ảnh trong `design/reference/shots/`.
- Viết lại `design/TOKENS.md` mục 1 và mục 7; đánh dấu rõ giá trị nào lấy từ CSS, giá trị nào đọc từ ảnh.
- Kiểm tương phản lại từ đầu: nút xanh lá + chữ trắng, chữ trên nền be.

**Nghiệm thu**: `TOKENS.md` không còn giá trị nào mâu thuẫn với screenshot; mọi cặp chữ/nền đạt ≥ 4.5:1.

### T3.2 — Shell: thanh thông báo, header, footer

- Thanh thông báo trên cùng (nền hồng nhạt, chữ nhỏ in hoa, canh giữa).
- Header: logo trái; nav phải gồm ONLINE SHOP, WHOLESALE, VỀ CHÚNG TÔI, LIÊN HỆ, BLOG, CART (n), icon tìm kiếm.
- `CartBadge` hiện tại đổi thành dạng `CART (n)` của ref.
- Nav mobile theo `shots/*-mobile-*`.
- Footer theo ref.
- Giữ `suppressHydrationWarning` trên `<body>` — có lý do thật, đã ghi trong `CLAUDE.md`.

**Nghiệm thu**: header/footer khớp ảnh desktop và mobile; giỏ vẫn đếm đúng sau khi thêm hàng.

### T3.3 — Trang danh sách sản phẩm (`/`)

Theo `shots/products-*`: tiêu đề serif cỡ lớn canh giữa; thanh "Sắp xếp theo" canh phải có đường kẻ mảnh dưới; lưới 3 cột, khoảng cách rộng; mỗi tile là ảnh trong khung bo góc có nền tint riêng, **giá nằm trên tên** (dự án đang để dưới), tên serif cắt 2 dòng.

- Thanh "Sắp xếp theo" chỉ dựng giao diện ở bước này; chức năng sắp xếp là việc riêng, không thuộc T3.

**Nghiệm thu**: so cạnh nhau với `products-desktop-reference.png` và bản mobile.

### T3.4 — Trang chi tiết sản phẩm (`/products/[handle]`)

Theo `shots/product-details-*`:

- Breadcrumb `Trang chủ / Sản phẩm / <tên>`.
- Hai cột: trái là lưới ảnh, phải là thông tin.
- Cột phải: eyebrow tên thương hiệu, tiêu đề serif, giá dạng mono, dòng ghi chú phí vận chuyển, bộ đếm số lượng dạng pill, nút "THÊM VÀO GIỎ HÀNG" viền, nút "MUA NGAY" nền xanh lá full width.
- Dưới: tiêu đề "Mô tả sản phẩm" + phần nội dung.
- **Chỗ này nối vào T1**: dãy 3 thẻ feature (ảnh + tiêu đề + mô tả) trong ref chính là thứ khối Sanity sinh ra. Phần nội dung dưới trang do `BlockRenderer` dựng, không hardcode.
- Bỏ: pill variant, Customer Reviews, logo cổng thanh toán (lý do ở mục phạm vi).

**Nghiệm thu**: so với ảnh; `test-product-1` hiện đủ 6 khối Sanity trong bố cục mới; thêm vào giỏ vẫn chạy.

### T3.5 — Giỏ hàng dạng popup

Theo `shots/cart-*`. Dự án hiện có `/checkout` là route riêng.

- Dựng drawer/popup: mở bằng nút CART ở header.
- Bẫy focus, đóng bằng `Esc`, khoá cuộn nền, `aria-modal`, trả focus về nút CART khi đóng.
- Popup liệt kê các dòng giỏ và dẫn sang `/checkout`; **không** chuyển cả form thanh toán vào popup.
- `/checkout` giữ nguyên là một route — xem T3.6.

**Nghiệm thu**: mở/đóng bằng bàn phím; `ClearCartOnSuccess` vẫn hoạt động (giỏ xoá ở trang kết quả, không phải lúc checkout).

### T3.6 — Checkout và Success (thiết kế mới)

Không có ref. Dựng từ chính hệ vừa sao chép: cùng nền, cùng font, cùng kiểu input và nút của T3.4.

**Không được làm hỏng** — mỗi thứ đều có lý do đã ghi trong `CLAUDE.md`:

- `CheckoutForm` hiện lỗi env dạng **tên biến** ở môi trường dev. Mất cái này là mất công cụ chẩn đoán cấu hình.
- `app/success/page.tsx` nói rõ đang dùng store nào (Redis hay Map) khi không tìm thấy đơn.
- `AutoRefresh` 3 giây; `ClearCartOnSuccess`.
- Không thêm field nào vào form. Giá luôn tính ở server.

**Nghiệm thu**: chạy trọn một lượt thật — `npm run dev` + `npm run watch:ipn`, thẻ NCB test, `/success` báo thành công, đơn mới trong Sapo. Dọn bằng `npm run clean:orders -- --yes`.

### T3.7 — Vỏ trang blog

Dựng `/blog` và `/blog/[slug]` theo `shots/blog-*` và `shots/blog-details-*`, với dữ liệu giả. T2 chỉ việc thay dữ liệu giả bằng Sanity — không phải sửa markup.

**Nghiệm thu**: hai trang khớp ảnh; chưa cần Sanity.

### T3.8 — Responsive và a11y

- Kiểm ở 390 / 768 / 1024 / 1440 px, đối chiếu ảnh mobile. Không scroll ngang ở 390px.
- Chạy skill `design:accessibility-review`, rồi tự kiểm: tương phản ≥ 4.5:1; `:focus-visible` thấy được trên mọi link/nút/input; vùng bấm ≥ 44×44px; nút chỉ có icon (tìm kiếm, đóng popup) có `aria-label`; heading không nhảy bậc; `prefers-reduced-motion` tắt mọi chuyển động.
- `typecheck`, `lint`, `build` — kiểm **exit code**, không chỉ nhìn output.

### T3.9 — Ghi lại

- `CLAUDE.md`: đổi "no UI framework, plain CSS" thành Tailwind; thêm các route/component mới; ghi danh sách "có trong ref nhưng không dựng" kèm lý do; sửa ghi chú đã lỗi thời rằng store Sapo không có ảnh sản phẩm (cả 4 sản phẩm đều có ảnh).
- `design/TOKENS.md`: bảng token cuối cùng.

---

## Giới hạn phải nói với người xem kết quả

"Y chang" đạt được ở: bố cục, thang chữ, màu, khoảng cách, kiểu nút, cấu trúc trang.

Không đạt được ở: bộ chọn variant, đánh giá khách hàng, thư viện nhiều ảnh, các trang tĩnh trong nav — tất cả vì **thiếu dữ liệu**, không phải vì thiếu CSS. Có dữ liệu thì dựng được.
