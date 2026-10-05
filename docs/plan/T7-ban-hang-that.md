# T7 — Từ bản chạy được thành cửa hàng bán thật

> **Trạng thái 2026-10-05: đã làm T7.0 → T7.3, T7.5 → T7.8.** Còn lại: T7.4 (combo cách A — việc
> trong Sapo, không cần code) và phần hoá đơn VAT của T7.7 (ngoài phạm vi dự án, xem bên dưới).
> Mọi số liệu "đã verify" dưới đây là từ API thật. Kiểm chứng cuối cùng là **đơn #1025** — một đơn
> COD thật tạo qua chính `/api/checkout`, đọc lại rồi xoá.

**Phạm vi: chỉ khâu mua–bán.** Không đụng nội dung, blog, CMS, giao diện. Mọi thứ dưới đây là về tiền, hàng, đơn và niềm tin của khách.

---

## Hiện trạng — cái gì đã thật sự chạy

Kiểm từ code và từ API thật ngày 2026-10-02, không phải từ trí nhớ.

| Có | Ghi chú |
|---|---|
| Danh mục đọc từ Sapo | Giá và tồn kho luôn đọc trực tiếp, không cache |
| Giỏ hàng nhiều dòng | `localStorage` chỉ giữ `{variantId, quantity}`; `/api/checkout` tính lại giá từ Sapo |
| **Kiểm tồn kho khi thanh toán** | Hết hàng hoặc không đủ số lượng đều trả `409` trước khi tạo link thanh toán |
| Thanh toán VNPAY | Ký HMAC-SHA512, xác minh chữ ký hai chiều |
| IPN tạo đơn Sapo | Chống trùng hai lớp, claim qua Redis, trừ tồn kho thật |
| Trang kết quả | Tự làm mới tới khi IPN về |

**Chưa có gì** về: thuế, combo, hoàn tiền. Thuế vẫn chưa có và vẫn cố ý: dự án không phát hành hoá
đơn VAT (xem T7.7).

Hai dòng trên là hiện trạng *trước* T7, giữ lại để đọc được lịch sử. Sau T7, đơn gửi sang Sapo **có**
`shipping_lines`, **có** `discount_codes`, **có** địa chỉ ba cấp, và có đường COD.

---

## Đã verify trên API thật hôm nay

Dò bằng request chỉ-đọc trên chính store. Phân biệt được "endpoint có thật nhưng thiếu quyền" với "endpoint không tồn tại":

| Endpoint | Kết quả | Nghĩa là |
|---|---|---|
| `/admin/price_rules.json` | `403` → **`200` sau khi bật quyền** | **Đây là hệ giảm giá của Sapo** |
| `/admin/discounts.json` | vẫn `403 access_denied` sau khi bật | Không cần tới — xem T7.3 |
| `/admin/shipping_zones.json` | `403 access_denied` | **Có thật**, thiếu quyền |
| `/admin/carrier_services.json` | `200` | Đã có quyền |
| `/admin/customers.json` | `200` | Đã có quyền |
| `/admin/promotions.json` · `coupons` · `vouchers` | `403 Forbidden` kiểu Spring, có echo `path` | **Không phải route** — đừng viết code gọi vào |

Khác biệt rất rõ: endpoint thật trả `{"error":"access_denied","error_description":"Access is denied"}`, còn route không tồn tại trả lỗi framework chung chung. Đây là lý do T7.0 phải đứng trước.

---

## Thiếu gì — xếp theo mức chặn

### Nhóm 1 — không có thì **không bán thật được**

| # | Thiếu | Vì sao chặn |
|---|---|---|
| 1 | **Địa chỉ không đủ để giao** | Chỉ có một ô `address1`. Không tỉnh/thành, quận/huyện, phường/xã. Không hãng vận chuyển nào nhận đơn như vậy |
| 2 | **Không có phí vận chuyển** | Trang sản phẩm đang ghi *"Phí vận chuyển được tính khi thanh toán"* — và **không có gì tính cả**. Hiện là một lời hứa sai với khách |
| 3 | **Chỉ có VNPAY** | Ở Việt Nam thiếu COD là mất một phần lớn khách |
| 4 | **Khách không nhận được gì sau khi trả tiền** | Không email, không SMS. Đóng tab là mất dấu đơn hàng |
| 5 | **Không tra cứu được đơn** | Không có trang nào để khách xem lại đơn đã đặt |

