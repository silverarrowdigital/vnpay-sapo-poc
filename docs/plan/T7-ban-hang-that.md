# T7 — Từ bản chạy được thành cửa hàng bán thật

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

**Chưa có gì** về: địa chỉ giao hàng đầy đủ, phí vận chuyển, mã giảm giá, thuế, combo, COD, email xác nhận, tra cứu đơn, hoá đơn.

Đơn gửi sang Sapo hiện **không có** `shipping_lines`, **không có** `discount_codes`, **không có** thuế.

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

### T7.2 — Phí vận chuyển

Hai mức:

- **Tối thiểu**: bảng phí phẳng theo tỉnh, tự tính. Nhanh, đủ dùng, và **xoá được lời hứa sai** đang nằm trên trang sản phẩm.
- **Đầy đủ**: đọc `shipping_zones` từ Sapo để phí trên web khớp phí trong Sapo.

Dù chọn mức nào: **phí phải cộng vào số tiền gửi sang VNPAY** và gửi kèm `shipping_lines` khi tạo đơn Sapo, nếu không sổ sách sẽ lệch.

**Nghiệm thu**: tiền trên màn hình = tiền VNPAY thu = tổng đơn trong Sapo, ở ba đơn khác tỉnh nhau.

### T7.3 — Mã giảm giá từ Sapo

**Điểm an toàn quan trọng nhất của cả T7.** Mã giảm giá phải được **kiểm tra và tính lại hoàn toàn ở server**, đúng như giá đang làm. Nhận số tiền giảm từ trình duyệt là tặng tiền cho bất kỳ ai biết mở DevTools.

Luồng: khách nhập mã → server hỏi Sapo mã có thật/còn hạn/đủ điều kiện không → server tính lại tổng → ký URL VNPAY theo tổng **sau giảm** → khi tạo đơn, gửi kèm `discount_codes` để Sapo ghi nhận.

**Chặn ở một việc nhỏ của bạn: store hiện có 0 price rule.** Không có dữ liệu thật thì không đọc được hình dạng của nó, và viết code theo phỏng đoán là đúng thứ `CLAUDE.md` cấm. Bạn tạo giúp **một mã giảm giá thử** trong Sapo (ví dụ `TEST10`, giảm 10%, không giới hạn) rồi báo tôi — tôi đọc cấu trúc thật rồi mới viết.

Cần biết từ dữ liệu thật: tên trường của mức giảm, kiểu giảm (phần trăm hay số tiền), điều kiện áp dụng, hạn dùng, giới hạn lượt, và đường dẫn lồng để tra một mã cụ thể. Cộng thêm: `POST /admin/orders.json` nhận `discount_codes` ở dạng nào.

**Nghiệm thu**: mã sai bị từ chối; mã hết hạn bị từ chối; mã thật giảm đúng; VNPAY thu đúng số sau giảm; đơn Sapo ghi đúng mã và đúng mức giảm. Và một bài riêng: **sửa số tiền giảm trong request** phải bị server bác.

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

### T7.6 — Xác nhận đơn và tra cứu đơn

- **Email xác nhận** sau khi đơn vào Sapo. Kiểm xem Sapo có tự gửi không (payload hiện đang **tắt** receipts) trước khi đi tích hợp dịch vụ gửi mail riêng.
- **Trang tra cứu đơn** bằng mã đơn + số điện thoại. Không cần tài khoản.

**Lưu ý bảo mật**: trang tra cứu là một đường rò dữ liệu khách nếu làm ẩu. Mã đơn phải đoán không ra, và phải có giới hạn số lần thử.

### T7.7 — Hoá đơn

**Cần phân biệt hai thứ hoàn toàn khác nhau, đừng gộp:**

| | Là gì | Ai làm |
|---|---|---|
| **Phiếu đặt hàng in được** | Trang in gọn cho khách và cho đóng gói | Làm được trong dự án này, khoảng nửa ngày |
| **Hoá đơn điện tử (hoá đơn VAT)** | Chứng từ pháp lý, phải phát hành qua nhà cung cấp được cấp phép và báo cơ quan thuế | **Không phải việc của Sapo hay của web này** — cần tích hợp nhà cung cấp (VNPT, Viettel, MISA…) và cần mã số thuế của doanh nghiệp |

Nếu bạn nói "in hoá đơn" theo nghĩa thứ hai thì đó là một dự án riêng có ràng buộc pháp lý, không phải một tính năng của trang web.

**Nghiệm thu (phiếu in)**: mở trang in của một đơn thật, in ra PDF đủ thông tin, không lộ dữ liệu của đơn khác.

### T7.8 — Siết vận hành

- `querydr` đối soát đơn kẹt `pending`/`sapo_error`
- Giới hạn tần suất trên `/api/checkout`
- Đường hoàn tiền, dù chỉ là quy trình thủ công có ghi chép

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
