# T8 — Combo và tồn kho

**Phạm vi: chỉ chuyện tồn kho của sản phẩm combo.** Không đụng giá, không đụng giao diện, không đụng
luồng thanh toán. Lý do có tài liệu này: shop đã tạo một sản phẩm combo thật và nó **đang bán được**,
mà cách nó trừ kho thì sai — và sai theo hướng không ai nhìn thấy.

---

## Hiện trạng — đã verify trên store thật, 2026-10-05

### Combo là một loại sản phẩm riêng của Sapo

Variant combo mang hai trường mà sản phẩm thường không có:

```json
{ "id": 230254166, "sku": "TESTCOMBO-001", "type": "combo", "requires_components": true }
```

Danh sách thành phần **không** nằm trong `/admin/products.json`. Nó nằm ở
**`GET /admin/combos.json`** — endpoint này không có trong các trang tài liệu đã đọc của Sapo, nhưng
đọc được thật trên store (HTTP 200, có dữ liệu). `/admin/products/{id}/components.json` và
`/admin/variants/{id}/components.json` **không phải route** (404); `product_components`,
`variant_components`, `combo_products` cũng không.

```
/admin/combos.json → { combos: [{ variant_id, product_id, price, total_available,
                                  inventories: [{location_id, available}],
                                  combo_items: [ ...variant đầy đủ + quantity... ] }] }
```

### Tồn kho combo là **số dẫn xuất**, không phải số được lưu

| Thành phần | Cần | Tồn |
|---|---|---|
| `TEST-005` Hồng Trà Shan Tuyết 60g | 1 | 114 |
| `TEST-002` Test Product 2 | 1 | 37 |
| `TEST-001` Test Product 1 | 1 | 61 |

`min(114/1, 37/1, 61/1) = 37`, và `total_available` của combo đúng bằng **37**. Khớp chính xác.

Tin tốt kèm theo: `/admin/products.json` cũng trả `inventory_quantity: 37` cho variant combo, nên
**storefront đang hiển thị đúng số** và `maxOrderableQuantity` đang chặn đúng. Phần đọc không cần sửa
gì.

### Vấn đề: bán combo qua API **không trừ kho thành phần nào cả**

Ngày 2026-10-05 có **4 đơn COD, mỗi đơn 10 combo** (`#1030`–`#1033`, do một phép dò sai của Claude
tạo ra, đã xoá). Tổng **40 combo**. Payload có `inventory_behaviour: "decrement_ignoring_policy"` và
`variant_id` của combo, đúng như mọi đơn khác.

Tồn kho ba thành phần sau 40 combo đó: **không đổi**. Mọi biến động đo được đều giải thích hết bằng
các đơn *khác*:

- `TEST-002` 38 → 37 là do đơn `#1029` mua đúng 1 `TEST-002`
- `TEST-005` 115 → 114 là do đơn `#1026`
- `TEST-001` không đổi sau khi trừ 5 cái của đơn `#1028`

Nói cách khác: **Sapo nhận đơn, trừ tiền, giao hàng — và không nở combo ra thành phần.**

### Hệ quả sắc nhất, và nó không tự lộ ra

Vì tồn combo là `min(...)` của các thành phần, mà bán combo lại không làm thành phần giảm:

> **Bán combo không bao giờ làm tồn combo giảm.** Bán 37 combo xong, `total_available` vẫn là 37.
> Bán tiếp 37 cái nữa cũng vậy. Mãi mãi.

Phép kiểm tồn kho ở `/api/checkout` không cứu được: nó đọc đúng con số 37 mà Sapo đưa, và con số đó
không bao giờ giảm. Không có cảnh báo, không có lỗi, không có dòng log nào. Hàng trong kho thì hết,
mà sổ nói còn 37.

Đây chính là "sai số đi vào sổ sách mỗi lần có đơn".

---

## Chưa biết — phải verify trước khi viết một dòng code nào

Thứ tự này quan trọng: câu 1 quyết định ba câu sau có cần hỏi hay không.

1. **Bán combo *trong trang quản trị Sapo* có trừ kho thành phần không?**
   Đây là câu chia đôi vấn đề: nếu admin trừ đúng thì lỗi nằm ở **đường API** (tức ở payload của ta,
   hoặc ở giới hạn của Admin API); nếu admin cũng không trừ thì đây là cách combo của Sapo vận hành
   và ta phải tự xử lý hoàn toàn.