### Nhóm 2 — thương mại, đúng thứ bạn hỏi

| # | Thiếu | |
|---|---|---|
| 6 | **Mã giảm giá** | Endpoint Sapo có thật, chỉ thiếu quyền |
| 7 | **Combo** | Hai cách làm, xem T7.4 |
| 8 | **Chọn biến thể** | Hiện mỗi sản phẩm chỉ lấy variant đầu theo `position`. Bán 95g/200g là phải có |
| 9 | **Hoá đơn in được** | Xem cảnh báo pháp lý ở T7.7 |

### Nhóm 3 — vận hành và an toàn

| # | Thiếu | |
|---|---|---|
| 10 | `querydr` đối soát đơn kẹt | Đã nằm trong "Next steps" của `CLAUDE.md` |
| 11 | Hoàn tiền | Không có đường hoàn tiền nào |
| 12 | Rate limit / chống bot ở checkout | Không có gì chặn ai gọi `/api/checkout` liên tục |
| 13 | Giữ hàng khi đang thanh toán | Cố ý chưa làm; hệ quả là có thể bán âm kho |

---

## Kế hoạch đề xuất

Thứ tự đặt theo một nguyên tắc: **số tiền phải đúng trước, tiện lợi tính sau.** Một đơn giao sai địa chỉ còn cứu được; một đơn thu sai tiền thì không.

### T7.0 — Bật quyền cho Private App *(việc của bạn, chặn T7.2 và T7.3)*

Đường đi lấy từ tài liệu chính thức https://support.sapo.vn/ung-dung-rieng-private-apps, không phải đoán:

1. Trang quản trị Sapo → menu trái → **Ứng dụng**
2. Cuộn xuống dòng *"Bạn đang làm việc với nhà phát triển?"* → nhấp **Ứng dụng riêng**
3. Chọn ứng dụng đang dùng trong danh sách → mở trang chi tiết
4. Sửa cột quyền, rồi **Lưu**

Mỗi nhóm có ba mức: *Không cho phép* · *Chỉ đọc* · *Đọc và ghi*.

| Nhóm quyền | Đặt thành | Vì sao |
|---|---|---|
| **Khuyến mãi** | **Chỉ đọc** | Ta chỉ *kiểm tra* mã khách nhập, không bao giờ tạo hay sửa khuyến mãi. Cho quyền ghi là mở rộng thiệt hại nếu khoá bị lộ, mà không dùng đến |
| **Đơn hàng, giao dịch và vận chuyển** | giữ **Đọc và ghi** | Đã bật sẵn — ứng dụng đang tạo đơn được |

**API key và API secret KHÔNG đổi khi sửa quyền** (tài liệu Sapo nói rõ). Nghĩa là không phải sửa `.env.local`, không phải đổi biến trên Vercel, không phải deploy lại.

**Một điều chưa chắc, nói trước:** `discounts.json` và `price_rules.json` gần như chắc thuộc nhóm *Khuyến mãi* — bật là xong. Nhưng `shipping_zones.json` cũng trả `access_denied` **dù ứng dụng đã có quyền đơn hàng + vận chuyển**, nên nó có thể không nằm trong nhóm nào mà ứng dụng riêng với tới được. Nếu bật xong mà nó vẫn `403` thì đó không phải lỗi cấu hình, và T7.2 sẽ đi đường bảng phí phẳng thay vì đọc vùng vận chuyển từ Sapo.

**Nghiệm thu**: chạy lại script dò.

**Kết quả thật, 2026-10-02 sau khi bật *Khuyến mãi → Chỉ đọc*:**

