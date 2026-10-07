# T13 — Xử lý các mục còn mở trong doc tiến độ (kế hoạch ngày 2026-10-07)

**Trạng thái (2026-10-07, cuối ngày): T13.0, .2–.6, .8, .9 đã commit (0ad5ad7) và deploy; .1 đã chạy (trừ bước đóng đơn trong Sapo: Sapo hết hạn test); .10 và .11 đã đo (LCP của /shop và trang sản phẩm CHƯA đạt); .12 và .13 đã xong (xem T14); .7 đã quyết định không đổi.** Chi tiết ở mục "Cập nhật cuối ngày" cuối file. Chủ shop đã chốt cả 6 câu "theo khuyến nghị". Xem mục "Kết quả" ở cuối file. (Phần bên dưới là kế hoạch gốc lúc 14:00, giữ nguyên.)

~~Trạng thái cũ: chỉ mới là kế hoạch.~~ Chờ bạn trả lời mục "Cần bạn
chốt" (nói "theo khuyến nghị" là đủ) và nói "bắt đầu T13".

**Thêm lúc 14:00: T13.0 lên đầu danh sách**, sau sự cố đơn #1039 (xem ngay dưới).

## Trả lời thẳng: không xong hết được trong hôm nay

Doc tiến độ (rev 26) còn khoảng 55 mục chưa tick. Chúng chia làm ba loại:

| Loại | Số mục (ước) | Hôm nay? |
|---|---|---|
| **A. Tôi làm được ngay**: code nhỏ hoặc kiểm chứng, không phụ thuộc ai | ~14 | **Có**, trong buổi chiều/tối, cần bạn trả tiền thử 3 lần (~5 phút) |
| **B. Chờ chủ shop hoặc bên ngoài**: quyết định, dữ liệu, tài khoản, giấy tờ | ~17 | Chủ shop có thể **gỡ chặn** hôm nay; phần code làm sau khi có |
| **C. Việc nhiều ngày**: Postgres + outbox, giữ tồn, đối soát, admin, migration Shopify | ~24 | **Không**. Hôm nay chỉ viết được kế hoạch chi tiết cho bước đầu (PR 4–6) |

Lý do C không làm được trong ngày: nó thay chỗ lưu trạng thái giao dịch (đường tiền), cần Neon được bật trên Vercel (chủ tài
khoản phải chấp nhận điều khoản Marketplace), và chính kế hoạch sprint đã ghi PR 6 phải có kế hoạch riêng trước khi code.

## Sự cố đơn #1039 (2026-10-07) — vì sao có T13.0

Một khách (bạn, thử trên production) trả 361.200₫ lúc 13:41:56. VNPAY trả trình duyệt về với mã `00` nhưng **không gửi IPN**:
log Vercel không có request nào tới `/api/vnpay/ipn` trong gần 4 phút. Trang `/success` đứng ở "đang chờ". Đơn chỉ vào
Sapo khi tôi hỏi VNPAY bằng `npm run querydr` (VNPAY xác nhận đã thu) rồi phát lại callback thật lấy từ log. Sáu phút sau,
đơn #1040 cùng định dạng mã nhận IPN sau 4 giây và vào Sapo tự động, nên cấu hình portal và mã đơn kiểu mới đều không phải
nguyên nhân. Lịch sử đơn cũ cũng có vài đơn trễ 72–477 giây, tức là VNPAY sandbox thỉnh thoảng bỏ IPN.

Khi điều đó xảy ra với khách thật, **tiền đã thu, không có đơn, không ai biết**: cảnh báo email chỉ chạy khi có IPN.

## A. Làm hôm nay (theo thứ tự)

Thời gian là **ước lượng**, chưa đo.