2. **`combination_lines` trên đơn là gì?** Mọi đơn đọc về đều có `combination_lines: []`. Cái tên
   gợi đúng chỗ combo được nở ra. Chưa biết nó có nhận được khi **tạo** đơn hay chỉ là trường đọc.
3. **`POST /admin/orders.json` có cách nào để yêu cầu nở combo?** Một cờ, một dạng line item khác,
   hay không có gì cả.
4. **`/admin/combos.json` có trong tài liệu Sapo không?** Nó đọc được thật, nhưng luật số 7 của repo
   là không bịa endpoint — nếu code sẽ gọi nó thì phải ghi rõ nó được verify bằng cách nào.

---

## Kế hoạch

### T8.0 — Chia đôi vấn đề *(việc của bạn, 10 phút, chặn mọi bước sau)*

Trong trang quản trị Sapo, tạo **một đơn nháp/đơn thủ công** chứa **1 combo**, hoàn tất nó, rồi so
tồn kho ba thành phần trước và sau.

| Kết quả | Nghĩa là | Đi tiếp theo nhánh |
|---|---|---|
| Thành phần **giảm 1** mỗi món | Sapo biết nở combo; đường API của ta chưa kích hoạt được | T8.1 |
| Thành phần **không đổi** | Combo của Sapo không quản tồn thành phần | T8.2 |

**Nghiệm thu**: ghi lại ba con số trước/sau. Đây là dữ kiện mà cả T8.1 và T8.2 dựa vào.

### T8.1 — Nếu Sapo biết nở: tìm đúng cách gọi *(0,5–1 ngày)*

Theo thứ tự rủi ro từ thấp lên cao:

1. Đọc lại tài liệu order API tìm `combination_lines` hoặc cờ liên quan tới combo. **Không bịa.**
2. Nếu tài liệu có: gửi thử **một** đơn COD, **1 combo**, kèm trường đó. Đọc lại
   `combination_lines`, `line_items` và tồn ba thành phần.
3. Nếu tài liệu không có: thử gửi `combination_lines` theo đúng hình dạng nó trả về khi đọc — và nếu
   Sapo trả `422` thì **dừng**, ghi lại, chuyển sang T8.2. Không thử biến thể thứ hai, thứ ba.

**Nghiệm thu**: một đơn API làm tồn ba thành phần giảm đúng, và `total_available` của combo giảm theo.

### T8.2 — Nếu Sapo không nở: ta tự nở ở payload *(0,5 ngày)*

Gửi **các thành phần** làm `line_items` thay vì variant combo, với giá phân bổ sao cho tổng bằng
đúng giá combo. Tồn kho khi đó đúng, vì mỗi dòng là một variant thường mà `inventory_behaviour` vẫn
trừ như bình thường.

Phân bổ giá theo tỷ lệ giá lẻ, và **đồng cuối cùng dồn vào dòng đầu** để tổng khớp tuyệt đối —
không được để làm tròn làm lệch tổng, vì tổng ấy phải bằng số tiền VNPAY đã thu.

Ví dụ combo 400.000 từ ba món giá lẻ 268.000 + 50.000 + 100.000 = 418.000:

```
268.000 / 418.000 × 400.000 = 256.459  → 256.461  (dồn phần dư vào đây)
 50.000 / 418.000 × 400.000 =  47.847
100.000 / 418.000 × 400.000 =  95.693
                               -------
                               400.000
```

**Đánh đổi phải nói rõ với shop:** đơn trong Sapo sẽ hiện **ba dòng hàng** chứ không hiện
"Combo 3 món". Bù lại bằng `note_attributes` (`combo_sku`, `combo_variant_id`, `combo_price_vnd`) và
một tag `combo-<sku>`, để vẫn tra cứu được đơn nào là combo. Phiếu in và trang tra cứu đơn đọc từ
`line_items`, nên cũng sẽ hiện ba dòng — cần một dòng ghi chú ở đó.

**Nghiệm thu**: một đơn API cho 1 combo làm giảm đúng 1 mỗi thành phần; `total_available` của combo
giảm 1; tổng đơn trong Sapo bằng đúng số VNPAY thu, không lệch một đồng.

