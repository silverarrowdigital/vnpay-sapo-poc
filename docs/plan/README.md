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
| 5 | **T4** — Khối nội dung trang sản phẩm | [T4-product-content-blocks.md](T4-product-content-blocks.md) | ✅ Xong. `logoRow` bị bỏ theo quyết định 2026-10-02; `steps` chưa có ảnh (xem ghi chú dưới) |
| 6 | **T5** — Dựng lại trang sản phẩm theo drinkmarna.com | [T5-product-page-marna.md](T5-product-page-marna.md) | ✅ Xong, áp cho **cả 5 sản phẩm**. **Ảnh vẫn là ảnh tạm** và 7 câu về doanh nghiệp còn chờ thông tin thật — xem ghi chú dưới |
| 7 | **T6** — Lớp token theo design Figma | [the-hour-tea-nextjs-design.md](../../design/the-hour-tea-nextjs-design.md) | ✅ Xong (commit `6c316f3`). Không có file kế hoạch riêng: design doc chính là đặc tả. **Thang khoảng cách chưa đổi** |
| 8 | **T7** — Từ bản chạy được thành cửa hàng bán thật | [T7-ban-hang-that.md](T7-ban-hang-that.md) | ⬅️ **Tiếp theo** — chặn ở **T7.0** (bật quyền Private App) |
| 9 | **T9** — Chọn biến thể (size) cho sản phẩm | [T9-bien-the-san-pham.md](T9-bien-the-san-pham.md) | ✅ Xong và **đã deploy** (commit `ed0ffa9`, 2026-10-06). Đã kiểm bằng đơn VNPAY sandbox thật. Còn mở: giỏ hai size, size hết hàng cạnh size còn hàng |
| 10 | **T10** — Từ bản chạy thử đến production thật | [T10-san-sang-production.md](T10-san-sang-production.md) | 🚧 **Lô đầu đã làm** (commit `0bf8a50`, 2026-10-06): `/success` hết lộ địa chỉ, banner freeship đúng số, trang 404/lỗi tiếng Việt, rào script production. Qua typecheck/lint/build và review; **chưa kiểm trên trình duyệt hay với giao dịch thật**. Còn mở: VNPAY thật, trang pháp lý, cảnh báo đơn kẹt, thương hiệu thật. Mục 7 so sánh với thehourtea.com |
| 11 | **T11** — Tra cứu đơn khó đoán hơn | [T11-tra-cuu-don-an-toan.md](T11-tra-cuu-don-an-toan.md) | ✅ Đã làm xong code (2026-10-07), kiểm chứng sandbox rồi; đã commit (`f85f008`) |
| 12 | **T12** — Dựng lại toàn site theo layout `design/site-v3/` | [T12-giao-dien-site-v3.md](T12-giao-dien-site-v3.md) | ✅ Đã làm T12.1–T12.5 (2026-10-07), đã commit (`1cd5b83` và các commit sau); T12.6 (collection) bị chặn vì shop chưa có collection nào |
| 13 | **T13** — Xử lý các mục còn mở trong doc tiến độ | [T13-khep-muc-con-lai.md](T13-khep-muc-con-lai.md) | 🔧 2026-10-07: T13.0, .2–.6, .8, .9 đã làm và commit (`0ad5ad7`; 129 test đạt lúc đó); .7 quyết định không đổi. Chủ shop đã chốt 6 câu theo khuyến nghị. Cập nhật cuối ngày 2026-10-07: T13.1 đã chạy ở máy với VNPAY/Sapo thật (thiếu IPN được cứu qua querydr, hoàn tiền thật đầu tiên mã `00`, huỷ không tạo đơn); T13.10 xong (một lỗi menu đã sửa); T13.11 đã đo, **LCP chưa đạt 2,5 s ở `/shop` và trang sản phẩm** (chờ quyết định cache của chủ shop); T13.12 đã đo, gói Sapo vẫn chưa biết; T13.13 = T14. Chưa kiểm trên production: đường querydr của T13.0, và đơn đã đóng/huỷ trong Sapo |
| 14 | **T14** — Sổ giao dịch trên Postgres (PR 4–6) | [T14-so-giao-dich-postgres.md](T14-so-giao-dich-postgres.md) | 🚧 (2026-10-07) PR 4 xong; PR 5 xong và đã kiểm chứng trên production (đơn sandbox thật, không lệch Redis); PR 6 xong ở dạng "sweep" (QStash mỗi 5 phút), chạy được trên production nhưng **chưa từng cứu một đơn mất IPN thật**. **Còn lại:** PR 6b đã code nhưng chưa deploy (dòng 15), đọc từ Postgres, PR 7–10 |
| 15 | **T14 PR 6b** — IPN ghi sổ trong một transaction rồi mới trả lời VNPAY | [T14-6b-ipn-ghi-so-truoc.md](T14-6b-ipn-ghi-so-truoc.md) | 🔧 Duyệt 2026-10-08 (D1–D5 theo khuyến nghị). **Đã code, đã review, chưa deploy** (chưa commit; 229 test đạt ở máy). Chưa chạy với Neon/production, độ trễ IPN chưa đo |
| 16 | **T14 PR 6c** — Trả lời VNPAY ngay sau khi sổ đã ghi, tạo đơn Sapo sau (IPN 5,7 s → ~3 s) | [T14-6c-tra-loi-ipn-som.md](T14-6c-tra-loi-ipn-som.md) | 🔧 Duyệt D1–D3 2026-10-08 (theo khuyến nghị; `maxDuration` = 120). **Đã code, đã review, chưa commit, chưa deploy** (253 test đạt ở máy). Chưa kiểm trên Vercel thật; thời gian IPN mới chưa đo |

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
2. ~~Variant picker~~ — code xong (T9, 2026-10-06). **Còn một việc:** đặt một đơn thật cho size không phải size đầu để kiểm trừ kho và nhãn trên đơn Sapo — xem [T9](T9-bien-the-san-pham.md).
3. Ảnh sản phẩm thật trên store Sapo (hiện chưa có nên tile hiện placeholder) — hoặc cho phép override ảnh sản phẩm từ Sanity.

