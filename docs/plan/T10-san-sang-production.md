# T10 — Từ bản chạy thử đến production thật

**Trạng thái (cập nhật 2026-10-06): ĐÃ LÀM LÔ ĐẦU TIÊN (commit `0bf8a50`); phần còn lại vẫn chờ duyệt.**
Lô đầu đã qua `typecheck`, `lint`, `build`, kiểm cú pháp script, và một lượt `reviewer` độc lập (không có lỗi
nghiêm trọng). **CHƯA kiểm:** các trang mới trên trình duyệt, và bất kỳ giao dịch thật nào sau các chỉnh sửa
này. Mục 3 ghi từng việc là XONG hay CÒN MỞ. Kế hoạch gốc viết 2026-10-06 sau khi quét toàn bộ
mã nguồn (giao `Explore`, đọc từng file) và đo production bằng request chỉ đọc. Mọi con số "đo" dưới đây
là đo ngày 2026-10-06; điều gì chưa kiểm thì ghi rõ là chưa kiểm.

> **Cổng:** không viết code cho T10 cho tới khi chủ shop trả lời mục "Cần bạn chốt" và nhắn "bắt đầu".
> Việc chia theo ID (`T10.1` …) để ra lệnh được như các kế hoạch trước: `làm T10.1`.

---

## 1. Ta đang ở khâu nào

**Tóm một câu:** luồng bán hàng lõi đã chạy thông từ đầu đến cuối trên **sandbox**; cửa hàng **chưa sẵn sàng
đón khách thật**, vì còn là bản thử về mặt hiển thị, pháp lý, vận hành và chưa có tài khoản VNPAY thật.

| Khâu | Tình trạng | Bằng chứng |
|---|---|---|
| Luồng lõi: sản phẩm → thanh toán VNPAY → IPN → đơn Sapo | ✅ **Chạy thật trên sandbox** | Đơn #1035 và #1036 (2026-10-06), IPN `00`, tiền khớp từng đồng, kho trừ đúng size |
| Chọn size (T9), giá theo size | ✅ Xong, đã deploy | commit `ed0ffa9`; production trả 9 variant, 4 size có nhãn |
| Giá/kho/giảm giá/phí giao tính ở server | ✅ | `quoteTotals` và `startCheckout` dùng chung một chỉ mục |
| Chống bán hàng giá 0, combo | ✅ | `isSellable` (chưa chạy với dữ liệu giá 0 thật) |
| COD | ⏸ Đã tắt (`COD_ENABLED=false`) | Mã vẫn còn, bật lại = 1 dòng + deploy |
| Blog, nội dung sản phẩm (Sanity) | ✅ Chạy production | webhook `/api/revalidate` đã kiểm |
| **Giao diện còn mang dấu PoC** | ❌ | Title "VNPAY → Sapo PoC", logo "Hour PoC", footer "Bản dựng thử nghiệm…" |
| **Link/trang pháp lý** | ❌ | `/wholesale`, `/ve-chung-toi`, `/lien-he` và 4 trang chính sách: **404** (đo trên production) |
| **Cảnh báo khi đơn kẹt** | ❌ | Không có alert, không có error tracker, không có job đối soát |
| **VNPAY thật (production)** | ❌ Chưa bắt đầu | Mọi thứ đang trỏ sandbox |
| Hạ tầng an toàn (header, robots, 404/500 đẹp) | 🟡 Một phần | Chỉ có HSTS do Vercel; không có CSP/X-Frame/nosniff; `robots.txt`, favicon: 404 |
| CI / kiểm thử tự động | ❌ | Không có `.github`, không có test |

**Chưa có gì trong số này được kiểm với tiền thật.** Hoàn tiền (refund) mới chạy dạng dry run.

---

## 2. Báo cáo chi tiết theo nhóm

Mức: **P0** = chặn go-live · **P1** = nên có trước hoặc ngay sau go-live · **P2** = làm sau.

### 2.1. Thông tin khách thấy (nhận diện)

