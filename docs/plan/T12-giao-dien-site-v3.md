# T12 — Dựng lại toàn site theo layout `design/site-v3/`

**Trạng thái (2026-10-07): ĐÃ LÀM T12.1 đến T12.5; T12.6 bị chặn. Code nằm trong working tree, CHƯA commit, CHƯA deploy.**
Cả 12 câu đã được chốt **theo khuyến nghị** (bạn trả lời "làm theo khuyến nghị hết", 2026-10-07) và code làm đúng theo đó.
T12.6 (trang collection) không làm được: xem mục "Kết quả" bên dưới.

## Kết quả (2026-10-07)

**Đã kiểm (2026-10-07):** chạy `next start` trên bản build production, chỉ gửi yêu cầu GET đọc; thêm 90 bài test đơn vị
(8 file) và `typecheck`, `lint`, `build` đều qua. Ảnh chụp 1440px đã xem: trang chủ, `/shop`, trang sản phẩm, `/checkout`, footer.
Reviewer không thấy lỗi nghiêm trọng; các mục nên sửa (menu kéo-ra thừa hưởng chữ in hoa từ nút giỏ, giới hạn tốc độ chạy trước
bước kiểm tra form, marquee không dừng được, màu ô xám gõ cứng, canonical theo trang) đã sửa. Còn lại là các điểm nhỏ: tiêu đề
nhảy cấp ở `/shop` (h3 dưới h1), cỡ chữ px gõ cứng, màu hero.

**Đã làm:**
- Khung chung (`SiteHeader`, `SiteFooter`): footer không có form nhận tin và không có link Bộ Công Thương (câu 4, 11). Menu
  mục "Chuyện của Trà" đã bị bỏ khỏi menu theo yêu cầu của bạn (2026-10-07); không có link Search vì không có trang tìm kiếm.
- `/` là trang chủ mới, danh mục chuyển sang `/shop`. Câu sức khỏe/FDA ẩn bằng công tắc `SHOW_HEALTH_CLAIMS = false`
  (`lib/home.ts`); logo đối tác ẩn khi `PARTNER_LOGOS` rỗng; "bán chạy" lấy 4 sản phẩm còn hàng đầu tiên khi
  `BEST_SELLER_PRODUCT_IDS` rỗng.
- Sản phẩm test: T12 từng ẩn chúng khỏi `/`, `/shop`, sitemap. **Đổi ngày 2026-10-07 theo quyết định của chủ shop:** cửa
  hàng phản ánh đúng Sapo, nên `/` và `/shop` hiện mọi sản phẩm đang bán, kể cả sản phẩm test. Chúng chỉ còn bị loại khỏi
  sitemap và có `noindex`. Câu 6 bên dưới vì thế không còn áp dụng cho phần hiển thị.
- `/ve-chung-toi`, `/lien-he`, `/chinh-sach/*`, `/blog`, `/blog/[slug]` (thêm "Các bài viết liên quan"), trang sản phẩm đã đổi giao diện;
  nội dung và dữ liệu giữ nguyên. `/ve-chung-toi` thêm mục "Sản phẩm The Hour" (bỏ câu sức khỏe/chứng nhận) và hai đoạn về người
  sáng lập (bỏ "an toàn tuyệt đối").
- Form liên hệ: gửi qua Resend tới hộp thư trong biến `CONTACT_EMAIL_TO`, tối đa 5 lần/giờ/IP. Chưa đặt biến thì `/api/contact`
  trả 404 và `/lien-he` không hiện form (đã kiểm).
- Sửa CSS: quy tắc màu link chuyển vào `@layer base` để class tiện ích thắng (trước đó mọi link đều bị tô vàng, kể cả chữ trên
  nút vàng). Thêm màu cho ô xám thay ảnh và hiệu ứng marquee (dừng khi rê chuột/focus, tôn trọng giảm chuyển động).
- Không làm dark mode (giữ quyết định T6).

**Bị chặn, T12.6:** các endpoint `custom_collections`, `smart_collections`, `collects`, `collections` của Sapo đều trả 200 với danh
sách **rỗng** trên store này (kiểm chỉ đọc, 2026-10-07). Chưa có collection nào để dựng hay kiểm lọc `?collection_id=`. Việc của chủ
shop: tạo một collection trong Sapo, rồi mới làm tiếp T12.6.

