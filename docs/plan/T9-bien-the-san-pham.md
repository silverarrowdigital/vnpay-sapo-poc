# T9 — Chọn biến thể (Size) cho sản phẩm

**Trạng thái (2026-10-06): ĐÃ LÀM XONG CODE, ĐÃ KIỂM BẰNG MỘT ĐƠN THẬT QUA VNPAY.** P1–P4 đã xong trong working
tree (chưa commit). Đơn thật cho size **không phải size đầu** đã chạy được (mục "Kết quả đơn thật" ngay dưới);
còn vài trường hợp chưa kiểm (mục "Việc còn mở").

**Đã chốt 2026-10-05:** chủ shop chọn **theo khuyến nghị cho cả 4 câu** ở mục "Cần bạn chốt".

### Đã làm (kiểm 2026-10-06, chỉ đọc, trên máy chạy `next dev`, dữ liệu Sapo thật)

- [x] **P1 — Đọc dữ liệu.** `fetchCatalogEntries` trả mọi variant; `lib/catalog.ts` có chỉ mục phẳng dùng chung
  (`getVariantIndex`) cho checkout và báo giá, danh mục nhóm theo sản phẩm (`getStorefrontProducts`) cho trang
  chủ/sitemap; lọc combo theo từng variant; `quoteTotals` báo lỗi 409 thay vì bỏ qua variant lạ.
- [x] **P2 — Giao diện chọn size.** Hàng nút size dạng link, `Từ ₫…` ở trang chủ, size hết hàng bị làm mờ
  và không bấm được, đọc `?Size=` / `?variant=<id>` / `/products/<variantId>`, ô "Quy cách" của Sanity ẩn khi
  sản phẩm có size.
- [x] **P3 — Nhãn size đi suốt đường mua.** Có ở ngăn kéo giỏ, thanh toán, `/success` (qua `variantLabel` tuỳ
  chọn trong bản ghi đơn) và tra cứu đơn (đọc `variant_title` của Sapo).
- [x] **P4 — Tài liệu.** `CLAUDE.md` (mục "Variants (T9)"), mục tạo size trong `docs/huong-dan-them-san-pham.md`.
- Sản phẩm thử trên Sapo (B1): "TEST Size Picker", mã `93155810`, tuỳ chọn `Size`, 4 variant. Đã kiểm: `/api/catalog`
  trả đủ 4 size có nhãn, 5 sản phẩm còn lại không nhãn; `?Size=` (cả `+` và `%20`), `?variant=<id>`,
  `/products/<variantId>` chọn đúng size; chuỗi sai và chuỗi 5000 ký tự rơi về size mặc định (200, không 404);
  `/products/nope` là 404; sitemap chỉ có sản phẩm này một lần; `/api/quote` tính đúng giá một variant, hai
  size thành hai dòng, variant `999` không có thì trả **409**. `typecheck`, `lint`, `build` đạt; `reviewer`
  không thấy lỗi nghiêm trọng.

### Kết quả đơn thật (mục 9) — đo ngày 2026-10-06

Làm **qua VNPAY sandbox, không phải COD** (COD đang tắt). Thẻ thử NCB, chạy trên `next dev` ở máy, dùng
`npm run watch:ipn` phát lại callback (`APP_BASE_URL` là localhost, không có Redis nên dùng bộ nhớ trong).
Shop đã đặt giá, SKU, tồn kho cho sản phẩm thử trước: `95g` TEST-0070 248.000 (kho 69); `200g` TEST-0071
348.000 (68); `5 x 95g` TEST-0072 458.000 (67); `10 x 95g` TEST-0073 848.000 (66). Mua **1 cái size thứ hai**
(`200g ~ 66 Servings`, variant 230451738):

- Số tiền ký gửi VNPAY: 37.800.000 = 348.000 + 30.000 phí giao = **378.000₫**. Callback `00`, IPN trả `00`,
  Sapo tạo đơn **#1035**: đã thanh toán, `total_price` 378.000, phí giao 30.000, cổng VNPAY, giao dịch
  sale/success 378.000, đủ thẻ tag.