## T4.5 — những chỗ lệch so với kế hoạch

Khung nội dung product details gồm 5 khối — steps → faq mô tả → featureGrid → comparisonTable → faq — và **cả bốn sản phẩm Sapo đều dùng chung khung này** (`productContent-<sapoProductId>`, sinh từ một định nghĩa duy nhất rồi đối chiếu từng khối để chắc chắn không lệch). Ba điểm khác kế hoạch, đều do dữ liệu chứ không phải code:

1. **`logoRow` bị bỏ.** Trang sản phẩm của reference chỉ có hàng logo cổng thanh toán, thứ `CLAUDE.md` đã quyết không dựng (asset bên thứ ba, dự án này chỉ nhận VNPAY).
2. **`steps` không có ảnh.** Toàn bộ `design/reference/` không có tấm ảnh pha trà nào — bài blog chỉ có screenshot và ảnh chiến dịch. Gán packshot hộp trà cho "Tráng trà nhanh" thì `alt` sẽ phải mô tả sai, nên để trống. Field vẫn còn, thêm ảnh trong Studio là hiện ngay.
3. **Câu trả lời FAQ là bản nháp tự soạn.** Reference có 5 câu hỏi nhưng câu trả lời do JS tải nên bản lưu không có. Năm câu trả lời hiện tại viết để sửa lại trong Studio.

**Bốn trang hiện có nội dung chữ giống hệt nhau.** Đúng với ý "khung nội dung", nhưng khi có sản phẩm thật thì phần mô tả, FAQ và dãy ô cần viết riêng cho từng loại trà — bốn trang trùng chữ là nội dung trùng lặp với công cụ tìm kiếm, và `app/sitemap.ts` có khai báo cả bốn. Sửa trong Studio, mỗi document một sản phẩm.

Khối slider ảnh cũ của T1 đã bị bỏ: ảnh trong đó là ảnh thử, `alt` còn ghi "màu nhấn #BF4800" — bảng màu mà T3 đã bác bỏ.

## T5 — việc còn lại sau khi áp khung

Khung T5 gồm **9 khối**, đã áp cho cả 5 sản phẩm Sapo đang hoạt động, sinh từ **một định nghĩa duy nhất** rồi đối chiếu từng khối (bỏ `_key`, chuẩn hoá thứ tự key) nên năm trang không thể lệch nhau.

**Dùng lại `_id` đang có, không đặt theo quy ước.** `hong-tra-shan-tuyet-60g` được tạo từ Studio nên `_id` là UUID (`7e48fe61-…`), không phải `productContent-92784200`. Tạo mới theo quy ước sẽ cho **hai document cùng một sản phẩm**, mà kiểm tra trùng chỉ chạy lúc sửa trong Studio chứ không cứu được lúc đọc — truy vấn `[0]` sẽ lấy bừa một cái. Script nhân khung vì vậy đọc `_id` hiện có trước khi ghi.

**Sửa 2026-10-02**: *Hợp với bạn nếu* và *Trải nghiệm* trước đây là hai khối `richText` riêng, mỗi khối một `h2` — hai mục ngang hàng về nội dung lại nằm rời nhau và tranh cấp tiêu đề với heading chung. Giờ gộp thành **một accordion**: heading khối giữ `h2`, hai mục thành hai `<details>` cùng cấp. Gạch đầu dòng vẫn render được bên trong mục gập.

Hai thứ còn chờ chủ cửa hàng:

1. **Bảy câu là phát biểu về doanh nghiệp Marna** (đối tác bán lẻ, kho ở Anh và lời hứa 24–48 giờ, giá bảng Anh, email hỗ trợ, gói đăng ký, con số vi nhựa có dẫn nguồn). Đã viết lại trung tính thay vì dịch nguyên văn, vì dịch nguyên văn là nói sai sự thật về cửa hàng này. Sửa trong Studio, không cần deploy.
2. **Ảnh đang là ảnh tạm** — `imageSlider`, `logoRow` và `ingredientCards` đều dùng lại ba packshot của T4.5. Riêng hàng logo *ĐƯỢC NHẮC ĐẾN TẠI* đang là ảnh hộp trà chứ không phải logo.

## Backup

Hai thứ **không** nằm trong git và phải tự sao lưu:

1. **Nội dung Sanity** — `npx sanity dataset export production backups/sanity-<ngày>.tar.gz`. Kéo luôn ảnh. `backups/` đã gitignore. Làm trước mỗi lần đổi schema hoặc nhập nội dung lớn.
2. **`.env.local`** — sao thành `.env.backup.<ngày>.local` (khớp `.env*.local` nên cũng gitignore). **Đừng ghi đè bản cũ**: bản 2026-09-30 là nơi duy nhất còn `SAPO_VARIANT_ID`. Nguồn thật là Vercel (`vercel env pull`), nhưng Vercel CLI phải được cài trước.

Code thì đã an toàn: mọi branch đều đã push lên `origin`, và deployment cũ trên Vercel vẫn rollback được.