| ID | Việc | Mục trong doc được tick/tiến | Đường tiền? | Kiểm chứng | Ước |
|---|---|---|---|---|---|
| **T13.0** | **Tự hỏi VNPAY khi thiếu IPN.** Khi trang `/success` mở một đơn còn "đang chờ" mà VNPAY đã trả trình duyệt về với mã `00`, và đã quá 60 giây kể từ khi tạo đơn, server gọi `querydr` (chuyển logic từ `scripts/querydr.mjs` vào `lib/querydr.ts`). Chỉ khi VNPAY trả lời có chữ ký hợp lệ, `00`/`00`, đúng số tiền, đúng mã terminal, thì đơn đi qua **cùng hàm xử lý với IPN** (cùng khoá chống chạy song song, cùng chống trùng trên Sapo). Mỗi mã đơn hỏi tối đa một lần mỗi 60 giây. Không dựa vào URL trình duyệt để quyết định đã trả (xem câu 6) | "Gọi querydr theo lịch khi mất IPN" (một phần: chỉ khi có người mở `/success`) · "IPN đến sau khi hết hạn" (một phần) | **Có** | Unit test: querydr `00` → đơn được tạo đúng một lần; sai chữ ký / sai tiền / mã khác `00` → không tạo; IPN tới sau đó → `02`. Trên production: một đơn sandbox thật, xem log có `querydr` hoặc `ipn` tạo đơn, không bao giờ cả hai | 2h |
| T13.1 | **Ba lần trả tiền thử trên sandbox** (bạn nhập thẻ test, tôi lo phần còn lại): (a) một đơn qua **production** với mã mới; (b) một lần bấm **hủy** ở trang VNPAY; (c) một đơn rồi **hoàn tiền** bằng `npm run refund -- <ref> --confirm`. Đơn thử xoá sau | Cần sửa ngay #2 (tick) · V1 hủy và hoàn (xong) · "Hoàn tiền: tổng hoàn không vượt khoản thu" (một phần) | Không đổi code | Đơn Sapo, IPN `00`/`24`, mã phản hồi refund của VNPAY, `querydr` sau hoàn | 45' |
| T13.2 | **Chống trùng đơn đã đóng**: `findOrderByTxnRef` hỏi Sapo cả `open`, `closed`, `cancelled` (song song), thay vì chỉ đơn mở | "Tra trùng đơn chỉ thấy đơn đang mở" | **Có** | Unit test; trên store thật: đóng một đơn thử rồi phát lại IPN → `02`, không ra đơn thứ hai | 1h |
| T13.3 | **Mô phỏng timeout sau khi tạo đơn**: test cho `createOrderOnce` — lần POST thành công nhưng mất phản hồi, lần thử lại tìm thấy theo tag và không POST lần hai | "Mô phỏng timeout sau khi tạo đơn" (một phần: bằng unit test, chưa trên Sapo thật) | **Có** (chỉ thêm test) | Unit test + kiểm "cố ý làm sai thì đỏ" | 30' |
| T13.4 | **Idempotency key cho checkout**: form sinh một khoá cho mỗi lần mở trang thanh toán; server nhớ khoá → mã đơn 15 phút, bấm lại trả đúng URL cũ thay vì tạo đơn chờ mới | "Idempotency key cho checkout" | **Có** | Unit test; hai POST cùng khoá → cùng `txnRef` (đơn chờ, không tạo đơn Sapo) | 1h30 |
| T13.5 | **Bản ghi đơn chờ sống 7 ngày** thay vì 24 giờ (`ORDER_TTL_SECONDS`) | "IPN đến sau khi bản ghi hết hạn" (một phần; cảnh báo email đã có nhưng chưa gửi thử) | **Có** | Unit test TTL | 15' |
| T13.6 | **Giới hạn tốc độ cho `/api/quote`** luôn bật (hiện chỉ khi có mã giảm giá). IPN **không** giới hạn (xem câu 2) | "Rate limit cho quote, IPN và tra cứu đơn" | **Có** (`app/api/quote/`) | curl: quá giới hạn → 429 | 30' |
| T13.7 | **Bỏ IP và user agent khỏi log IPN** | "Che thông tin cá nhân trong log" (một phần) | **Có** (`app/api/vnpay/`) | Đọc log sau một IPN giả | 15' |
| T13.8 | **Trạng thái giao hàng trên trang tra cứu đơn**: hiện `fulfillment_status` Sapo đã trả về nhưng chưa vẽ | "Đồng bộ trạng thái giao vận về trang tra cứu" (một phần: đọc trực tiếp, chưa có mã vận đơn) | Không | Tra một đơn thử | 30' |
| T13.9 | **Product structured data** (JSON-LD: tên, ảnh, giá, còn hàng) trên trang sản phẩm (xem câu 1) | "Canonical, Open Graph và Product structured data" (tick) | Không | Đọc HTML production; thử bằng Rich Results Test | 45' |
| T13.10 | **Kiểm layout điện thoại** bằng giả lập thiết bị qua Chrome DevTools Protocol (Node 24 có sẵn WebSocket, không thêm thư viện); sửa chỗ tràn ngang nếu có | "Kiểm layout điện thoại 390px" (tick) | Không | Ảnh chụp 390px mọi trang, đo `scrollWidth` | 1h |
| T13.11 | **Đo Core Web Vitals** trên production bằng Lighthouse chế độ điện thoại (`npx lighthouse`, không thêm vào repo) | "Đo Core Web Vitals" (tick nếu đạt, nếu không thì ghi số và việc cần sửa) | Không | Số LCP/CLS/TBT của trang chủ, `/shop`, trang sản phẩm | 30' |
| T13.12 | **Hạn mức API Sapo**: đọc header giới hạn lượt gọi trong một request chỉ đọc | "Xác nhận gói Sapo, quyền API và hạn mức" (một phần: gói là của chủ shop) | Không | Ghi số đo vào `CLAUDE.md` | 15' |
| T13.13 | **Kế hoạch chi tiết PR 4–6** (Postgres, ghi song song, IPN + outbox) để làm từ ngày mai | Chuẩn bị cho nhóm C | Không | File `docs/plan/T14-…` | 1h |

