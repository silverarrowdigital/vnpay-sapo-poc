# T9 — Chọn biến thể (Size) cho sản phẩm

**Trạng thái: CHỜ XÁC NHẬN — chưa có dòng code nào.** Tài liệu này là kế hoạch; việc viết code chỉ bắt đầu
sau khi chủ shop trả lời các câu ở mục "Cần bạn chốt" và nhắn "bắt đầu".

**Phạm vi:** cho phép một sản phẩm có nhiều lựa chọn (ví dụ `95g ~ 32 Servings`, `200g ~ 66 Servings`,
…), mỗi lựa chọn có giá, tồn kho, SKU riêng. Sản phẩm không có lựa chọn thì chạy y như bây giờ.
Không đụng thanh toán, VNPAY, Redis, Sanity.

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
2. **Giá vẫn do server quyết, và đã đúng theo từng variant.** Giỏ hàng chỉ giữ `{variantId, quantity}` và
   `/api/checkout` định giá lại từ Sapo — nên không cần đổi luật, chỉ cần chỉ mục ở điểm 1 chứa đủ variant.
3. **Combo vẫn bị loại, theo từng variant** (`isSellable`). Một sản phẩm có 4 variant mà 1 cái là combo thì
   3 cái còn lại vẫn bán được.
4. **Giỏ hàng cũ vẫn hợp lệ.** Nó lưu `variantId` của variant đầu, và variant đó vẫn tồn tại. Không migrate gì.
5. **Nhãn size phải đi theo suốt đường mua.** Ngăn kéo giỏ, trang thanh toán, trang kết quả, phiếu tra cứu đơn
   đều phải ghi *"Trà Bá Tước — 200g ~ 66 Servings"*, không chỉ tên sản phẩm. Bản ghi đơn trong Redis thêm một
   trường **tuỳ chọn** `variantLabel` (bản ghi cũ không có thì đọc như cũ — cùng kỷ luật với mọi thay đổi
   `PendingOrder` trước đây).
6. **Mã trong URL.** `/products/<alias>?Size=…` chọn size. Đường dẫn dạng `/products/<variantId>` (hiện vẫn
   chạy) sẽ chọn sẵn đúng variant đó thay vì variant đầu.
7. **Hết hàng theo từng size.** Nút size hết hàng bị làm mờ và không chọn được; sản phẩm chỉ "hết hàng" ở
   danh sách khi **tất cả** size hết.
8. **Trang danh sách.** Hiện `Từ ₫248,000` khi giá các size khác nhau, hiện giá thường khi chỉ có một giá.

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
| **P1** | **Đọc dữ liệu.** `lib/sapo.ts` đọc mọi variant; `lib/catalog.ts` dựng danh mục *hiển thị* (sản phẩm → nhiều variant) và chỉ mục *tính tiền* (phẳng). **Chưa đổi giao diện.** Bài kiểm: 6 sản phẩm hiện tại cho ra kết quả **y hệt** trước khi sửa | 0,5 ngày | B0 |
| **P2** | **Giao diện chọn size.** Hàng nút size dạng link trên trang sản phẩm, giá/tồn/ảnh theo size, `Từ ₫…` ở danh sách, trạng thái hết hàng theo size, đọc `?Size=` | 0,5 ngày | P1, B1 |
| **P3** | **Nhãn size đi suốt đường mua**: ngăn kéo giỏ, thanh toán, `/success`, tra cứu đơn, phiếu in, `variantLabel` trong bản ghi đơn | 0,5 ngày | P2 |
| **P4** | **Tài liệu**: `CLAUDE.md` (bỏ giới hạn "một variant"), hướng dẫn chủ shop `docs/huong-dan-them-san-pham.md` thêm mục tạo size, ghi lại những gì đã kiểm | 2 giờ | P3 |

Tổng: khoảng **1,5–2 ngày**, trong đó phần phụ thuộc bạn là B0 và B1 (khoảng 35 phút).

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
2. **Mua đúng size:** `/api/quote` với từng `variantId` của sản phẩm thử trả đúng giá của *variant đó*.
3. **Biến thể không tồn tại / của sản phẩm đã ẩn:** `/api/checkout` trả **409**.
4. **Size hết hàng:** trả 409, và nút tương ứng bị mờ trên trang.
5. **Hai size cùng sản phẩm trong một giỏ:** thành **hai dòng**, mỗi dòng đúng giá.
6. **Giỏ cũ** (chỉ có variant đầu): vẫn thanh toán bình thường.
7. **`?Size=` sai chữ:** rơi về size mặc định, không 404.
8. **Combo trong sản phẩm nhiều variant:** chỉ combo bị loại.
9. **Một đơn COD thật, 1 sản phẩm thử, 1 size** — duy nhất bước tạo đơn thật; kiểm tồn kho **đúng size đó**
   giảm 1 và các size khác không đổi, rồi xoá đơn. Bước này trừ kho thật (xoá đơn không hoàn kho) và chỉ làm
   **trên sản phẩm thử của B1**, sau khi bạn đồng ý.

## Rủi ro

1. **Thiếu chỉ mục phẳng → mua size thứ hai bị 409.** Là lỗi chặn bán hàng, không phải lỗi tiền. Bài kiểm
   số 2 chặn nó.
2. **Hai bộ đếm tồn kho của gói nhiều hộp trôi lệch.** Rủi ro kinh doanh ở trên, không phải lỗi code.
3. **Sản phẩm thêm variant ngoài ý muốn** sẽ tự hiện bộ chọn. Đó là chủ ý (bật/tắt bằng dữ liệu), nhưng đáng
   biết khi chỉnh sản phẩm trong Sapo.
4. **Chưa có variant thật để thử trên store này** — mọi kiểm nghiệm đều phụ thuộc B1.