- `/admin/price_rules.json` → **`200`**, trả `{"price_rules": []}`, `count` = 0. **Bước này xong.**
- `/admin/discounts.json` → vẫn `403 access_denied`. **Không cần**: giống mô hình Shopify, hệ giảm giá nằm ở `price_rules`, còn `discounts.json` là tài nguyên khác mà ứng dụng riêng không với tới. Đừng bật thêm quyền chỉ vì nó đỏ.
- `/admin/discount_codes.json` ở cấp gốc → không phải route (lỗi Spring có echo `path`). Mã giảm giá gần như chắc nằm **lồng dưới từng price rule**, đúng kiểu Shopify.
- `/admin/shipping_zones.json` → vẫn `403`. Đúng như đã dự liệu: **không phải lỗi cấu hình**, nên **T7.2 đi đường bảng phí phẳng**.

### T7.1 — Địa chỉ giao hàng đúng chuẩn Việt Nam

Form hiện có 4 ô. Cần thêm **tỉnh/thành · quận/huyện · phường/xã**, dạng chọn liên tầng, và gửi đúng trường của Sapo (`province`, `district`, `ward` — **phải kiểm với tài liệu Sapo trước khi viết**, luật repo là không bịa trường).

Danh sách địa giới lấy từ đâu cũng là một quyết định: nhúng tĩnh vào repo (nhanh, nhưng sẽ cũ khi sáp nhập đơn vị hành chính) hay gọi API Sapo nếu có.

**Nghiệm thu**: đặt một đơn thật, mở trong Sapo thấy đủ ba cấp địa chỉ.

**✅ XONG, verify trên đơn #1025 (2026-10-05).** Tên trường đúng là `province`/`province_code`,
`district`/`district_code`, `ward`/`ward_code` — đọc từ chính API, vì tài liệu Sapo **không** ghi
`district` và `ward` nhưng mọi đơn trên store đều trả về chúng. Đơn lưu đúng
`"ward":"Phường Bến Nghé","district":"Quận 1","province":"TP Hồ Chí Minh"` kèm ba mã. Sapo **tự điền
`city`** từ tỉnh, nên `buildOrderPayload` không gửi `city`.

Hai điều đã dự liệu và đúng: `?province_id=` trên districts và `?district_id=` trên wards **bị bỏ
qua lặng lẽ** (trả về cả bảng 723 và 11.665 dòng) nên việc lọc nằm ở code ta; và danh sách Sapo vẫn
là **63 tỉnh** kiểu cũ, chưa sáp nhập. Lấy theo Sapo là đúng — đơn chỉ có ích nếu Sapo nhận địa chỉ
đó. Bảng phường/xã nặng ~1,2 MB nên `lib/locations.ts` nhớ đệm mỗi tiến trình một giờ và
`/api/locations` không bao giờ trả cả bảng.

### T7.2 — Phí vận chuyển

Hai mức:

- **Tối thiểu**: bảng phí phẳng theo tỉnh, tự tính. Nhanh, đủ dùng, và **xoá được lời hứa sai** đang nằm trên trang sản phẩm.
- **Đầy đủ**: đọc `shipping_zones` từ Sapo để phí trên web khớp phí trong Sapo.

Dù chọn mức nào: **phí phải cộng vào số tiền gửi sang VNPAY** và gửi kèm `shipping_lines` khi tạo đơn Sapo, nếu không sổ sách sẽ lệch.

**Nghiệm thu**: tiền trên màn hình = tiền VNPAY thu = tổng đơn trong Sapo, ở ba đơn khác tỉnh nhau.

**✅ XONG — đi đường bảng phí phẳng, như đã dự liệu ở T7.0.** `lib/shipping.ts` là **client-safe** và
là chỗ duy nhất tính phí: màn hình, số ký vào URL VNPAY và `shipping_lines` gửi Sapo đều gọi đúng
một hàm, nên rủi ro số 3 ("lệch giữa ba nơi") bị đóng bằng cấu trúc chứ không bằng sự cẩn thận.