Mỗi bước: `npm test`, `typecheck`, `lint`, `build`; `reviewer` cho mọi bước có "Đường tiền: Có"; tick doc chỉ khi có bằng
chứng chạy thật, kèm comment commit + cách kiểm. **Push = deploy production**: tôi gom lại và hỏi bạn một lần trước khi push.

## B. Việc của chủ shop — làm hôm nay để gỡ chặn

| Việc | Gỡ chặn cho |
|---|---|
| Vào Vercel → Marketplace, chấp nhận điều khoản **Resend** và **Neon** (chỉ chủ tài khoản làm được) | Email cảnh báo (PR 3), email xác nhận đơn, form liên hệ, toàn bộ nhóm C |
| Chọn email nhận cảnh báo và hộp thư nhận form liên hệ | PR 3, form liên hệ |
| Sửa dữ liệu Hồng Trà Shan Tuyết trong Sapo/Sanity; duyệt câu sức khỏe ("vi nhựa") và các câu thiết kế | Cần sửa ngay #5, #6 |
| Trả lời câu địa chỉ (giữ bảng Sapo hay đổi) và cho số phí giao theo vùng | Cần sửa ngay #1, "Bảng phí theo vùng", "Danh mục địa chỉ mới" |
| Thêm sản phẩm thật, ảnh thật, chọn 4 sản phẩm bán chạy; tạo collection nếu muốn trang collection | Trang chủ, `/shop`, trang collection |
| Đặt **giá 0** cho một size của sản phẩm test trong 5 phút để tôi kiểm (rồi trả lại giá) | "Ẩn variant chưa có giá" |
| Nộp **hồ sơ merchant VNPAY production** (việc giấy tờ, mất nhiều ngày phía VNPAY) | Đi production thật |
| Cho biết gói Sapo; kiểm kê app/email/review/voucher đang dùng trên Shopify | "Xác nhận gói Sapo", migration Shopify |
| Chọn công cụ đo lường (xem câu 5) | Analytics |

## C. Không làm hôm nay — thứ tự cho những ngày sau

0. **Phần còn lại của T13.0:** đơn mà khách đóng tab trước khi `/success` kịp hỏi thì vẫn chỉ được cứu khi có job chạy định kỳ.
   Gói Hobby chỉ cho cron một lần/ngày, nên job này đi qua QStash (đã có biến môi trường) — làm cùng PR 7.
1. PR 4–6: Postgres + Drizzle, checkout ghi `Order`/`PaymentAttempt`, IPN ghi DB + outbox rồi mới trả lời; worker qua
   QStash (gói Hobby chỉ cho cron một lần/ngày). Kéo theo: tách 4 trạng thái, cảnh báo đơn paid quá 5 phút, IPN sau khi hết hạn.