**CHƯA kiểm, đừng coi là đã đúng:**
- **Giao diện điện thoại (390px) chưa được xem.** Trình duyệt không đầu ở đây có chiều rộng cửa sổ tối thiểu nên chỉ chụp được 1440px.
- **Form liên hệ chưa từng gửi mail thật**, và chưa biết Resend có nhận tên trường `reply_to` không (lần kiểm 2026-10-06 chỉ phủ
  from/to/subject/text).
- Luật ẩn sản phẩm test chỉ theo tên: một sản phẩm tên "TEST-…" hoặc "[TEST] …" vẫn sẽ hiện. Hiện store có một sản phẩm thật
  ("Hồng Trà Shan Tuyết 60g") cạnh các sản phẩm test.
- Ảnh vẫn là ô xám: hero, logo đối tác, ảnh sản phẩm trong "Sản phẩm The Hour", chân dung người sáng lập.
- **Chữ giữ nguyên từ thiết kế nhưng chủ shop cần xác nhận** vì là lời hứa chưa ai kiểm: "3 vị trà mới", khuyến mãi "Giá hời bất
  ngờ", lời khách có tên kèm 5 sao, và "hoàn toàn không sử dụng phân bón hay thuốc bảo vệ thực vật".

## Nguồn và phạm vi

`design/site-v3/` gồm 9 trang HTML, `styles.css` và `script.js` (đọc toàn bộ ngày 2026-10-07). Theo yêu cầu của bạn:

| File thiết kế | Route của site | Lấy gì |
|---|---|---|
| `index.html` | `/` | Layout **và** nội dung |
| `shop.html` | `/shop` (**mới**) | Layout và nội dung; sản phẩm vẫn đọc từ Sapo |
| `collection.html` | `/collections/<handle>` (**mới**) | Layout và nội dung; xem câu 7 |
| `about.html` | `/ve-chung-toi` | Layout và nội dung |
| `contact.html` | `/lien-he` | Layout và nội dung; xem câu 4 |
| `policy.html` | `/chinh-sach/*` | Layout và nội dung; xem câu 3 |
| `blogs.html` | `/blog` | Layout và nội dung; bài viết vẫn đọc từ Sanity |
| `product.html` | `/products/[handle]` | **Chỉ style.** Giữ nguyên nội dung đang có trên production (Sapo + Sanity) |
| `article.html` | `/blog/[slug]` | **Chỉ style.** Giữ nguyên nội dung bài viết trên Sanity |

Khung chung (thanh thông báo, header dạng capsule, menu, footer) áp cho **mọi** trang, kể cả `/checkout`, `/success`,
`/tra-cuu-don`. Ba trang này chỉ đổi khung, không đổi form hay luồng tiền.

**Không đụng đường tiền.** Không file nào trong danh sách money path của `CLAUDE.md` bị sửa, trừ khi bạn chọn đổi ngưỡng
freeship ở câu 2.

## Đã đối chiếu: những gì khớp sẵn

- **Token gần như trùng với lớp hiện tại** (T6, `app/globals.css`): nền `#f3f0ec`, mực `#0b1012`, nút `#f1a400`, chữ trên
  nút là mực, đường kẻ 22%, Manrope 400/500, bo góc 4/6. Không cần thêm lớp màu thứ hai. Phần thiếu là thang khoảng cách
  (`--s-8` … `--s-96`, `--gutter`), sẽ được thêm vào `@theme`.
- Thông tin doanh nghiệp ở footer khớp `lib/business.ts` (MST, địa chỉ, hotline, giờ, email, mạng xã hội). Footer sẽ tiếp tục
  đọc từ đó, không gõ lại.
- Menu dùng `<details>`, marquee chỉ dùng CSS (có `prefers-reduced-motion`). Cả hai không cần thư viện.

## Chỗ thiết kế mâu thuẫn với code hoặc quy tắc đang có

Đây là lý do kế hoạch có mục "Cần bạn chốt". Thiết kế lấy nguyên chữ từ thehourtea.com, nên mang theo vài câu không còn
đúng với shop này.