Verify trên đơn #1025: `shipping_lines` **được Sapo lưu lại** (khác `transactions`), và
`total_price` trả về **266.200** = 268.000 − 26.800 + 25.000, đúng bằng số màn hình hiện. Ba nơi
khớp.

Ba vùng phí và ngưỡng miễn phí trong `lib/shipping.ts` là **số của shop**, không phải báo giá của
hãng vận chuyển — sửa ở đó, không chỗ nào khác cần đổi. Dòng *"Phí vận chuyển được tính khi thanh
toán"* trên trang sản phẩm — lời hứa sai — đã thay bằng ngưỡng miễn phí đọc từ chính module đó.

### T7.3 — Mã giảm giá từ Sapo

**Điểm an toàn quan trọng nhất của cả T7.** Mã giảm giá phải được **kiểm tra và tính lại hoàn toàn ở server**, đúng như giá đang làm. Nhận số tiền giảm từ trình duyệt là tặng tiền cho bất kỳ ai biết mở DevTools.

Luồng: khách nhập mã → server hỏi Sapo mã có thật/còn hạn/đủ điều kiện không → server tính lại tổng → ký URL VNPAY theo tổng **sau giảm** → khi tạo đơn, gửi kèm `discount_codes` để Sapo ghi nhận.

**Hình dạng API đã verify trên dữ liệu thật (2026-10-02, quy tắc `TEST10`).** Không còn chỗ nào phải đoán:

- Hệ giảm giá là `GET /admin/price_rules.json`.
- **Mã khách nhập KHÔNG phải `title` của quy tắc.** Mã nằm ở `GET /admin/price_rules/{id}/discount_codes.json` → `{"discount_codes":[{id, code, usage_count}]}`. Lần thử này `title` trùng `code` chỉ vì gõ giống nhau; `title` là nhãn người biên tập đổi lúc nào cũng được.
- **`?code=` và `?title=` bị bỏ qua lặng lẽ, trả về toàn bộ quy tắc.** Chỉ `?query=` lọc thật, và nó là **tìm chuỗi con, không phân biệt hoa thường**: `?query=T` cũng ra `TEST10`.
- Mức giảm: `value` là **chuỗi âm** (`"-10"`), `value_type: "percentage"`. `summary` có sẵn câu tiếng Việt *"Giảm 10% cho toàn bộ đơn hàng"* — hiện thẳng cho khách, đừng tự dựng lại câu.
- Điều kiện: `status`, `starts_on`, `ends_on`, `usage_limit` so với `times_used`, `once_per_customer`, `prerequisite_subtotal_range`, `prerequisite_quantity_range`, `value_limit_amount`, các mảng `entitled_*_ids`.

**Thuật toán kiểm mã, bắt buộc theo đúng thứ tự này:**

1. `?query=<mã>` để thu hẹp — **chỉ thu hẹp, không coi là đã tìm thấy**
2. Với từng ứng viên, đọc `discount_codes` lồng bên trong và **so khớp `code` chính xác**
3. Kiểm `status`, khoảng ngày, `usage_limit` vs `times_used`
4. Kiểm điều kiện đơn hàng (`prerequisite_*`) với giỏ **đã tính lại giá từ Sapo**
5. Tính tiền giảm **ở server**, chặn trần bằng `value_limit_amount`
6. Ký URL VNPAY theo tổng **sau giảm**
7. Khi tạo đơn, gửi kèm `discount_codes` để Sapo ghi nhận

Bước 2 không phải thừa: bỏ nó thì khách gõ `T` cũng ăn giảm 10%.

Còn **một** thứ chưa verify: `POST /admin/orders.json` nhận `discount_codes` ở dạng nào. Phải thử trên đơn thật trước khi tin.

**Nghiệm thu**: mã sai bị từ chối; mã hết hạn bị từ chối; mã thật giảm đúng; VNPAY thu đúng số sau giảm; đơn Sapo ghi đúng mã và đúng mức giảm. Và một bài riêng: **sửa số tiền giảm trong request** phải bị server bác.

**✅ XONG.** Bài cuối không cần chạy vì nó không tồn tại được: **request không có trường số tiền
nào**. Trình duyệt gửi `discountCode`, `lib/discount.ts` tính lại toàn bộ ở server.