| Việc | Hiện trạng đo được | Mức |
|---|---|---|
| Tiêu đề trang, mô tả | `<title>VNPAY → Sapo PoC</title>`, mô tả tiếng Anh "Minimal headless checkout…" trên **mọi** trang | P0 |
| Logo, footer | "Hour PoC"; footer "Bản dựng thử nghiệm — thanh toán qua VNPAY Sandbox" | P0 |
| **Banner freeship sai số** | Banner ghi "đơn từ **489k**"; ngưỡng thật trong mã là **500.000₫** (`lib/shipping.ts:29`). Khách có giỏ 489k–499k thấy lời hứa nhưng bị tính 30.000₫ | **P0** (khách thấy ngay, dễ khiếu nại) |
| Văn bản kỹ thuật lộ ra khách | `/success` in "Đơn Sapo", "IPN", `sapo_error`; trang chủ có lỗi tiếng Anh "Check SAPO_* in .env.local" | P0 |
| Ghi chú trên đơn Sapo | Cứng "Paid via VNPAY Sandbox" cho **mọi** đơn đã trả (`lib/sapo.ts:416`) — sẽ sai khi lên thật | P0 |
| Sản phẩm thử còn trong catalog | Production đang bán **Test Product 1–4** và **TEST Size Picker**; chỉ có 1 sản phẩm thật (Hồng Trà Shan Tuyết) | P0 (việc của bạn) |
| Ô "Sắp xếp theo" | Hiện như điều khiển nhưng không hoạt động | P1 |

### 2.2. Pháp lý và niềm tin (thị trường Việt Nam)

| Việc | Hiện trạng | Mức |
|---|---|---|
| Chính sách bảo mật, điều khoản, đổi trả, vận chuyển | Không có trang nào (đo: 404) | **P0** |
| Thông tin doanh nghiệp ở footer (tên, MST/ĐKKD, địa chỉ, hotline, email) | Không có | **P0** |
| Đồng ý điều khoản ở bước thanh toán | Không có ô tick | P0 |
| Link `/ve-chung-toi`, `/lien-he`, `/wholesale` | 404 (header đang trỏ vào) | P0 — tạo trang **hoặc** bỏ link |
| Nội dung pháp lý | Tôi chỉ soạn **bản nháp**; cần người có thẩm quyền duyệt. Tôi không khẳng định nội dung đã đúng luật | — |

### 2.3. Tiền và đơn hàng (rủi ro cao nhất)