- **Dòng hàng Sapo lưu:** `title` "TEST Size Picker" (**không** có size), `name` "TEST Size Picker - 200g ~
  66 Servings", `variant_title` "200g ~ 66 Servings", `sku` TEST-0071, giá 348.000. => Sapo **tự điền
  `variant_title`** từ `variant_id`; vì tiêu đề không chứa size nên phiếu tra cứu in "TEST Size Picker (200g ~
  66 Servings)", **không bị in size hai lần**.
- **Kho trừ đúng size:** 68 → 67 ở size này; ba size kia giữ nguyên (69, 67, 66).
- `/success` hiện đúng "… (200g ~ 66 Servings) × 1 — ₫348,000". Tra cứu đơn với đúng số điện thoại trả dòng có
  nhãn size; sai số điện thoại và mã không tồn tại cùng trả 404, cùng một câu. Không có "Default Title" ở
  trang chủ hay hai trang sản phẩm.
- Lần đầu thấy bộ chọn khi các size còn hàng: size đang chọn có `aria-current`, ô trang chủ hiện "Từ ₫248,000".
- Dọn: đã xoá đơn #1035 theo id. **Xoá đơn không hoàn kho**: size 200g vẫn ở 67, **việc của bạn: đặt lại tồn
  kho thực của size này về 68 trong Sapo.**

**Phát hiện thêm, đã sửa 2026-10-06 (rà soát trước khi push):** trước khi shop đặt giá, hai variant giá 0 vẫn
được coi là bán được. Code cũ không từ chối giá ≤ 0. Ghi chú trước đây ở đây nói "VNPAY sẽ từ chối số tiền 0"
là **sai**: số tiền ký là tiền hàng + phí ship, nên size giá 0 sẽ được thanh toán chỉ bằng phí ship (VNPAY
chấp nhận), và nếu nằm cạnh giỏ vượt mức miễn phí ship (`FREE_SHIPPING_THRESHOLD_VND`, `lib/shipping.ts`) thì
được tặng kèm miễn phí, tối đa 10 cái. **Nay `isSellable` (`lib/catalog.ts`) ẩn variant giá không > 0**, cùng
chỗ với bộ lọc combo, ghi log `catalog.unpriced_withheld`. **Chưa thử trên dữ liệu Sapo thật** (hiện không có
variant nào giá 0 và không ghi gì vào cửa hàng): chỉ mới `typecheck`, `lint` đạt và `/api/catalog` vẫn trả
đúng 9 variant có giá (2026-10-06).

### Việc còn mở — CHƯA kiểm, không được coi là đã đúng

- [ ] **Hai size của cùng sản phẩm trong MỘT giỏ, đặt đơn thật** (hai dòng). Báo giá đã đúng hai dòng, nhưng
  chưa có đơn thật nào mang hai dòng.
- [ ] **Một size hết hàng trên trang mà các size khác còn hàng.** Lần trước cả 4 hết, lần này cả 4 còn; trường
  hợp lẫn chưa được xem.
- [ ] **Variant không có SKU** (code rơi về `TEST-001`, cơ chế có từ trước). Hôm nay cả 4 variant đều có SKU
  nên chưa chạy nhánh này. Sản phẩm thật nên cho mỗi size một SKU riêng.
- Tồn tại, chưa sửa (ghi nhận từ `reviewer`, không nghiêm trọng): trang thanh toán gửi N bản mô tả cho N size;
  ô ở trang chủ ẩn giá so sánh khi các size khác giá; nhãn "A+B" và "A B" khớp nhau khi đọc `?Size=`.

**Phạm vi:** cho phép một sản phẩm có nhiều lựa chọn (ví dụ `95g ~ 32 Servings`, `200g ~ 66 Servings`,
…), mỗi lựa chọn có giá, tồn kho, SKU riêng. Sản phẩm không có lựa chọn thì chạy y như bây giờ.
Không đổi cách tính tiền, VNPAY, Redis, Sanity — **nhưng có sửa code nằm trên đường tiền**:
`lib/order.ts` (`startCheckout`, `quoteTotals`) và `lib/sapo.ts` đổi sang chỉ mục phẳng, nên `reviewer`
là **bắt buộc** (CLAUDE.md bước 6), không được bỏ qua dù thay đổi trông nhỏ.

