# Kế hoạch 2026-10-01 — Sanity CMS, Blog, Giao diện mới

Chỉ mục các kế hoạch đã duyệt. Mỗi bước có một ID; để thực hiện, chỉ cần ra lệnh bằng ID:

> `làm T1.3`  ·  `làm T1` (cả task)  ·  `làm T0 rồi T1.1`  ·  `xem lại T2.4`

Claude đọc file tương ứng, làm đúng phần "Việc", rồi tự chạy phần "Nghiệm thu" trước khi báo xong.

## Thứ tự đã duyệt

| # | Task | File | Trạng thái |
|---|---|---|---|
| 1 | **T0** — Lớp design token | [T0-design-tokens.md](T0-design-tokens.md) | ✅ Xong — nhưng **mục màu sai**, T3.1 trích lại |
| 2 | **T1** — Product description dạng component (Sanity) | [T1-product-content.md](T1-product-content.md) | ✅ Xong và đã verify trên dữ liệu thật |
| 3 | **T3** — Sao chép giao diện từ design ref | [T3-ui-redesign.md](T3-ui-redesign.md) | ✅ Xong (commit `34c35c0`, `e5eeff1`) — mục "Storefront UI (T3)" trong `CLAUDE.md` |
| 4 | **T2** — Blog (Sanity) | [T2-blog.md](T2-blog.md) | ✅ Xong, đang chạy trên production |
| 5 | **T4** — Khối nội dung trang sản phẩm | [T4-product-content-blocks.md](T4-product-content-blocks.md) | ✅ Code xong (T4.1–T4.4, T4.6). **T4.5 chưa làm** — chờ chốt nội dung và ảnh |

**T2 viết lại 2026-10-01.** Project Sanity ở gói **Free**, nên tiết kiệm lượt gọi API là yêu cầu bắt buộc chứ không phải tối ưu để dành. Mục tiêu: lưu lượng tới Sanity phụ thuộc vào tần suất sửa nội dung, **không** phụ thuộc lượng khách truy cập. Kế hoạch giờ mở đầu bằng **T2.0 — gỡ `SANITY_READ_TOKEN`**, vì request có token thường không được CDN phục vụ, tức mỗi lần cache miss là một lượt gọi origin.

**Thứ tự đổi 2026-10-01**: T3 lên trước T2. Design ref có sẵn trang blog list và blog detail, nên dựng giao diện trước thì T2 viết thẳng vào bố cục cuối, khỏi làm rồi sơn lại.

## Quyết định đã chốt

1. **Giao diện mẫu**: bản lưu trang + screenshot trong `design/reference/`. Tải lại bằng `npm run fetch:reference`.
2. **Sanity Studio**: hosted tại https://vnpay-sapo-poc.sanity.studio/. Schema nằm trong repo tại `sanity/`, **không** vào bundle của Next.
3. **Mục tiêu giao diện (sửa 2026-10-01)**: **sao chép trung thực** các trang trong ref, không phải dựng lại theo style. Bản T3 cũ đặt mục tiêu sai; đã viết lại.
4. **CSS (sửa 2026-10-01)**: **Tailwind**, không phải plain CSS. Site ref là Tailwind; dùng chung từ vựng thì đối chiếu 1-1 được. Quyết định "plain CSS" trước đó dựa một phần vào kết quả dò Tailwind mà tôi đọc sai.
5. **Checkout / Success**: không có trong ref → thiết kế mới theo đúng hệ của ref.
6. **Nav**: giữ đủ như ref; trang chưa dựng thì 404.

## Quy tắc chung cho mọi bước

- **Nghiệm thu bắt buộc** sau mỗi bước: `npm run typecheck && npm run lint && npm run build`. Bước nào có thêm kiểm tra riêng thì ghi trong file.
- **Một branch cho mỗi task**: `feat/design-tokens`, `feat/sanity-product-content`, `feat/blog`, `feat/redesign`. Commit theo từng bước ID (`T1.4: thêm productId vào CatalogProduct`).
- **Next 16 ≠ Next bạn từng biết.** Trước khi viết code liên quan tới caching, `params`, metadata hay route handler: đọc guide trong `node_modules/next/dist/docs/`. Không suy từ thói quen Next 13/14.
- **Bước cuối của mỗi task là cập nhật `CLAUDE.md`.** `CLAUDE.md` là source of truth của repo này; một task chưa ghi vào đó là chưa xong.
- **Không bịa endpoint.** Sapo/VNPAY: chỉ dùng endpoint đã ghi trong `CLAUDE.md`. Sanity: chỉ dùng GROQ qua `@sanity/client`.

## Hai nguyên tắc mới mà kế hoạch này đưa vào

### 1. Sanity lỗi ≠ Sapo lỗi

| | Sapo | Sanity |
|---|---|---|
| Giữ cái gì | Giá, tồn kho, đơn hàng | Mô tả, hình, blog |
| Lỗi thì | **Chặn bán**, báo lỗi (`getSapoConfig` throw `MissingEnvError`) | **Degrade**, vẫn bán được |
| Vì sao | Thu tiền sai giá là mất tiền | Thiếu mô tả chỉ là trang xấu hơn |

Hệ quả cụ thể: `getSanityConfig()` trả `null` khi chưa cấu hình, **không throw**. `getProductContent()` trả `null` khi lỗi/timeout, và trang sản phẩm quay về `product.description` như hiện tại. Trang blog thì khác — nó không có nội dung dự phòng nào, nên được phép hiện thẻ lỗi giống `app/page.tsx` khi Sapo chết.

### 2. Không bao giờ render HTML từ CMS

Luật này đã có trong repo (`htmlToText` ở `lib/sapo.ts` tước HTML của Sapo, vì mô tả sản phẩm là thứ người khác gõ vào). Sanity giữ nguyên luật:

- Rich text đi qua Portable Text → component của ta, không qua `dangerouslySetInnerHTML`.
- Video: schema chỉ nhận `provider` (enum) + `videoId` (regex). **Không** nhận URL tự do, **không** nhận iframe/HTML thô.
- Link trong rich text: chỉ `http`, `https`, `mailto`.

## Việc còn lại sau 3 task này (không nằm trong hôm nay)

1. ~~Webhook `/api/revalidate` để Sanity publish là trang cập nhật ngay~~ — xong. Hook `SAPO VNPAY POC` đã trỏ vào `https://vnpay-sapo-poc.vercel.app/api/revalidate`, secret đã có trên Vercel; kiểm bằng `npm run check:revalidate -- <url>`.
2. Variant picker (`CLAUDE.md` → Known MVP limitations: hiện mỗi sản phẩm chỉ lấy variant đầu theo `position`).
3. Ảnh sản phẩm thật trên store Sapo (hiện chưa có nên tile hiện placeholder) — hoặc cho phép override ảnh sản phẩm từ Sanity.

## Backup

Hai thứ **không** nằm trong git và phải tự sao lưu:

1. **Nội dung Sanity** — `npx sanity dataset export production backups/sanity-<ngày>.tar.gz`. Kéo luôn ảnh. `backups/` đã gitignore. Làm trước mỗi lần đổi schema hoặc nhập nội dung lớn.
2. **`.env.local`** — sao thành `.env.backup.<ngày>.local` (khớp `.env*.local` nên cũng gitignore). **Đừng ghi đè bản cũ**: bản 2026-09-30 là nơi duy nhất còn `SAPO_VARIANT_ID`. Nguồn thật là Vercel (`vercel env pull`), nhưng Vercel CLI phải được cài trước.

Code thì đã an toàn: mọi branch đều đã push lên `origin`, và deployment cũ trên Vercel vẫn rollback được.