2. PR 7: `querydr` theo lịch, đối soát ba nguồn.
3. PR 8–9: chống trùng bằng bảng ánh xạ; giữ tồn 15 phút, IPN đến sau khi hết giữ.
4. PR 10: tách môi trường (nhánh Neon cho mỗi preview).
5. Sau đó: thanh toán hai lần, hoàn tiền có người duyệt, admin + phân quyền + MFA + audit log, CMS preview, webhook Sapo,
   combo, quy tắc khuyến mãi đầy đủ, email xác nhận đơn, analytics, E2E, 11 kịch bản nghiệm thu, migration Shopify
   (mapping ID, redirect 301, runbook cutover).

## Cần bạn chốt (kèm khuyến nghị)

1. **JSON-LD và quy tắc bảo mật 8** ("không `dangerouslySetInnerHTML`"). JSON-LD chỉ chèn được bằng cách đó. *Khuyến nghị:*
   cho phép **một** ngoại lệ, chỉ cho dữ liệu Sapo (tên, giá, ảnh) qua `JSON.stringify` và thoát ký tự `<`; không bao giờ cho
   nội dung CMS. Ghi ngoại lệ vào `CLAUDE.md`.
2. **Giới hạn tốc độ cho IPN.** *Khuyến nghị:* **không** giới hạn. IPN đã được chặn bằng chữ ký, và chặn nhầm một lần VNPAY gửi
   lại là mất đơn đã thu tiền. Ghi lý do vào comment của mục, coi phần IPN là đã quyết.
3. **Ba lần trả tiền thử ở T13.1**, gồm một **hoàn tiền thật trên sandbox** (không hoàn tác được) và một đơn Sapo thật mỗi lần
   (xoá sau; xoá không hoàn kho). *Khuyến nghị:* đồng ý, dùng Test Product 2.
4. **Đóng một đơn thử trong Sapo** để kiểm T13.2 (một lần ghi vào store thật). *Khuyến nghị:* đồng ý, xoá đơn ngay sau.
5. **Công cụ đo lường.** *Khuyến nghị:* chưa làm hôm nay. Chủ shop chọn: Vercel Web Analytics (của chính Vercel; sự kiện
   tuỳ chỉnh như `add_to_cart` cần gói trả phí) hay Google Analytics 4 (dịch vụ ngoài, cần thông báo trong chính sách bảo mật).

6. **Quy tắc bảo mật số 2** hiện ghi "chỉ IPN có chữ ký mới quyết định đã thanh toán". T13.0 cần thêm một nguồn: câu trả lời
   `querydr` của VNPAY. *Khuyến nghị:* đồng ý, và viết lại quy tắc thành: "Đã thanh toán chỉ được quyết định bởi câu trả lời
   **máy-chủ-tới-máy-chủ có chữ ký của VNPAY** — IPN hoặc `querydr` — đã kiểm chữ ký, số tiền và mã terminal; không bao giờ bởi
   URL trình duyệt quay về." Lý do an toàn: `querydr` do server của ta gọi tới VNPAY, nên kẻ gian không giả được; câu trả lời có
   checksum riêng (9 giá trị nối bằng `|`, đã kiểm trên terminal này ngày 05/10). URL trình duyệt chỉ là lý do để **hỏi**,
   không phải bằng chứng. Phương án khác: không đổi quy tắc, chỉ gửi email cảnh báo khi `querydr` thấy đã thu tiền mà chưa có
   đơn — an toàn hơn về nguyên tắc nhưng vẫn để khách chờ tới khi có người xử lý tay.

**Cổng: không viết code cho tới khi bạn trả lời 6 câu trên (hoặc nói "theo khuyến nghị") và nói "bắt đầu T13".** (Cổng đã qua: bạn chốt cả 6 câu theo khuyến nghị.)

## Kết quả (2026-10-07)

### Quyết định đã chốt (cả 6 câu: "theo khuyến nghị")