**Đã rà soát với code ngày 2026-10-05** (đối chiếu từng giả định của bản kế hoạch đầu với mã nguồn);
những chỗ bản đầu sai hoặc thiếu đã được sửa trong tài liệu này và đánh dấu *(sửa sau rà soát)*.

---

## Trang mẫu thật sự làm gì — đọc ngày 2026-10-05

Nguồn: HTML của `thehourtea.com/products/tra-ba-tuoc-oai-huong-lavender-earl-grey-…?Size=200g+~+66+Servings`
(đọc trực tiếp, không qua bản tóm tắt — bản tóm tắt đã nói sai rằng giá không đổi theo size).

| | Trang mẫu |
|---|---|
| Số lựa chọn | **4**: `95g ~ 32 Servings` · `200g ~ 66 Servings` · `5 x 95g không hộp` · `10 x 95g không hộp` |
| Giá theo lựa chọn | **Khác nhau**: 248.000 · 348.000 · 458.000 · 848.000 ₫ (đọc từ JSON-LD `offers`) |
| Kiểu điều khiển | **Các đường link** (thẻ `<a>`), không phải JS: mỗi nút trỏ tới `?Size=<giá trị>` |
| URL phản ánh lựa chọn | Có — `?Size=95g+%7E+32+Servings`. Trang không kèm `?Size=` hiện **248.000** = lựa chọn đầu |
| Tên tuỳ chọn | `Size` (`selectedOptions: [{name:"Size", value:"…"}]`) |
| Mỗi lựa chọn mang | giá, giá so sánh, `availableForSale`, **ảnh riêng** (trường có trong dữ liệu) |
| Ảnh đổi theo size? | **Gợi ý có**: `og:image` của URL `?Size=200g` là `…_200g.jpg`. Chưa kiểm trên giao diện |
| Tồn kho hiển thị | Không có con số; chỉ có còn/hết (`InStock`) |
| Tuỳ chọn khác nhau theo sản phẩm | **Có**: một sản phẩm khác trên cùng trang (bao bì 30g) chỉ có `30g ~ 10 Servings` |

Điểm cuối chính là cơ sở của yêu cầu "tuỳ chọn có hoặc không": ngay trang mẫu cũng vậy.

## Sapo hiện có gì — đọc 2026-10-05

- **6 sản phẩm, cả 6 chỉ có 1 variant** (`option1 = "Default Title"`). Chưa có sản phẩm nào có size để thử.
- Variant mang sẵn mọi thứ ta cần: `option1/2/3`, `price`, `compare_at_price`, `inventory_quantity`
  (là số "có thể bán" — xem `CLAUDE.md`), `sku`, `image_id`, `position`.
- Đơn Sapo đã ghi `variant_title` trên từng dòng hàng (hiện là `"Default Title"`), nên khi variant có
  nhãn thật thì đơn trong Sapo tự hiện đúng nhãn.
- **Mã hiện tại chỉ lấy variant đầu theo `position`** (`firstVariant` trong `lib/sapo.ts`), nên một sản phẩm
  có 4 size sẽ chỉ bán được size đầu và hai-ba size còn lại không thể mua.
- *(sửa sau rà soát)* **Kiểu `SapoVariant` trong code chưa khai báo `option1/2/3`** (`lib/sapo.ts:30-44`) và
  `SapoCatalogEntry` không có trường nhãn. Dữ liệu có sẵn ở Sapo (đọc 2026-10-05), nhưng code chưa đọc nó:
  thêm vào kiểu là việc của P1, không phải "đã có".

---

## Nguyên tắc "tuỳ chọn" — quyết định bằng dữ liệu Sapo, không có công tắc mới