Verify 2026-10-05, theo đúng thuật toán bảy bước:

- `T` → **bị từ chối**. Đây chính là bẫy `?query=`: Sapo trả `TEST10` cho `?query=T`, và bước 2
  (đọc `discount_codes` lồng bên trong, so khớp `code` chính xác) là thứ chặn nó.
- `test10` → **được nhận**, trả về đúng cách Sapo viết: `TEST10`, −26.800, kèm câu `summary`
  tiếng Việt của Sapo.
- Đơn #1025 lưu `discount_codes:[{code:"TEST10",amount:26800,type:"fixed_amount",custom:true}]` và
  `cart_discount_amount: 26800`.

**Một phát hiện trái trực giác, và đừng "sửa" nó:** `discount_applications[0].price_rule_id` trả về
`null`, mã bị đánh dấu `custom: true` — trông như Sapo không khớp được quy tắc. **Nhưng nó có
khớp:** `times_used` của quy tắc và `usage_count` của mã đều nhảy 0 → 1. Nghĩa là bước kiểm
`usage_limit` đang đọc một bộ đếm Sapo thật sự duy trì cho đơn tạo qua API.

Vì sao gửi `type: "fixed_amount"` cho một quy tắc phần trăm: gửi `percentage` là nhờ Sapo tính lại,
và lệch một đồng do làm tròn sẽ làm tổng đơn khác số tiền VNPAY đã thu. Số ta đã thu là số được ghi.

**Chặt hơn kế hoạch ở một điểm:** quy tắc mang điều kiện ta không kiểm được (`entitled_*`, nhóm
khách, saved search, địa điểm, buy-X-get-Y, target là phí ship) thì **bị từ chối thẳng**, không áp
phần hiểu được. Áp một nửa là thu sai tiền theo một chương trình shop chưa từng mở. Riêng
`once_per_customer` thì chấp nhận và ghi log — không có tài khoản khách để mà chặn.

### T7.4 — Combo

Hai cách, tôi đề xuất cách A:

**A. Combo là một sản phẩm trong Sapo.** Tạo sản phẩm "Combo 3 vị", đặt giá, Sapo tự quản tồn kho. **Không cần viết dòng code nào** — nó chảy qua đúng đường hiện có. Nhược: tồn kho combo tách khỏi tồn kho từng món.

**B. Luật gộp ở giỏ hàng.** Mua 3 món bất kỳ giảm X. Linh hoạt hơn nhưng phải viết một bộ máy tính giá, và bộ máy đó phải chạy **ở server**, cùng lý do với T7.3.

Nên làm A trước để bán được ngay, B sau nếu thật sự cần.

**Nghiệm thu (A)**: tạo combo trong Sapo, nó xuất hiện trên web, mua được, trừ kho đúng.

### T7.5 — Thanh toán khi nhận hàng (COD)

Khác biệt cốt lõi: **COD không có IPN.** Đơn phải tạo trong Sapo **ngay lúc đặt**, với `financial_status: pending` thay vì `paid`, và không có giao dịch VNPAY.

Đây là chỗ dễ sai nhất về kiến trúc: hiện tại *"đơn chỉ được tạo ở IPN"* là một luật an toàn (`CLAUDE.md` mục 2). COD mở một đường tạo đơn thứ hai, nên phải viết lại luật đó cho rõ, không để lẫn.

**Nghiệm thu**: đơn COD vào Sapo với trạng thái chưa thanh toán; đơn VNPAY vẫn chỉ tạo từ IPN; hai đường không giẫm lên nhau.

**✅ XONG, và luật đã được viết lại chứ không bị bẻ.** `CLAUDE.md` security rule 2 giờ là hai nửa
phải đồng thời đúng: đơn **VNPAY** chỉ do IPN tạo và chỉ ở `paid`; đơn **COD** chỉ do
`placeCodOrder` tạo và chỉ ở `pending`, **không có mảng `transactions`**. Không đường nào trên
nhánh COD đánh dấu được "đã thanh toán", nên gọi bao nhiêu lần cũng không dựng được một bản ghi
thanh toán giả — chỉ ra đơn chưa trả tiền để người gọi xác nhận. Cái nó *có thể* sinh ra là đơn rác,
và đó là việc của rate limit.