| Việc | Hiện trạng | Mức |
|---|---|---|
| **Không ai biết khi đơn kẹt** | Đơn `sapo_error` / IPN không về: chỉ có 1 dòng log. Không alert. Hết 24 giờ bản ghi Redis mất. Đối soát chỉ làm tay (`npm run querydr`) | **P0** |
| **Khách đã trả mà không có đơn** | IPN đến khi bản ghi Redis đã hết hạn → trả `01`, không tạo gì. Tiền đã thu | **P0** |
| Chuyển sandbox → production | Cần `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAYMENT_URL`, **và** `VNPAY_QUERYDR_URL` (hiện chỉ đọc trong script, **không có trong `.env.example`**, mặc định về sandbox: chạy refund/querydr production sẽ đập vào sandbox) | **P0** |
| IPN URL production | Cấu hình trong **portal VNPAY**, không phải trong mã; phải đặt riêng cho tài khoản thật (GET, HMACSHA512) | P0 (việc của bạn) |
| Hoàn tiền | Chỉ có script, **chưa chạy thật lần nào** | P0: diễn tập 1 lần trước go-live |
| Email xác nhận cho khách | `SAPO_SEND_RECEIPT` mặc định tắt, chưa biết Sapo có gửi cho đơn tạo bằng API hay không → khách có thể **không nhận email nào** | P0 cần quyết định |
| `/success` lộ địa chỉ giao hàng | Ai có mã giao dịch đều xem được "Giao tới" (đường, phường, quận, tỉnh); mã = timestamp đoán được + 6 chữ số `Math.random()` (≈10⁶ khả năng); **không giới hạn tốc độ**. Không lộ tên/SĐT/email | **P0** |
| `phoneRateKey` sai | `replace(/D+/g,"")` (thiếu `\`) nên không chuẩn hoá số điện thoại. Hiện không ảnh hưởng vì COD tắt | P1 (sửa kẻo bật lại COD mới lộ) |
| IPN chậm | Có thể tới 2 lần gọi Sapo × 15 giây; không đặt `maxDuration`; chưa kiểm hạn mức VNPAY cho IPN | P1 |
| Kho không giữ chỗ | Không đặt trước tồn kho; hai người cùng mua món cuối đều thanh toán được | P2 (chấp nhận, ghi rõ) |
| Gói nhiều hộp | Kho độc lập từng size, shop tự cân | P2 (quyết định kinh doanh) |

### 2.4. Hạ tầng, bảo mật, vận hành

| Việc | Hiện trạng | Mức |
|---|---|---|
| Giám sát lỗi, uptime | Không có Sentry/Uptime/health endpoint | **P0** (tối thiểu: alert đơn kẹt + uptime) |
| Header bảo mật | Đo: chỉ có HSTS. Không CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy | P1 (CSP nên chạy chế độ báo cáo trước) |
| `robots.txt`, favicon | 404 | P1 |
| Trang 404/lỗi | Dùng trang mặc định tiếng Anh của Next; không có `error.tsx`/`global-error.tsx` | P0 (khách chạm vào ngay) |
| Sapo là điểm chết duy nhất | Mọi trang `force-dynamic`, mỗi lượt xem gọi Sapo. Bot hoặc sự cố Sapo làm sập cả cửa hàng và đốt hạn mức API. `/api/catalog`, `/api/quote` (không mã) không có giới hạn tốc độ | P1 — cần quyết định (xem 4) |
| Catalog > 250 sản phẩm | Không phân trang, bị cắt âm thầm | P2 (hiện 9 variant) |
| CI | Không có `.github`; chỉ Vercel build làm cổng | P1 |
| Dependabot / `npm audit` | Không có; `source-map-js` mức cao (có từ trước, qua Tailwind/Sanity, chỉ ảnh hưởng lúc build) | P2 |
| Redis dùng chung mọi môi trường | Tách bằng namespace; cấu hình sai `ORDER_STORE_NAMESPACE` có thể trỏ preview vào dữ liệu thật | P1 (đưa vào runbook) |
| Sao lưu | `.env.backup.*` và `backups/*.tar.gz` nằm trên laptop trong `Downloads` | P1 (chuyển chỗ an toàn) |

### 2.5. SEO và hiển thị

| Việc | Hiện trạng | Mức |
|---|---|---|
| Title template, `metadataBase`, OpenGraph, favicon | Không có (chỉ blog có OG) | P1 |
| Canonical | Không có; `?Size=` tạo URL trùng | P1 |
| JSON-LD Product (giá, còn hàng) | Không có | P1 |
| Sitemap | Có; `lastModified` luôn là "bây giờ" nên không mang ý nghĩa; `robots.txt` chưa trỏ tới | P1 |
| Ảnh sản phẩm | `<img>` thẳng từ CDN Sapo, không resize, không width/height (nhảy bố cục) | P2 |
| Skip-link, kiểm tương phản banner | Chưa có / chưa đo | P2 |

### 2.6. Pháp lý tài sản (đáng nói trước khi công khai repo)

- `app/fonts/TheHourTea*.ttf` là font thương hiệu bên thứ ba, không được dùng trong layout → kiểm giấy phép hoặc xoá.
- `design/reference/` chứa trang và ảnh chụp của thương hiệu khác ("The Hour Tea"); giao diện cũng sao chép bố cục đó. **Nếu bạn dùng thương hiệu và hình ảnh riêng thì nên thay trước khi bán thật.** Tôi chưa đánh giá pháp lý, chỉ nêu rủi ro.

---

## 3. Phân công

### Việc của bạn (chủ shop)

| # | Việc | Ghi chú | Chặn |
|---|---|---|---|
| **O1** | Đăng ký/kích hoạt **merchant VNPAY thật** → nhận TMN code + hash secret production; đặt **IPN URL** trên portal production (GET, HMACSHA512) và cho phép domain trả về | Thời gian phụ thuộc VNPAY — **tôi chưa biết**. Đây là việc dài nhất, nên bắt đầu sớm nhất | Go-live |
| **O2** | Chọn **tên miền chính thức**, trỏ vào Vercel; cung cấp để tôi đặt `APP_BASE_URL` | | Go-live |
| **O3** | Cung cấp thông tin doanh nghiệp: tên pháp nhân, MST/ĐKKD, địa chỉ, hotline, email; và **người duyệt** nội dung chính sách | Tôi soạn nháp, bạn/luật sư duyệt | Go-live |
| **O4** | Dọn Sapo: xoá hoặc ngưng bán Test Product 1–4 và TEST Size Picker; nhập sản phẩm thật với giá, SKU, tồn kho, ảnh | Variant giá 0 giờ tự bị ẩn, nhưng vẫn nên xoá hẳn | Go-live |
| **O5** | Chốt **phí giao và ngưỡng freeship thật** (đang là 30.000₫ phẳng, miễn từ 500.000₫, "con số giữ chỗ") | Tôi sửa banner theo số này | T10.1 |
| **O6** | Chốt **email xác nhận**: bật `SAPO_SEND_RECEIPT` thử một đơn thật, hay dùng dịch vụ gửi mail riêng | Gửi thử = gửi email thật cho một người | T10.4 |
| **O7** | Tạo tài khoản giám sát (Sentry/Uptime/Slack hoặc email nhận alert) | | T10.4 |
| **O8** | Quyết định thương hiệu: logo, tên, ảnh, nội dung sản phẩm thật (hiện là ảnh tạm, 7 câu về doanh nghiệp còn chờ — xem T5) | | Go-live |
| **O9** | Chuyển sao lưu `.env.backup.*`, `backups/` khỏi `Downloads` | | |
| **O10** | Chỉnh tồn kho `200g ~ 66 Servings` về 68 (đơn thử #1035/#1036 đã xoá nhưng không hoàn kho) | Đang là 66 | |

### Việc của tôi (code và tài liệu)

| ID | Việc | Mức | Qua `reviewer`? |
|---|---|---|---|
| **T10.1** | **Gỡ dấu PoC**: title/description/logo/footer/banner (banner đọc **cùng hằng** `FREE_SHIPPING_THRESHOLD_VND` để không lệch nữa); bỏ chữ kỹ thuật ở `/success` và lỗi tiếng Anh ở trang chủ; ghi chú đơn Sapo theo môi trường (không cứng "Sandbox") <br>**XONG một phần (0bf8a50, 2026-10-06):** banner đọc `FREE_SHIPPING_THRESHOLD_VND` qua `formatVnd` (trước đó cứng "489k" trong khi mã tính phí dưới 500.000); `/success` bỏ chữ Sapo/IPN/"xem log server"; ghi chú đơn Sapo là "Paid via VNPAY." (không còn "Sandbox" — nhưng chưa phân biệt theo môi trường, chỉ bỏ chữ); hai lỗi tiếng Anh ở trang chủ đã thành tin nhắn tiếng Việt. <br>**CÒN MỞ:** title, description, logo, footer — cần tên thương hiệu thật (O8) | P0 | Có (đụng `lib/sapo.ts`) |
| **T10.2** | **Trang còn thiếu**: `not-found`, `error`, `global-error` tiếng Việt; tạo `/ve-chung-toi`, `/lien-he`, 4 trang chính sách (bản nháp); bỏ hoặc làm `/wholesale`; thông tin doanh nghiệp ở footer; ô đồng ý điều khoản ở thanh toán <br>**XONG một phần:** `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` bằng tiếng Việt (chưa mở thử trên trình duyệt). <br>**CÒN MỞ:** trang về chúng tôi/liên hệ/chính sách, `/wholesale`, thông tin doanh nghiệp ở footer, ô đồng ý điều khoản — cần O3 | P0 | Không (không đụng tiền); có nếu sửa `CheckoutForm` |
| **T10.3** | **`/success` không lộ địa chỉ**: chỉ hiện địa chỉ khi có bằng chứng người xem là người mua; giới hạn tốc độ; sinh mã giao dịch bằng `crypto` <br>**XONG phần lớn:** `/success` không còn hiện "Giao tới" (địa chỉ chỉ còn ở trang tra cứu đơn, nơi phải nhập số điện thoại); trạng thái hiện bằng nhãn tiếng Việt thay vì `sapo_error`; gợi ý backend của store chỉ hiện khi `NODE_ENV !== "production"`; trạng thái `sapo_error` báo khách tải lại sau vài phút (trang không tự làm mới ở trạng thái này; VNPAY gọi lại IPN mỗi 5 phút, tối đa 10 lần, nên có thể mất 5–50 phút). `createTxnRef` dùng `crypto.randomInt` (định dạng không đổi, vẫn 6 chữ số ngẫu nhiên, nên bảo vệ thật sự là `/success` không còn lộ địa chỉ). <br>**CHƯA làm:** giới hạn tốc độ cho `/success` — **không được thêm** ở lô này | P0 | **Có** (đụng `lib/vnpay.ts`, `app/success`) |
| **T10.4** | **Cảnh báo đơn kẹt + đối soát**: gửi alert khi `sapo_error`/IPN lỗi; lưu chỉ mục các đơn đang chờ (store hiện không quét được key) để một job chạy `querydr` và báo; kéo dài TTL bản ghi đã thanh toán chưa có đơn Sapo <br>**CÒN MỞ toàn bộ** | P0 | **Có** (đụng `lib/store.ts`, `lib/order.ts`) — **việc lớn, nên vào plan mode** |
| **T10.5** | **Chuyển sandbox → production**: đưa `VNPAY_QUERYDR_URL` vào `.env.example` và cấu hình; không còn mặc định sandbox ngầm ở đường production; viết **runbook go-live** từng bước (env, portal, domain, diễn tập) <br>**XONG một phần:** `VNPAY_QUERYDR_URL` đã có trong `.env.example`; `scripts/querydr.mjs` và `scripts/refund.mjs` từ chối chạy khi `VNPAY_PAYMENT_URL` không phải host sandbox mà `VNPAY_QUERYDR_URL` chưa đặt. **LỖ HỔNG ĐÃ BIẾT (chưa sửa):** rào chỉ nhìn thấy `.env.local`; nếu chép khoá production vào đó mà không chép `VNPAY_PAYMENT_URL` production thì rào không kích hoạt. <br>**CÒN MỞ:** runbook go-live; rà soát cấu hình production | P0 | Có (đụng `lib/config.ts`) |
| **T10.6** | **Nền móng vận hành**: security headers (CSP chạy chế độ báo cáo trước), `robots.txt`, favicon, health endpoint, `maxDuration` cho IPN | P1 | Có nếu đụng `app/api/vnpay` |
| **T10.7** | **SEO**: title template, `metadataBase`, OG, canonical, JSON-LD Product, sitemap có `lastModified` thật | P1 | Không |
| **T10.8** | **Sửa lỗi nhỏ**: `phoneRateKey` (`\D`), giới hạn tốc độ cho `/api/quote` không mã và `/api/catalog`, race `INCR`/`EXPIRE` <br>**XONG một phần:** chỉ `phoneRateKey` (`/D+/` → `/\D+/`; không có tác dụng khi COD còn tắt). **CÒN MỞ:** hai giới hạn tốc độ và race `INCR`/`EXPIRE` | P1 | **Có** (đụng `lib/order.ts`, `lib/store.ts`) |
| **T10.9** | **CI**: GitHub Actions chạy typecheck + lint + build cho mỗi PR; Dependabot | P1 | Không |
| **T10.10** | **Chịu tải Sapo**: đệm ngắn cho catalog **chỉ để hiển thị** (checkout vẫn đọc Sapo trực tiếp) | P1 | **Có** — phụ thuộc quyết định ở mục 4 |
| **T10.11** | Dọn: font bên thứ ba, `design/reference/`, ảnh sản phẩm qua `next/image`, skip-link, phân trang catalog | P2 | Không |

---

## 4. Cần bạn chốt

Mỗi câu có một khuyến nghị; trả lời "theo khuyến nghị" là đủ.

**1. Có làm trang pháp lý ngay, hay bán khi chưa có?**
Khuyến nghị: **làm trước go-live** (T10.2). Cửa hàng thương mại điện tử ở Việt Nam thường phải công bố thông tin doanh nghiệp và chính sách; tôi **không** khẳng định chính xác yêu cầu luật nào áp dụng cho bạn, nên cần người có chuyên môn xác nhận.

**2. `/success`: hiện địa chỉ cho ai?**
Khuyến nghị: **chỉ hiện sản phẩm và số tiền; địa chỉ chỉ hiện sau khi nhập số điện thoại** (như trang tra cứu đơn đang làm). Rẻ nhất, và cùng một cơ chế đã có.
Lựa chọn khác: không hiện địa chỉ ở `/success` luôn.

**3. Đối soát đơn kẹt: tự động hay báo tay?**
Khuyến nghị: **alert tự động trước** (email/Slack khi `sapo_error` hoặc đơn chờ quá 30 phút), **job đối soát tự động sau** nếu thấy cần. Alert rẻ và bắt được 90% tình huống; job cần chỉ mục đơn nên tốn công hơn.

**4. Catalog có đệm ngắn không?**
Khuyến nghị: **có, 30–60 giây, chỉ cho trang hiển thị**. Lý do: hiện mỗi lượt xem gọi Sapo, một con bot hay một lần Sapo chậm là sập cửa hàng. Đánh đổi: giá/kho trên trang có thể cũ tối đa 30–60 giây; **checkout vẫn đọc trực tiếp nên không bao giờ tính sai tiền**.

**5. COD sau go-live?**
Khuyến nghị: **giữ tắt**. Bật lại cần sửa `phoneRateKey` trước (T10.8) và quyết định lại trần 3.000.000₫.

**6. Email xác nhận?**
Khuyến nghị: **thử `SAPO_SEND_RECEIPT=true` với một đơn thật gửi cho chính bạn** trước; nếu không đến, mới tính dịch vụ mail riêng.

---

## 5. Thứ tự đề xuất

1. **Song song, bắt đầu ngay:** O1 (VNPAY thật, dài nhất), O2, O3, O4, O5 (việc của bạn) — và T10.1, T10.2, T10.5 (tôi).
2. T10.3 và T10.4 (đụng tiền, qua `reviewer`) khi O6, O7 đã có.
3. T10.6–T10.9 trước hoặc ngay sau go-live.
4. **Diễn tập go-live (bắt buộc):** trên production với VNPAY thật: một đơn nhỏ thật → kiểm đơn Sapo, kho, email → **hoàn tiền thật** bằng `npm run refund` → ghi lại kết quả, kể cả điều chưa như dự kiến.
5. Go-live. Theo dõi 48 giờ đầu: log, alert, đơn kẹt.

**Ước lượng công của tôi (chỉ phần code):** P0 khoảng 3–4 ngày làm việc; P1 khoảng 2–3 ngày. Phần phụ thuộc bên ngoài (VNPAY, pháp lý) tôi **không ước lượng được**.

---

## 6. Điều chưa kiểm chứng (không được coi là sự thật)

- Tài khoản VNPAY production, hành vi IPN trên đó, hạn mức thời gian IPN của VNPAY.
- Hoàn tiền thật, và Sapo có nhận ghi hoàn tiền qua API hay không.
- Sapo có gửi email xác nhận cho đơn tạo bằng API hay không.
- Giỏ có hai size cùng lúc, và một size hết hàng cạnh các size còn hàng.
- Nhánh chặn giá ≤ 0 với dữ liệu giá 0 thật.
- Cài đặt Vercel (deployment protection, tên miền, phạm vi biến môi trường), portal VNPAY, gói/hạn mức Redis và Sanity: tôi **không có quyền đọc**; cần bạn xác nhận hoặc cài `vercel` CLI.
- HSTS trên tên miền riêng (hiện chỉ đo được trên `*.vercel.app`).
- Lô đầu của T10 (`0bf8a50`): các trang mới (`not-found`, `error`, `global-error`, `/success` sau khi sửa) chưa mở trên trình duyệt, và chưa có giao dịch thật nào sau các chỉnh sửa này.

---

## 7. So sánh với thehourtea.com (đối chiếu ngày 2026-10-06)

thehourtea.com là site của chính bạn, nơi giao diện shop này được sao chép. Số liệu dưới đây **đo ngày 2026-10-06 bằng request chỉ đọc** vào phần công khai. **Giới hạn:** chỉ thấy phần front end công khai; trang thanh toán do Shopify lưu trữ nên **chưa xem được**; `/account` trả 406 cho `curl` nên **chưa xác nhận có tồn tại**. Mục ghi "suy ra" là suy từ header Content-Security-Policy, **không phải đã thấy chạy**. Site đó chạy trên Shopify (Hydrogen/Oxygen) kết hợp Sanity, đứng sau Cloudflare.

| # | Mảng | thehourtea.com (đo được) | Dự án này | Khoảng cách / mức |
|---|---|---|---|---|
| 1 | Danh mục | Sitemap liệt kê khoảng 24 sản phẩm (15 trên `/shop`) gồm cả phụ kiện; từ 7 bộ sưu tập: `tea-by-hour`, `newtea2026`, `oolong`, `green`, `black`, `healthy-digestion`, `natural-anti-oxydants` | 1 sản phẩm thật + 4 sản phẩm thử (9 variant), không có bộ sưu tập | Lớn; phần nhập hàng là việc của bạn (O4); bộ sưu tập: T10.13 |
| 2 | Tìm kiếm | `/search?q=tra` trả 200; trang chủ khai báo `SearchAction` trong JSON-LD | Không có | T10.13 (P2) |
| 3 | Trang sản phẩm | Variant với 4 size có giá (318.000 / 408.000 / 698.000 / 1.248.000 trên một sản phẩm); đánh giá khách (7 `Review` + `AggregateRating` trong JSON-LD); JSON-LD `Product`/`Offer`/`MerchantReturnPolicy`/`OfferShippingDetails`/`BreadcrumbList`; availability `InStock` | Có variant (T9); **không** có đánh giá; **không** có JSON-LD | Đánh giá: O11; JSON-LD: T10.14 (P1) |
| 4 | Trang nội dung | `/about`, `/contact`, `/blogs` (4 bài được link ở trang chủ); menu "Chuyện của The Hour / Chuyện của Trà / Online Shop / Liên hệ / Blog". `/wholesale` trả **404 ngay trên site thật**, dù header của ta sao chép link "Wholesale" | `/about`, `/contact`, `/wholesale` đều 404; blog có | Đã nằm trong T10.2; nên bỏ link `/wholesale` thay vì làm trang |
| 5 | Pháp lý, niềm tin | 4 trang chính sách ở `/policies/{privacy-policy,refund-policy,shipping-policy,terms-of-service}`, đều 200; footer in số đăng ký/mã số thuế của công ty, ngày cấp, nơi cấp, địa chỉ đăng ký, hotline kèm giờ làm việc, email, và huy hiệu đăng ký dẫn tới online.gov.vn (thông báo với Bộ Công Thương) | Không có thứ nào trong số này | P0, đã nằm trong T10.2 + O3; huy hiệu: O12 |
| 6 | SEO | canonical, `og:title`/`og:image`, meta description, robots `index,follow`; `robots.txt` (chặn giỏ/thanh toán/tài khoản/đơn, trỏ tới sitemap); sitemap gồm sản phẩm + bộ sưu tập + trang; JSON-LD `Organization`/`WebPage`/`SearchAction` | Chỉ có sitemap (mọi `lastModified` = bây giờ); không `robots.txt`, không canonical, không OG ở sản phẩm | Đã nằm trong T10.6/T10.7 (P1) |
| 7 | Header bảo mật | CSP, `frame-ancestors 'none'`, nosniff, HSTS (max-age 1 năm) | Chỉ HSTS | Đã nằm trong T10.6 (P1) |
| 8 | Hỗ trợ, tiếp thị | Widget chat trực tiếp (tawk.to trong CSP — **suy ra**); form đăng ký nhận tin ở footer; link Facebook/Instagram/TikTok; beacon analytics của Shopify; SendGrid trong CSP (**suy ra**: mail giao dịch hoặc bản tin) | Không có | T10.15–T10.17 (P2, P1 cho email) |
| 9 | Phí giao | CSP cho phép một API distance-matrix (**suy ra**: phí theo khoảng cách; **chưa kiểm chứng**) | Phẳng 30.000₫, miễn từ 500.000₫ | Số của shop (O5) |
| 10 | Thanh toán, tài khoản | Thanh toán do Shopify lưu trữ ở subdomain `checkout.` (**chưa thấy** các phương thức); `/account` có vẻ nằm sau bộ lọc bot (**chưa xác nhận**) | Thanh toán tự làm, chỉ VNPAY, COD tắt, không tài khoản (chủ ý) | Khác kiến trúc, không phải thiếu sót |
| 11 | Đơn hàng | Shopify | Sapo (back office khác). "Ngang bằng" ở đây nghĩa là shop xử lý được đơn — với ta đã chứng minh bằng đơn #1035/#1036 trên sandbox | Không có khoảng cách đã biết |

### Kết luận

**Ngang bằng, theo những gì đã đo:** blog; chọn variant/size có giá (T9); luồng thanh toán và tạo đơn chạy thật trên sandbox. Mã giảm giá có ở ta (Sapo `price_rules`) nhưng lần đo này **không** xem được bên thehourtea.com nên không so.

**Còn thiếu mà T10 chưa có**, đề xuất thêm:

| ID | Việc | Mức |
|---|---|---|
| T10.12 | Nhập đủ catalog thật (là O4 mở rộng) và kiểm trang chủ/lưới khi có ~24 sản phẩm: phân trang, hiệu năng | P1 |
| T10.13 | Bộ sưu tập (collections) và tìm kiếm, kèm `SearchAction` | P2 |
| T10.14 | JSON-LD `Product`/`Offer` với chính sách đổi trả và vận chuyển, `BreadcrumbList`, `Organization` (gộp được với T10.7; phụ thuộc có trang chính sách) | P1 |
| T10.15 | Form nhận tin ở footer và link mạng xã hội (cần chọn dịch vụ gửi tin; link cần địa chỉ tài khoản của bạn) | P2 |
| T10.16 | Chat hỗ trợ (cần chọn dịch vụ; chú ý CSP của T10.6) | P2 |
| T10.17 | Email giao dịch của riêng shop nếu Sapo không gửi (liên quan O6, T10.4) | P1 |
| T10.18 | Analytics (cần chọn công cụ và cân nhắc đồng ý cookie) | P2 |

**Việc cần bạn quyết định** (không đặt mức ưu tiên thay bạn):

| # | Việc | Ghi chú |
|---|---|---|
| **O11** | Có đưa **đánh giá khách hàng** vào không | Cần nguồn dữ liệu (Sapo không cung cấp, chưa có schema); nội dung đánh giá là của khách thật, không tự tạo |
| **O12** | Có nộp **thông báo website thương mại điện tử với Bộ Công Thương** (huy hiệu online.gov.vn) không, và ai nộp | Thủ tục và điều kiện áp dụng cho bạn **tôi chưa kiểm chứng**; cần hỏi người có chuyên môn pháp lý. Việc này chạm tới O3 |