> **Sản phẩm có hơn 1 variant → hiện bộ chọn. Sản phẩm có đúng 1 variant → như hiện tại.**

Bật tính năng cho một sản phẩm = thêm variant cho nó trong Sapo. Tắt = bớt về một variant. Không có cờ
trong code, không có trường mới trong Sanity.

Lý do không đặt trong Sanity: giá và tồn kho **không bao giờ** nằm trong CMS (nguyên tắc của dự án từ đầu).
Một lựa chọn là một variant, có giá và tồn kho, nên nó thuộc về Sapo. Sanity vẫn chỉ giữ cách *trình bày*
sản phẩm và vẫn khớp theo `sapoProductId` — một sản phẩm có bao nhiêu size vẫn là **một** tài liệu nội dung.

Nhãn lựa chọn lấy từ `option1 / option2 / option3` nối bằng ` / `, nên một sản phẩm có hai chiều
(ví dụ Size và Loại) vẫn hiện được như một hàng nút phẳng, không cần giao diện riêng.

---

## Những điểm kỹ thuật quyết định đúng/sai

1. **Chỉ mục phẳng cho thanh toán — chỗ dễ sai nhất.** `/api/checkout` hiện tìm giá bằng cách dựng bảng
   `variantId → sản phẩm` từ danh mục, và danh mục mới chỉ chứa variant đầu. Nếu giữ nguyên, **mua size 200g
   sẽ bị báo "không còn bán" (409)**. Cách làm: tách hai thứ — danh mục *để hiển thị* (một sản phẩm, nhiều
   variant) và chỉ mục *để tính tiền* (phẳng, mọi variant bán được). Thanh toán, báo giá, ngăn kéo giỏ hàng
   chỉ đọc chỉ mục phẳng.
   *(sửa sau rà soát)* Hiện **không có chỉ mục nào để "giữ nguyên"**: map `variantId → sản phẩm` được dựng
   tại chỗ, hai lần riêng rẽ — `startCheckout` (`lib/order.ts:235-248`, thiếu thì 409) và `quoteTotals`
   (`lib/order.ts:418-426`). Làm thành **một hàm dùng chung** cho cả hai. Lưu ý `quoteTotals` hiện **âm thầm
   bỏ qua** variant không có trong danh mục: với nhiều size, một chỉ mục lệch sẽ cho bản báo giá **thấp hơn
   thực tế** trong khi checkout lại 409. Đổi nó thành báo lỗi, không bỏ qua.
   `getDisplayProducts()` hiện là nguồn dữ liệu duy nhất của checkout, quote, ngăn kéo giỏ, trang thanh toán,
   trang chủ và sitemap — đổi hình dạng của nó là đổi cả sáu nơi cùng lúc, nên P1 phải liệt kê và sửa đủ.
1a. *(sửa sau rà soát)* **Trùng alias.** Các variant của một sản phẩm có chung `alias`.
   `getProductByHandle` dùng `find(p => p.alias === handle)` (`lib/catalog.ts:92-99`) nên luôn trả variant đầu;
   trang chủ (`app/page.tsx:66-69`) và `app/sitemap.ts:28-34` sẽ hiện **mỗi sản phẩm nhiều lần** nếu lặp trên
   danh mục phẳng. Trang chủ, sitemap và `getProductByHandle` phải chuyển sang danh mục **hiển thị** (một
   sản phẩm → nhiều variant); chỉ checkout/quote/giỏ dùng chỉ mục phẳng.
1b. *(sửa sau rà soát)* **Chế độ `SAPO_VARIANT_ID`** (`lib/config.ts`, `lib/catalog.ts:74-121`,
   `buildOrderPayload`) dùng danh mục một mục qua `fetchCatalogEntry`. Phải giữ nguyên chạy được, và có bài
   kiểm riêng (mục 10 ở danh sách kiểm).