1. **"FREESHIP ĐƠN TỪ 489K"**, trong khi ngưỡng thật là 500.000₫ (`FREE_SHIPPING_THRESHOLD_VND`, `lib/shipping.ts`). Mục
   "Banner 489k vs 500k" trong doc tiến độ đã được sửa và tick ngày 06/10 bằng cách cho banner đọc hằng số này.
2. **Câu về sức khỏe và FDA.** Trang chủ có "Ngừa ung thư", "Chống lão hóa". Trang about có "giúp cơ thể giảm cân, ngừa ung
   thư, chống lão hoá", "đạt chuẩn được FDA… phê duyệt và chứng nhận", "an toàn tuyệt đối". `/ve-chung-toi` hiện **cố ý bỏ**
   các câu này (`CLAUDE.md`), và mục 6 "Cần sửa ngay" vẫn đang chờ chủ shop duyệt.
3. **Trang chính sách** ghi Zalopay/VISA và COD. Shop này chỉ nhận VNPAY, COD đã tắt. `lib/policies.ts` đã sửa đúng ngày
   06/10, có 4 trang riêng. Thiết kế gộp thành một trang "Terms of Service".
4. **Form liên hệ và form nhận tin ở footer.** Repo hiện cố ý **không** có form vì chưa chọn hộp thư nhận (`CLAUDE.md`). Chưa
   có dịch vụ nhận tin (newsletter).
5. **Link ra thehourtea.com**: Search, Cart, `/collections/tea-by-hour`, 3 trang chính sách, nút "Tải thêm", "Tiếp theo",
   link sản phẩm trên PDP. Tất cả phải đổi sang route nội bộ hoặc bỏ. Site này không có trang tìm kiếm.
6. **"ĐĂNG KÝ BỘ CÔNG THƯƠNG"** trỏ tới hồ sơ trên online.gov.vn. Hồ sơ này đăng ký theo **tên miền**, nên chỉ đúng nếu
   tên miền chạy site mới là tên miền đã đăng ký.
7. **Ảnh**: mọi ảnh trong thiết kế là ô xám (`.ph`): nền hero, "New Season" 3:4, khuyến mãi 2:3, 3 ảnh "Ủng hộ nghệ nhân",
   ảnh bìa lợi ích 16:9, logo đối tác, ảnh khách, chân dung người sáng lập 600:700. Nội dung chữ đã thật, ảnh thì chưa.
8. **Dark mode**: `styles.css` có bảng màu tối. Repo đã quyết định **không** có dark mode (`CLAUDE.md`, T6).
9. **"Chuyện của Trà"** trong menu trỏ cùng trang với "Chuyện của The Hour". Chưa có trang riêng.
10. **Đánh giá khách hàng** ("Based on 18 reviews" trên PDP, mục "Lan tỏa tình yêu trà" trên trang chủ): không có nguồn dữ
    liệu. PDP chỉ lấy style nên phần này không làm. Trang chủ có một câu trích dẫn cố định của khách.

## Cần bạn chốt (kèm khuyến nghị)

1. **Câu sức khỏe/FDA (mâu thuẫn 2).** *Khuyến nghị:* dựng đủ layout và mọi câu khác, nhưng **chưa hiện** các câu sức
   khỏe/FDA. Chúng nằm trong một danh sách riêng trong code, bật lên bằng một dòng khi chủ shop xác nhận có giấy tờ. Câu này
   gộp luôn vào mục 6 của doc tiến độ.
2. **Ngưỡng freeship.** *Khuyến nghị:* banner đọc từ `lib/shipping.ts` (hiện ghi "500K"), không gõ "489K". Nếu shop muốn
   489.000₫ thật thì đổi hằng số. Đó là thay đổi đường tiền, có test và review riêng.
3. **Chính sách.** *Khuyến nghị:* giữ 4 trang `/chinh-sach/*` và chữ đã sửa trong `lib/policies.ts`, chỉ áp layout
   `policy.html`. Không dùng chữ Zalopay/COD của thiết kế. Footer trỏ vào 4 trang nội bộ.