### T8.3 — Chặn đường cũ lại — **✅ ĐÃ LÀM 2026-10-05**

Đã làm trước các bước khác, vì shop **không đặt được sản phẩm về `draft`** trong Sapo nên không có
cách nào chặn bằng cấu hình. `lib/catalog.ts` `isSellable` giữ mọi variant combo ở ngoài catalog:
nó không xuất hiện trên web, trang sản phẩm trả 404 (cả theo alias và theo variantId), và một giỏ
hàng đã chứa combo từ trước — giỏ nằm trong `localStorage` nên chuyện này xảy ra thật — bị bác ở
checkout với `409`. Chế độ `SAPO_VARIANT_ID` cũng đi qua cùng cái cổng đó, nếu không thì ghim shop
vào một combo sẽ mở lại đúng lỗ vừa bịt.

Verify: catalog còn 5 sản phẩm, không có combo; `/products/230254166` → 404; checkout với
`variantId: 230254166` → 409.

Bước này **không** cần đợi T8.0, và nó là lý do T8.0 không còn gấp: không còn đơn combo nào vào nữa.

### T8.3b — Khi đã sửa xong thì mở lại *(1–2 giờ)*

Dù đi nhánh nào, phải có một rào không cho âm thầm quay lại tình trạng hôm nay: nếu một dòng giỏ trỏ
tới variant có `type: "combo"` / `requires_components: true` mà code **chưa** xử lý nở combo, thì
`/api/checkout` **từ chối** dòng đó thay vì tạo một đơn không trừ kho.

Khi T8.1 hoặc T8.2 xong, bỏ `isSellable` để combo quay lại web — và giữ lại phép kiểm ở checkout
làm lớp thứ hai.

**Nghiệm thu**: mua một combo làm giảm đúng 1 mỗi thành phần, và tổng đơn Sapo bằng số VNPAY thu.

### T8.4 — Chốt kho sau giai đoạn thử *(việc của bạn)*

**✅ XONG 2026-10-05.** `TEST-002` đã được sửa về **38**, và `TESTCOMBO-001` tự về 38 theo — vì tồn
combo là số dẫn xuất, không phải số lưu riêng (lời khuyên ban đầu "cộng +1 cho combo" là sai và đã
sửa lại). Đơn combo `#1034` không nợ kho gì, vì nó không làm kho di chuyển.

---

## Ước lượng

| Bước | |
|---|---|
| T8.0 chia đôi vấn đề | 10 phút, việc của bạn, **chặn phần còn lại** |
| T8.1 tìm đúng cách gọi | 0,5–1 ngày (chỉ nếu T8.0 cho kết quả "giảm") |
| T8.2 tự nở ở payload | 0,5 ngày (chỉ nếu T8.0 cho kết quả "không đổi") |
| T8.3 rào chặn | 1–2 giờ, **luôn làm** |
| T8.4 chốt kho | vài phút, việc của bạn |

Khoảng **1–1,5 ngày**, mà phần lớn phụ thuộc vào một phép thử 10 phút của bạn.

---

## Ba rủi ro

1. **Mỗi đơn combo bán ra lúc này là một sai số đi vào sổ.** Đây là rủi ro đang diễn ra, không phải
   rủi ro tương lai. Nếu chưa làm xong T8.3 thì cách an toàn nhất là **đặt sản phẩm combo về `draft`
   trong Sapo** — storefront chỉ hiện `status: "active"`, nên nó biến mất khỏi web ngay, không cần
   deploy.
2. **Tự nở combo làm lệch tiền nếu làm tròn sai.** Tổng ba dòng phải bằng đúng giá combo, và giá
   combo phải bằng đúng số VNPAY thu. Đây là cùng một loại rủi ro với phí vận chuyển ở T7.2, và cùng
   một cách chữa: một hàm duy nhất tính, không có bản thứ hai.
3. **`/admin/combos.json` chưa thấy trong tài liệu.** Nó chạy hôm nay. Nếu Sapo đổi nó thì không có
   thông báo nào, nên code gọi nó phải chịu được việc nó biến mất — degrade về "không bán combo"
   (tức T8.3), chứ không được tạo đơn không trừ kho.