1c. *(sửa sau rà soát)* **`/api/catalog`** (`app/api/catalog/route.ts`) trả `{variantId, name, priceVnd,
   imageUrl, href, stock}` — không có nhãn. Ngăn kéo giỏ (`CartMenu`) và `CheckoutForm` đọc từ đây (hoặc từ
   `getDisplayProducts()` ở trang thanh toán), nên nhãn phải được thêm vào đúng hình dạng này.
2. **Giá vẫn do server quyết, và đã đúng theo từng variant.** Giỏ hàng chỉ giữ `{variantId, quantity}` và
   `/api/checkout` định giá lại từ Sapo — nên không cần đổi luật, chỉ cần chỉ mục ở điểm 1 chứa đủ variant.
3. **Combo vẫn bị loại, theo từng variant** (`isSellable`). Một sản phẩm có 4 variant mà 1 cái là combo thì
   3 cái còn lại vẫn bán được.
4. **Giỏ hàng cũ vẫn hợp lệ.** Nó lưu `variantId` của variant đầu, và variant đó vẫn tồn tại. Không migrate gì.
5. **Nhãn size phải đi theo suốt đường mua.** Ngăn kéo giỏ, trang thanh toán, trang kết quả, phiếu tra cứu đơn
   đều phải ghi *"Trà Bá Tước — 200g ~ 66 Servings"*, không chỉ tên sản phẩm. Bản ghi đơn trong Redis thêm một
   trường **tuỳ chọn** `variantLabel` (bản ghi cũ không có thì đọc như cũ — cùng kỷ luật với mọi thay đổi
   `PendingOrder` trước đây). Đã kiểm: `isPendingOrderLine` chỉ xét `sku/productName/unitPriceVnd/quantity`
   và `normaliseLines` không dựng lại từng dòng, nên trường thêm đi qua nguyên vẹn (`lib/store.ts:213-241`).
   *(sửa sau rà soát)* **`variantLabel` trong Redis chỉ phục vụ `/success`.** Phiếu tra cứu đơn và phiếu in
   **không đọc Redis** mà đọc `line_items` của Sapo (`title`/`name`, `lib/sapo.ts:526, 597-602`), và code
   chưa đọc `variant_title`. Muốn phiếu có nhãn size phải đọc `variant_title` từ Sapo (hoặc xác nhận `name`
   đã chứa nhãn) — đó là việc riêng trong P3, và phụ thuộc điều ở "Chưa kiểm chứng" bên dưới.
   Ở mọi nơi hiển thị, **nhãn rỗng khi sản phẩm chỉ có một variant** (Sapo đặt `"Default Title"`): không
   được in "Default Title" ra cho khách.
6. **Mã trong URL.** `/products/<alias>?Size=…` chọn size. Đường dẫn dạng `/products/<variantId>` (hiện vẫn
   chạy) sẽ chọn sẵn đúng variant đó thay vì variant đầu.
7. **Hết hàng theo từng size.** Nút size hết hàng bị làm mờ và không chọn được; sản phẩm chỉ "hết hàng" ở
   danh sách khi **tất cả** size hết.
8. **Trang danh sách.** Hiện `Từ ₫248,000` khi giá các size khác nhau, hiện giá thường khi chỉ có một giá.

## Chưa kiểm chứng — không được ghi như sự thật *(thêm sau rà soát)*

> **Cập nhật 2026-10-06:** hai điều dưới đây đã được kiểm bằng đơn thật #1035 — Sapo tự điền `variant_title`
> từ `variant_id`, và variant thật có nhãn đúng. Xem "Kết quả đơn thật". Giữ nguyên bên dưới để biết đã
> nghi ngờ điều gì.

- **Đơn Sapo có tự hiện nhãn size hay không.** Payload cho dòng có `variant_id` chỉ gửi
  `{variant_id, quantity, price}` (`lib/sapo.ts:326-331`) và để Sapo điền `title`/`sku`/`variant_title`.
  Bản đầu viết như thể "đơn tự hiện đúng nhãn" là chắc chắn; thực tế mới chỉ thấy `variant_title:
  "Default Title"` trên đơn của sản phẩm một variant. Phải kiểm trên đơn thử ở bước kiểm số 9.