4. **Form liên hệ.** *Khuyến nghị:* dựng form, gửi qua Resend (đã có trong `lib/alert.ts`) tới một hộp thư chủ shop chọn,
   có giới hạn tốc độ. Chưa có hộp thư thì form không hiện, trang chỉ hiện thông tin liên hệ như bây giờ. **Form nhận tin**
   ở footer: chưa dựng, cho tới khi chọn dịch vụ.
5. **Sản phẩm "bán chạy" trên trang chủ.** Sapo không cho thứ tự bán chạy. *Khuyến nghị:* chủ shop chọn 4 sản phẩm (danh
   sách id trong một file cấu hình). Nếu chưa chọn thì lấy 4 sản phẩm còn hàng đầu tiên.
6. **Sản phẩm test** (TEST Size Picker, Test Product 1–4). *Khuyến nghị:* ẩn khỏi `/`, `/shop`, sitemap; trang của chúng có
   `noindex`, vẫn mở được bằng link trực tiếp để mua thử. Việc này đóng luôn mục 3 và 4 trong "Cần sửa ngay". Nếu không ẩn,
   trang chủ mới sẽ đưa sản phẩm test lên mục "bán chạy".
7. **Trang collection** ("newtea2026", "tea-by-hour"). Cần đọc collection từ Sapo, nhưng endpoint collection **chưa được
   kiểm** trên store này (quy tắc 7: không đoán endpoint). *Khuyến nghị:* làm sau cùng (T12.6). Bước đầu là kiểm chỉ đọc
   endpoint. Trong lúc chờ, hai nút trên trang chủ trỏ tới `/shop`.
8. **Ảnh.** *Khuyến nghị:* chủ shop gửi ảnh vào `design/site-v3/images/`, tôi đưa vào `public/` qua `next/image`. Thiếu ảnh
   nào thì giữ ô màu như thiết kế. Đưa ảnh trang chủ vào Sanity để chủ shop tự thay là bước sau, không nằm trong T12.
9. **Dark mode.** *Khuyến nghị:* **không làm**, giữ quyết định cũ. Ảnh sản phẩm và khối CMS chưa được kiểm tương phản trên
   nền tối.
10. **"Chuyện của Trà".** *Khuyến nghị:* trỏ tới mục "Sản phẩm The Hour" trên `/ve-chung-toi` (`#san-pham`) cho tới khi có
    trang riêng.
11. **Bộ Công Thương.** *Khuyến nghị:* chưa hiện link cho tới khi chủ shop xác nhận hồ sơ đăng ký đúng tên miền của site mới.
12. **Tiếng Anh trên trang liên hệ** ("Let's Talk", "Contact information", "Send Message"). *Khuyến nghị:* giữ như thiết kế,
    vì đây là chữ của chủ shop. Có thể đổi sang tiếng Việt sau.

## Ai làm gì

| Việc | Ai |
|---|---|
| Trả lời 12 câu trên (trả lời "theo khuyến nghị" là đủ) | Bạn / chủ shop |
| Gửi ảnh (câu 8), danh sách 4 sản phẩm bán chạy (câu 5), hộp thư nhận form (câu 4) | Chủ shop, gửi lúc nào cũng được; thiếu thì site vẫn chạy với ô màu / mặc định |
| Xác nhận giấy tờ cho câu sức khỏe/FDA, hồ sơ Bộ Công Thương | Chủ shop |
| Code, kiểm, review, tài liệu | Claude |

## Các bước (mỗi bước một PR, thứ tự đề xuất)