1. JSON-LD: cho **một** ngoại lệ `dangerouslySetInnerHTML` (`components/JsonLd.tsx`), chỉ dữ liệu Sapo, thoát `<`, `>`, `&`, U+2028/2029. Quy tắc bảo mật 8 trong `CLAUDE.md` đã sửa.
2. IPN **không** giới hạn tốc độ (đã có chữ ký; chặn nhầm một lần VNPAY gửi lại là mất đơn đã thu tiền).
3. Ba lần trả tiền thử (T13.1) và 4. đóng một đơn thử để kiểm T13.2: đã đồng ý, **chưa làm** (cần deploy, và đóng đơn làm tay trong trang quản trị Sapo).
5. Công cụ đo lường: chưa làm.
6. Quy tắc bảo mật 2 viết lại: "đã thanh toán" chỉ do câu trả lời máy-chủ-tới-máy-chủ có chữ ký của VNPAY (IPN hoặc `querydr`) quyết định, đã kiểm chữ ký, terminal, mã đơn, số tiền và `vnp_TransactionType` = 01; không bao giờ do URL trình duyệt. `/success?outcome=success` chỉ là lý do để hỏi.

### Đã làm, trong working tree (chưa commit, chưa deploy)

- **T13.0** `reconcilePendingPayment` (`lib/order.ts`) + `lib/querydr.ts`. Trang `/success` hỏi VNPAY khi đơn (đang chờ/đang xử lý/lỗi Sapo, không phải COD, dưới 2 giờ) đã chờ 60 giây tính từ lúc trang hỏi LẦN ĐẦU, tối đa một lần/phút cho mỗi mã đơn. Câu trả lời phải qua kiểm chữ ký (đã đối chiếu với một câu trả lời sandbox thật: HMAC-SHA512 của ta trùng `vnp_SecureHash`), đúng terminal và mã đơn, loại 01, `00`/`00`; rồi đi qua `settlePayment` (phần thân cũ của `handleIpn`, dùng chung với IPN). Timeout 6 giây. **Giới hạn:** chỉ chạy khi có người mở `/success`; khách đóng tab trước thì chưa được cứu cho tới khi có job định kỳ (QStash, PR 7). **Chưa kiểm trên production:** chưa có khoản thanh toán thật nào đi qua đường mới.
- **T13.2** `findOrderByTxnRef` và `fetchOrderDetailByRef` hỏi Sapo cả `open`, `closed`, `cancelled` song song, và "đóng cửa khi lỗi" (một lần hỏi lỗi mà không khớp đơn nào thì báo lỗi, không trả "không có đơn"). Đo chỉ-đọc 2026-10-07: `status=closed` và `status=cancelled` trả 200 với 0 đơn (store có 22 đơn mở, chưa có đơn đã đóng/hủy), nên tham số được chấp nhận chứ không bị bỏ qua; `status=any` vẫn trả 0. **Chưa kiểm:** tìm thấy một đơn thực sự đã đóng/hủy (chưa có đơn nào; việc đóng cần endpoint chưa có trong tài liệu Sapo đã đọc, nên phải làm tay trong trang quản trị). Chi phí: 3 lượt gọi Sapo cho mỗi lần tìm, 6 cho mỗi lần tra cứu đơn; hạn mức của Sapo là 40 (`x-sapo-api-call-limit: 1/40`).
- **T13.3** Test đơn vị: POST tạo đơn mất phản hồi, lần thử lại tìm thấy theo tag và không tạo lần hai (chỉ dùng mock, chưa chạy trên Sapo thật).
- **T13.4** `startCheckoutOnce`: header `Idempotency-Key` (ngẫu nhiên mỗi lần mở trang, do `CheckoutForm` gửi). Cùng khoá và cùng nội dung form trong 2 phút, đơn còn chờ → trả lại đúng URL thanh toán cũ. Form khác cùng khoá → checkout mới. Lỗi thì nhả khoá. Hai lần bấm đồng thời → lần sau nhận 409. Lưu qua `kvGet/kvSet/kvSetIfAbsent/kvDelete` (Redis, tiền tố `vnpay-sapo:kv:`, sống 15 phút, khoá 60 giây).
- **T13.5** Bản ghi đơn chờ sống 7 ngày thay vì 24 giờ. Bản ghi đã nằm sẵn trong Redis vẫn giữ 24 giờ cho tới lần ghi kế tiếp.
- **T13.6** Giới hạn `quote`: 120 lần / 10 phút / IP cho mọi lần gọi `/api/quote`, tính trước khi gọi Sapo; giới hạn `discount` cho việc thử mã vẫn giữ. IPN không giới hạn (quyết định 2).
- **T13.7 KHÔNG đổi, có chủ ý:** `remoteIp`/`userAgent` trong log IPN là của server VNPAY, không phải dữ liệu khách, và hữu ích khi điều tra.
- **T13.8** Trang tra cứu đơn có dòng "Giao hàng" cho đơn đang mở: `null` → "Chưa giao hàng"; `fulfilled`/`partial` → nhãn tương ứng (tên theo Shopify, **chưa xác minh với Sapo**: cả 22 đơn đều là `null`); giá trị khác thì ẩn. Không có mã vận đơn (không thấy trong phản hồi nào).
- **T13.9** JSON-LD sản phẩm (`lib/jsonld.ts`, `components/JsonLd.tsx`): một mức giá → `Offer`; các size khác giá → `AggregateOffer` (thấp/cao/số lượng). `url` chỉ có khi đã đặt `APP_BASE_URL`. **Chưa thử bằng Rich Results Test của Google.**