- **Variant thật có `option1/2/3` đúng như mô tả** — chưa có sản phẩm nhiều variant nào trên store để thử
  (chờ B1).

## Một rủi ro kinh doanh phải nói trước — gói nhiều hộp

`5 x 95g không hộp` và `10 x 95g không hộp` là **variant có tồn kho riêng**. Bán một gói 5×95g **không** trừ
tồn kho của variant `95g` — hai bộ đếm độc lập, trong khi ngoài đời chúng lấy từ cùng một kho trà.

Đây cùng họ với lỗi combo ở `docs/plan/T8-combo-ton-kho.md`, nhẹ hơn (mỗi variant vẫn tự trừ đúng bộ đếm của
nó, không bị "bán mãi không giảm"), nhưng hai bộ đếm sẽ **trôi lệch** nhau nếu shop không tự cân. Tôi chưa
kiểm Sapo có tính năng quy đổi đơn vị cho trường hợp này hay không và sẽ không đoán. Đây là quyết định
kinh doanh của shop — xem câu 1 bên dưới.

---

## Phân công

### Việc của bạn

| # | Việc | Khi nào | Thời gian |
|---|---|---|---|
| B0 | Trả lời 4 câu "Cần bạn chốt" và nhắn **"bắt đầu"** | Trước tất cả | 5 phút |
| B1 | Trong trang quản trị Sapo, tạo **một sản phẩm thử** có 4 variant: tuỳ chọn tên `Size`, mỗi variant **giá khác nhau**, SKU riêng, tồn kho riêng. Đặt **một variant có tồn kho 0** (để thử "hết hàng") và nếu được, **một variant có ảnh riêng** | Trước khi tôi kiểm | 30 phút |
| B2 | Thử trên localhost theo danh sách kiểm ở mục dưới, báo lại điều gì lạ | Sau khi tôi xong P2 | 15 phút |
| B3 | Tạo size thật cho các sản phẩm thật, đặt tồn kho từng size | Sau khi mọi thứ ổn | tuỳ số sản phẩm |

Vì sao B1 do bạn mà không phải tôi: tôi chưa kiểm ứng dụng này có quyền **ghi** sản phẩm hay không, và
cũng không nên ghi vào danh mục thật chỉ để lấy dữ liệu thử. Làm bằng tay trong trang quản trị còn có
lợi: nó thử đúng thao tác mà shop sẽ làm với sản phẩm thật, kể cả những ô Sapo bắt buộc điền.

### Việc của tôi

| Pha | Việc | Ước lượng | Chặn bởi |
|---|---|---|---|
| **P1** | **Đọc dữ liệu.** `lib/sapo.ts` đọc mọi variant (thêm `option1/2/3` vào kiểu); `lib/catalog.ts` dựng danh mục *hiển thị* (sản phẩm → nhiều variant) và chỉ mục *tính tiền* (phẳng, **một hàm dùng chung** cho `startCheckout` và `quoteTotals`; quote báo lỗi thay vì bỏ qua). Chuyển trang chủ, sitemap, `getProductByHandle` sang danh mục hiển thị; giữ chế độ `SAPO_VARIANT_ID`. **Chưa đổi giao diện.** Bài kiểm: 6 sản phẩm hiện tại cho ra kết quả **y hệt** trước khi sửa. **Chạy `reviewer` trước khi commit — bắt buộc** (đụng `lib/order.ts`, `lib/sapo.ts`) | 1 ngày | B0 |
| **P2** | **Giao diện chọn size.** Hàng nút size dạng link trên trang sản phẩm, giá/tồn/ảnh theo size, `Từ ₫…` ở danh sách, trạng thái hết hàng theo size, đọc `?Size=` | 0,5 ngày | P1, B1 |
| **P3** | **Nhãn size đi suốt đường mua**: thêm nhãn vào `/api/catalog`, ngăn kéo giỏ, thanh toán, `/success`, `variantLabel` trong bản ghi đơn; phiếu tra cứu/phiếu in đọc `variant_title` từ Sapo. **Chạy `reviewer`** (đụng `lib/order.ts`, `lib/store.ts`, `lib/sapo.ts`) | 0,75 ngày | P2 |
| **P4** | **Tài liệu** (giao `doc-writer`): `CLAUDE.md` (bỏ giới hạn "một variant"), hướng dẫn chủ shop `docs/huong-dan-them-san-pham.md` thêm mục tạo size, ghi lại những gì đã kiểm | 2 giờ | P3 |