Verify đơn #1025: `financial_status: "pending"`, `unpaid_amount: 266200`, `net_payment: 0`,
`gateway: null`. Gateway null là đúng và đã lường trước — Sapo suy ra gateway từ `transactions` mà
COD cố ý không gửi; cách thanh toán nằm ở `note_attributes.payment_method`, note và tags.

Hai hệ quả phải biết: **COD cũng trừ kho ngay** (115 → 114 với số lượng 1), nên **huỷ đơn COD cần
cộng kho tay**; và `DELETE /admin/orders/{id}.json` **không hoàn kho, cũng không giảm
`times_used`** — xoá một đơn thử không phải là huỷ một lần thử.

### T7.6 — Xác nhận đơn và tra cứu đơn

- **Email xác nhận** sau khi đơn vào Sapo. Kiểm xem Sapo có tự gửi không (payload hiện đang **tắt** receipts) trước khi đi tích hợp dịch vụ gửi mail riêng.
- **Trang tra cứu đơn** bằng mã đơn + số điện thoại. Không cần tài khoản.

**Lưu ý bảo mật**: trang tra cứu là một đường rò dữ liệu khách nếu làm ẩu. Mã đơn phải đoán không ra, và phải có giới hạn số lần thử.

**✅ XONG phần tra cứu; email là một cái công tắc, không phải một tính năng.**

Trang `/tra-cuu-don`: mã đơn + số điện thoại trên đơn, không cần tài khoản. Ba điều cố ý: sai số
điện thoại và không có đơn trả về **y như nhau** (nếu khác, trang thành máy đoán mã nào có thật);
mọi lần thử đều bị đếm theo IP **trước khi** đọc gì (mã đơn là timestamp + 6 số, đoán được nếu đủ
lượt — rate limit là thứ làm "đủ lượt" không xảy ra); và link từ trang kết quả mang sẵn mã đơn
nhưng **không bao giờ** mang số điện thoại.

Email: `SAPO_SEND_RECEIPT=true` nhờ Sapo gửi thư xác nhận của chính nó. Mặc định **tắt**, cố ý —
bật là Sapo gửi mail tới địa chỉ thật ngay khi có đơn, nên đó phải là quyết định của shop, không
phải hệ quả của một lần deploy. **Chưa verify** Sapo có thật sự gửi cho đơn tạo qua API hay không,
vì muốn biết thì phải gửi một email thật, và việc đó không undo được. Nếu nó không gửi thì cần một
dịch vụ mail riêng — ngoài phạm vi dự án này (cần khoá, cần domain gửi đã xác thực, cần chọn nhà
cung cấp).

### T7.7 — Hoá đơn

**Cần phân biệt hai thứ hoàn toàn khác nhau, đừng gộp:**

| | Là gì | Ai làm |
|---|---|---|
| **Phiếu đặt hàng in được** | Trang in gọn cho khách và cho đóng gói | Làm được trong dự án này, khoảng nửa ngày |
| **Hoá đơn điện tử (hoá đơn VAT)** | Chứng từ pháp lý, phải phát hành qua nhà cung cấp được cấp phép và báo cơ quan thuế | **Không phải việc của Sapo hay của web này** — cần tích hợp nhà cung cấp (VNPT, Viettel, MISA…) và cần mã số thuế của doanh nghiệp |

Nếu bạn nói "in hoá đơn" theo nghĩa thứ hai thì đó là một dự án riêng có ràng buộc pháp lý, không phải một tính năng của trang web.

**Nghiệm thu (phiếu in)**: mở trang in của một đơn thật, in ra PDF đủ thông tin, không lộ dữ liệu của đơn khác.

**✅ XONG phiếu in. Hoá đơn VAT vẫn ngoài phạm vi, như đã nói từ đầu.**