| ID | Việc | File chính | Kiểm chứng |
|---|---|---|---|
| T12.1 | **Khung chung**: thêm thang khoảng cách vào `@theme`; thanh thông báo; header capsule (đè lên hero ở `/`, kiểu `inner` ở trang khác); menu `<details>` đóng bằng Esc; giỏ hàng giữ `CartMenu`; footer mới đọc `lib/business.ts` + link nội bộ (gồm `/tra-cuu-don`) | `app/layout.tsx`, `app/globals.css`, `components/SiteHeader.tsx`, `components/SiteFooter.tsx` (mới) | Ảnh chụp 390/1440px so với file thiết kế; không cuộn ngang; menu dùng được bằng bàn phím; `/checkout` vẫn thanh toán được (chỉ GET, không tạo đơn) |
| T12.2 | **Trang chủ mới + `/shop`**: hero, marquee, "New Season", bán chạy (câu 5), khuyến mãi, "Ủng hộ nghệ nhân", lợi ích (câu 1), đối tác (ẩn khi chưa có logo), trích dẫn khách, "Nhâm nhi và đọc" (2 bài mới nhất từ Sanity). Lưới sản phẩm hiện tại chuyển sang `/shop`. Ẩn sản phẩm test (câu 6). Sitemap thêm `/shop` | `app/page.tsx`, `app/shop/page.tsx` (mới), `lib/catalog.ts` (chỉ danh sách hiển thị, **không** đổi `isSellable` hay `getVariantIndex`), `app/sitemap.ts`, `lib/home.ts` (mới, chữ trang chủ) | Như trên + `/api/catalog` không đổi; sitemap không còn sản phẩm test; giỏ cũ chứa sản phẩm test vẫn thanh toán được |
| T12.3 | **About, Liên hệ, Chính sách**: `/ve-chung-toi` theo `about.html` (câu 1); `/lien-he` theo `contact.html` (câu 4, 12); `/chinh-sach/*` áp layout `policy.html` (câu 3) | `app/ve-chung-toi/page.tsx`, `app/lien-he/page.tsx`, `components/PolicyBody.tsx`, `lib/business.ts` | Ảnh chụp; chữ khớp file thiết kế trừ các câu đã chốt giữ lại |
| T12.4 | **Blog**: `/blog` theo `blogs.html` (ngày dạng "28 tháng 9, 2025"); `/blog/[slug]` áp style `article.html`, thêm "Các bài viết liên quan" (bài khác mới nhất). Nội dung bài giữ nguyên | `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `components/blocks/RichText.tsx` (style `.prose`) | Ảnh chụp; số lượt gọi Sanity không tăng theo lượt xem (4 quy tắc gói Free) |
| T12.5 | **PDP**: áp style `product.html` (cột ảnh/thông tin, nút size, nút mua, `.prose`, `.specs`, `.faq`). Thêm "Mua ngay" = thêm vào giỏ rồi sang `/checkout`. Nội dung, giá, tồn kho, bộ chọn size giữ nguyên. **Không** làm phần đánh giá | `app/products/[handle]/page.tsx`, `components/AddToCartForm.tsx`, `components/blocks/*` (chỉ class) | Ảnh chụp sản phẩm 1 size và sản phẩm nhiều size; `/api/quote` cho giỏ thêm từ "Mua ngay" đúng tiền |
| T12.6 | **Collection** (câu 7): kiểm chỉ đọc endpoint collection của Sapo, ghi kết quả vào `CLAUDE.md`, rồi mới dựng `/collections/<handle>` | `lib/sapo.ts` hoặc `lib/catalog.ts`, `app/collections/[handle]/page.tsx` (mới) | Endpoint trả đúng sản phẩm của "newtea2026"; handle lạ → 404 |

Mỗi bước: `npm test`, `typecheck`, `lint`, `build`; ảnh chụp trình duyệt ở 390px và 1440px; `reviewer` trước khi commit;
`doc-writer` cập nhật `CLAUDE.md` (bảng route/file, mục "Storefront UI"). Không push khi bạn chưa nói rõ (push `main` = deploy).

## Rủi ro đã biết

- **Trang chủ đổi vai trò.** Hiện `/` là lưới sản phẩm, sau T12.2 thành trang giới thiệu. Ai đã lưu link `/` để mua sẽ
  phải bấm thêm một lần. Link sản phẩm `/products/...` không đổi.
- **Cache CMS.** T12.4 không đổi `BLOCKS_PROJECTION`. Nếu phải đổi thì cần gọi revalidate ngay sau deploy (bài học
  2026-10-02 trong `CLAUDE.md`).
- **Header đè lên hero** chỉ đọc được khi hero có ảnh tối hoặc lớp phủ. Thiết kế có lớp phủ (`.hero-scrim`) và sẽ giữ.

**Cổng (đã qua, ghi lại để lưu vết): không viết code cho tới khi bạn trả lời các câu trên và nói bắt đầu. Cổng còn lại: không commit/push (push `main` = deploy) khi bạn chưa nói rõ.**