Tổng: khoảng **2–2,5 ngày** (bản đầu ghi 1,5–2; tăng vì P1 đụng nhiều nơi hơn dự tính), trong đó phần phụ
thuộc bạn là B0 và B1 (khoảng 35 phút). Mỗi pha chạy `test-runner` (typecheck, lint, build) trước khi review.

---

## Cần bạn chốt trước khi tôi viết code

Mỗi câu có một khuyến nghị; trả lời "theo khuyến nghị" là đủ.

**1. Gói nhiều hộp (`5 x 95g`, `10 x 95g không hộp`) có tồn kho riêng không?**
- *Khuyến nghị:* **tồn kho độc lập từng variant, shop tự cân** — chấp nhận rủi ro trôi lệch ở trên.
- Lựa chọn khác: ra mắt chỉ với `95g` và `200g` trước, thêm hai gói kia sau khi có cách tính tồn kho gói
  (liên quan T8). Code của tôi không phụ thuộc số lượng size, nên đây thuần là quyết định của shop.

**2. Địa chỉ của lựa chọn: `?Size=95g+~+32+Servings` (giống trang mẫu) hay `?variant=<số id>`?**
- *Khuyến nghị:* **giống trang mẫu** — dễ đọc, dễ chia sẻ; giá trị không khớp thì rơi về size mặc định
  (không báo 404).
- `?variant=<id>` bền hơn nếu sau này đổi tên size, nhưng nhìn như mã.

**3. Ô "Quy cách" trong Sanity (`servings`, ví dụ "15+ lần pha / 50g") — khi sản phẩm có size thì sao?**
- *Khuyến nghị:* **ẩn nó** trên sản phẩm có size, vì bộ chọn đã nói điều đó và dễ mâu thuẫn
  (ô ghi 50g, nút ghi 95g). Sản phẩm không có size vẫn hiện như cũ.

**4. Mở trang không có `?Size=` thì chọn sẵn size nào?**
- *Khuyến nghị:* **size đầu theo thứ tự trong Sapo (giống trang mẫu), nhưng nếu nó hết hàng thì size còn hàng
  đầu tiên** — tránh khách vào một trang mà nút mua bị khoá trong khi size bên cạnh còn hàng.

*Không cần chốt (tôi lấy mặc định ở trên):* nhãn đúng như shop gõ trong Sapo; ảnh đổi theo size nếu variant
có ảnh riêng, không thì giữ ảnh sản phẩm; danh sách hiện `Từ ₫…` khi giá khác nhau.

---

## Danh sách kiểm (dùng cho P1–P3)

Tất cả kiểm được bằng `curl` mà không tạo đơn, trừ dòng cuối.

1. **Không hồi quy:** `/api/catalog` của 6 sản phẩm hiện có giống hệt trước khi sửa.
2. **Mua đúng size:** `/api/quote` với từng `variantId` của sản phẩm thử trả đúng giá của *variant đó*, và
   `/api/checkout` (với giỏ vượt trần COD hoặc dùng bản đọc không tạo đơn) **không** trả 409 cho size thứ
   hai. *(Từ 2026-10-06 COD đang tắt: `paymentMethod: "cod"` trả 400 trước khi đọc giỏ, nên cách thử này chỉ
   còn khi bật lại `COD_ENABLED`; thay bằng `/api/quote` hoặc `paymentMethod: "vnpay"` với variant lạ → 409.)* Một variant không có trong chỉ mục thì quote phải **báo lỗi**, không trả tổng thấp hơn thực tế.