Phiếu in **không có URL riêng**: nó là đúng khối kết quả của `/tra-cuu-don`, cộng một khối
`@media print` trong `app/globals.css` bỏ header/footer/mọi nút `.no-print`. Làm vậy vì một route
thứ hai chứa nội dung đơn hàng là một địa chỉ thứ hai để đoán; không có nó thì rào chắn vẫn nằm đúng
một chỗ. Phiếu tự ghi rõ nó là phiếu đặt hàng, không phải hoá đơn giá trị gia tăng.

### T7.8 — Siết vận hành

- ✅ `querydr` đối soát đơn kẹt `pending`/`sapo_error` — `npm run querydr -- <txnRef>`, **chỉ đọc**.
  Verify thật 2026-10-05 trên một giao dịch cũ: `00`/`00`, NCB, 1.340.000đ, khớp đơn #1024. Nó
  *không* tạo đơn Sapo; khi VNPAY xác nhận đã thu tiền thì in ra đúng một lệnh
  (`npm run simulate:ipn`) để người vận hành quyết định — đi lại đúng đường IPN đã xác minh, chống
  trùng hai lớp. **Checksum của querydr là chín giá trị nối bằng `|` theo thứ tự cố định**, không
  phải `key=value` sort như URL thanh toán; ký sai kiểu thì được một request đúng hình thức và trả
  `97`. Vì hai lược đồ trông giống nhau tới mức nguy hiểm, script cố ý **không dùng chung code** với
  `lib/vnpay.ts`. Còn thiếu để thành *job* tự động: một chỉ mục các mã đang `pending` (store không
  có key scan) và một quyết định ai được phép kích hoạt thao tác ghi.
- ✅ Giới hạn tần suất trên `/api/checkout` — `store.hit()` (Redis `INCR`+`EXPIRE`, dùng chung giữa
  các instance; Map khi chạy local). Ba chính sách trong `RATE_POLICIES`: checkout 10/10 phút (đây
  là cái quan trọng, vì COD khiến một request tạo một đơn thật), thử mã giảm giá 20/10 phút, tra cứu
  đơn 10/15 phút. **Fail open** — store hỏng thì cho request đi qua, vì đánh đổi khả năng bán hàng để
  giữ một cái rào chống quấy là đổi sai chiều.
- ❌ Đường hoàn tiền — **chưa có gì**, kể cả quy trình thủ công có ghi chép. Đây là việc còn lại rõ
  ràng nhất của nhóm 3.

---

## Ước lượng

| Bước | |
|---|---|
| T7.0 bật quyền | 15 phút, việc của bạn |
| T7.1 địa chỉ | 1 ngày |
| T7.2 phí vận chuyển | 0,5–1,5 ngày tuỳ mức |
| T7.3 mã giảm giá | 1–1,5 ngày |
| T7.4 combo cách A | vài giờ |
| T7.5 COD | 1 ngày |
| T7.6 xác nhận + tra cứu | 1–1,5 ngày |
| T7.7 phiếu in | 0,5 ngày |
| T7.8 siết vận hành | 1 ngày |

Khoảng **7–9 ngày** cho toàn bộ. Muốn bán thật sớm nhất thì **T7.0 → T7.1 → T7.2 → T7.5** là bộ tối thiểu: giao được hàng, thu đúng tiền, nhận được cả khách không dùng thẻ.

## Ba rủi ro lớn nhất

1. **Mã giảm giá tính ở client.** Là lỗ hổng tiền thật. Cùng một luật với giá: server tính, server ký, không tin trình duyệt.
2. **COD mở đường tạo đơn thứ hai.** Luật "chỉ IPN mới tạo đơn" đang giữ cho hệ thống không tạo đơn ma. Nới nó ra mà không viết lại cho rõ là mở cửa cho đơn rác.
3. **Phí vận chuyển lệch giữa ba nơi.** Màn hình, VNPAY và Sapo phải khớp từng đồng, nếu không sổ sách lệch và phát hiện ra thì đã muộn.