### Kiểm tra

- 10 file test, 129 test đạt; `typecheck`, `lint`, `build` đạt. `reviewer` không thấy lỗi nghiêm trọng sau hai vòng, các mục nên sửa đã sửa.
- Thử "cố ý làm sai thì đỏ" cho các chốt của reconcile: bỏ kiểm terminal/mã đơn, và bỏ thời gian chờ, đều làm test đỏ.

### Chưa làm

- **T13.1** ba lần trả tiền thử (một đơn production với code mới, một lần hủy ở VNPAY, một lần hoàn tiền) — cần deploy và bạn nhập thẻ test.
- **T13.10** kiểm layout 390px, **T13.11** đo Core Web Vitals, **T13.13** kế hoạch Postgres (T14).
- Chưa có điều gì ở T13.0 được kiểm trên production.

### Cập nhật cuối ngày 2026-10-07 (số đo thật)

Các commit từ lần cập nhật tài liệu trước: `4dc5561`, `b77bdab`, `1a08143` (menu), `25e3d03` (kế hoạch T14 và nhãn trạng thái 11 của querydr). Các mục "Chưa làm" ở trên đã được làm như sau.

**T13.1 — ba lần trả tiền thử trên sandbox.** Chạy trên `next dev` ở máy (không phải production): VNPAY sandbox và Sapo là thật, nhưng `APP_BASE_URL` là localhost nên VNPAY không gửi được IPN, `watch:ipn` không chạy, kho đơn chờ nằm trong bộ nhớ.

- **(a) Thiếu IPN được cứu.** Đơn mã `20261007173115WXDSJYNYZ2ZWEFEC` (Test Product 2, 80.000₫): VNPAY trả `00`, không có IPN. Khoảng 5 phút sau, một lần mở `/success` (do lệnh `curl` gây ra, vì tab của khách chỉ gửi một request) đã chạy đường querydr: log `querydr.paid_without_ipn` (`ageSeconds` 588) → `sapo.order_created` → `querydr.settled`; đơn Sapo #1041, đã thanh toán, 80.000. Cùng một yêu cầu gửi hai lần với một `Idempotency-Key` trả cùng một mã đơn (log `checkout.replayed`). Như vậy T13.0 và T13.4 chạy được với VNPAY/Sapo thật, nhưng **mới ở máy, chưa trên production**.
- **(b) Hoàn tiền thật đầu tiên của repo.** `npm run refund -- <mã> --confirm`: VNPAY trả `vnp_ResponseCode 00`, "Refund success", `vnp_TransactionType 02`, `vnp_TransactionStatus 05`. Script đúng thiết kế là không ghi gì vào Sapo; đơn #1041 sau đó được xoá theo id (HTTP 200). Chạy `querydr` ngay sau đó nhận mã `94` (trùng trong khoảng thời gian của API), nên **chưa biết** querydr trả lời gì cho một giao dịch đã hoàn. Mới thử hoàn toàn bộ; hoàn một phần (`03`) chưa thử.
- **(c) Huỷ.** Đơn mã `202610071741375DM4V1VF5ZTGV9AX`: VNPAY trả mã `24`; `/success` hiện "Đã huỷ thanh toán… Không có đơn hàng nào được tạo"; Sapo có 0 đơn cho tag đó; `querydr` trả `ResponseCode 00` với `vnp_TransactionStatus 11` (đã huỷ; nhãn mới thêm vào `scripts/querydr.mjs`). Không có đơn nào được tạo.
- **Chưa làm:** kiểm một đơn thực sự đã đóng/huỷ trong Sapo có được tìm thấy bởi lần tra ba trạng thái hay không. Gói dùng thử Sapo của chủ shop đã hết hạn và chưa có endpoint đã xác minh để đóng/huỷ đơn từ đây, nên mục này vẫn dựa vào unit test và số đo `status=closed` / `status=cancelled` trả 200 với 0 đơn (không bị bỏ qua, vì danh sách không lọc có 22 đơn).
- **Trên production, chỉ đọc:** đơn #1040 (thanh toán của chính chủ shop, mã kiểu mới, IPN đến sau 4 giây) tra được bằng `POST /api/order-lookup` với đúng số điện thoại (chấp nhận mã viết thường và dạng `+84`); sai số điện thoại trả cùng một 404. `fulfillmentStatus` của đơn là undefined, hiển thị "Chưa giao hàng" cho đơn đang mở.