3. **Biến thể không tồn tại / của sản phẩm đã ẩn:** `/api/checkout` trả **409**.
4. **Size hết hàng:** trả 409, và nút tương ứng bị mờ trên trang.
5. **Hai size cùng sản phẩm trong một giỏ:** thành **hai dòng**, mỗi dòng đúng giá.
6. **Giỏ cũ** (chỉ có variant đầu): vẫn thanh toán bình thường.
7. **`?Size=` sai chữ:** rơi về size mặc định, không 404.
8. **Combo trong sản phẩm nhiều variant:** chỉ combo bị loại.
9. [x] **Một đơn thật, 1 sản phẩm thử, 1 size** *(viết ban đầu là COD; COD đã tắt từ 2026-10-06 nên **đã làm qua
   VNPAY** cùng ngày, đơn #1035, kết quả ở mục "Kết quả đơn thật")* — duy nhất bước tạo đơn thật; kiểm tồn kho **đúng size đó**
   giảm 1 và các size khác không đổi, **đơn trong Sapo hiện đúng nhãn size ở dòng hàng** (xác nhận giả định ở
   mục "Chưa kiểm chứng"), rồi xoá đơn. Bước này trừ kho thật (xoá đơn không hoàn kho) và chỉ làm
   **trên sản phẩm thử của B1**, sau khi bạn đồng ý, trong session chính (không phải `test-runner`).
10. *(thêm sau rà soát)* **Chế độ `SAPO_VARIANT_ID`:** đặt biến này rồi kiểm danh mục, trang sản phẩm và báo giá
    vẫn chạy như trước.
11. *(thêm sau rà soát)* **Không trùng lặp:** sản phẩm 4 size xuất hiện **một ô** ở trang chủ và **một URL** trong
    `/sitemap.xml`; `/products/<alias>` mở được, `/products/<variantId của size 2>` chọn sẵn size 2.
12. *(thêm sau rà soát)* **`?Size=` có ký tự đặc biệt** (`95g+~+32+Servings`, `95g%20~%2032%20Servings`, chuỗi
    lạ, chuỗi rất dài): khớp được hoặc rơi về size mặc định, không 404, không lỗi 500.
13. *(thêm sau rà soát)* **Sản phẩm một variant:** không hiện bộ chọn và không in "Default Title" ở bất kỳ đâu
    (trang sản phẩm, giỏ, thanh toán, `/success`, tra cứu).
14. *(thêm sau rà soát)* **Variant đầu là combo:** hiện tại cả sản phẩm biến mất; sau khi sửa, chỉ variant combo bị
    loại, các size còn lại vẫn bán được.

## Rủi ro

1. **Thiếu chỉ mục phẳng → mua size thứ hai bị 409.** Là lỗi chặn bán hàng, không phải lỗi tiền. Bài kiểm
   số 2 chặn nó.
2. **Hai bộ đếm tồn kho của gói nhiều hộp trôi lệch.** Rủi ro kinh doanh ở trên, không phải lỗi code.
3. **Sản phẩm thêm variant ngoài ý muốn** sẽ tự hiện bộ chọn. Đó là chủ ý (bật/tắt bằng dữ liệu), nhưng đáng
   biết khi chỉnh sản phẩm trong Sapo.
4. **Chưa có variant thật để thử trên store này** — mọi kiểm nghiệm đều phụ thuộc B1.
5. *(thêm sau rà soát)* **Đổi hình dạng `getDisplayProducts()` làm vỡ lặng lẽ sáu nơi dùng nó** (checkout, quote,
   `/api/catalog`, trang thanh toán, trang chủ, sitemap). Không có lỗi biên dịch nào báo hết các chỗ; phải rà
   từng nơi (đã liệt kê ở mục kỹ thuật 1, 1a, 1c) và kiểm bằng danh sách ở trên.
6. *(thêm sau rà soát)* **Chuyển thay đổi trên đường tiền mà bỏ qua `reviewer`.** Lỗi kiểu "tổng lệch một đồng" hay
   "quote thấp hơn thực tế" vẫn qua typecheck, lint và build.