**T13.10 — layout điện thoại.** Giả lập điện thoại 390px qua Chrome DevTools Protocol (Chromium không giao diện, không thêm thư viện) trên 9 trang production (`/`, `/shop`, một sản phẩm, `/ve-chung-toi`, `/lien-he`, `/blog`, một trang chính sách, `/checkout`, `/tra-cuu-don`): không trang nào cuộn ngang (`scrollWidth` = 390 ở cả 9). Tìm ra một lỗi thật, sửa ở commit `1a08143`: khung menu khi mở bắt đầu giữa màn hình và tràn khoảng 100px ra mép phải; sau khi sửa, bản production build chạy ở máy không còn phần tử nào vượt mép. Mỗi trang có 9–13 link/nút nhỏ hơn 24px ở một chiều — **chưa tìm hiểu**.

**T13.11 — Lighthouse 13.5 (điện thoại, giả lập băng thông), production, 2 lần mỗi trang.**

| Trang | LCP | CLS | TBT |
|---|---|---|---|
| `/` | 1,6–2,1 s | 0 | 90–480 ms |
| `/shop` | 3,4–3,6 s | 0–0,03 | — |
| Trang sản phẩm | 3,1–3,6 s | 0 | — |

Điểm Performance 82–98. **Mục tiêu LCP ≤ 2,5 s CHƯA đạt ở `/shop` và trang sản phẩm.** INP không đo được trong phòng thí nghiệm (TBT chỉ là số thay thế). Phân tích LCP: ~250 ms đến byte đầu tiên, ~1,4 s chờ tải tài nguyên, ~0,4–0,9 s tải. Yêu cầu tải ảnh chỉ bắt đầu khi HTML (đang stream) xong, khoảng 1,67 s, vì trang phải chờ danh sách sản phẩm từ Sapo (~1,4 s) mới viết được thẻ `<img>`. Ảnh nhỏ (~40 KB, webp) nên không phải nguyên nhân. Đã thử nhưng không có tác dụng: `eager` + `fetchpriority=high` cho ảnh đầu trang (commit `b77bdab`) và `<link rel="preconnect" href="https://bizweb.dktcdn.net">` (commit `4dc5561`). Cách còn lại là lưu tạm danh sách sản phẩm Sapo cho các trang danh sách trong vài chục giây, nhưng việc đó mâu thuẫn với "giá và tồn kho không bao giờ cũ" và với "sản phẩm mới tạo trong Sapo hiện ngay ở lần tải kế tiếp". **Đây là quyết định của chủ shop, chưa chốt.**

**T13.12 — hạn mức API Sapo.** Header trả về `x-sapo-api-call-limit: 1/40` và `x-bizweb-api-call-limit` (thùng 40 lượt gọi). `GET /admin/shop.json` không trả tên gói, nên **gói Sapo vẫn chưa biết** (chủ shop nói gói dùng thử đã hết hạn).

**T13.13 — đã viết** thành `docs/plan/T14-so-giao-dich-postgres.md` (PR 4–6: schema, ghi song song, IPN + outbox + worker). Bị chặn cho tới khi chủ tài khoản Vercel bật Neon. T13.7 giữ nguyên theo quyết định.
