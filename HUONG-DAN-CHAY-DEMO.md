# Hướng dẫn chạy demo VNPAY → Sapo

Ghi nhớ nhanh cho người vận hành. Chi tiết kỹ thuật và lý do các quyết định nằm trong `CLAUDE.md`.

## Đang có gì

| | |
|---|---|
| Repo | https://github.com/silverarrowdigital/vnpay-sapo-poc (public) |
| Production | https://vnpay-sapo-poc.vercel.app |
| Vercel project | `triwebflow-5833/vnpay-sapo-poc` — tự deploy mỗi khi push lên `main` |
| Store Sapo | 4 sản phẩm test (`TEST-001` … `TEST-004`) |

Luồng: trang chủ liệt kê sản phẩm đọc live từ Sapo → click vào sản phẩm → chọn số lượng →
Add to cart → badge giỏ ở header → `/checkout` sửa giỏ + điền form → VNPAY → IPN tự về →
đơn vào Sapo, trừ tồn kho.

Một giỏ chứa tối đa **20 dòng**, mỗi dòng tối đa **10 cái**, và không vượt tồn kho.

## Mở lại dự án ngày mai

```bash
cd C:/Users/skull/Downloads/vnpay-sapo-poc/vnpay-sapo-poc
git pull            # lấy thay đổi nếu có
npm run dev
```

Credential VNPAY và Sapo trong `.env.local` **không hết hạn**, không phải đăng ký lại gì.

Nếu `npm install` báo thiếu package (ví dụ sau khi ai đó thêm dependency), chạy `npm install` một lần.

## Cách 1 — Test trên production (khuyên dùng)

Mở https://vnpay-sapo-poc.vercel.app/ và mua như khách thật. **Không cần chạy gì ở máy.**

IPN tự về vì IPN URL đã khai trong portal VNPAY, nên đơn vào Sapo sau khoảng **15–20 giây**,
trang kết quả tự chuyển sang "Payment confirmed — order created".

## Cách 2 — Test ở local

```bash
npm run dev        # terminal 1
npm run watch:ipn  # terminal 2, mở SAU khi terminal 1 đã chạy
```

Rồi mở http://localhost:3000.

**Vì sao local cần terminal 2:** portal VNPAY chỉ giữ được **một** IPN URL, và nó đang trỏ về
production. Nên khi bạn trả tiền từ localhost, VNPAY gọi IPN về production — production không biết
đơn đó nên trả `01` (vô hại, chỉ làm log Vercel hơi ồn). `watch:ipn` đọc log dev, lấy callback thật
đã có chữ ký VNPAY, và phát lại vào IPN local. Đó là thứ tạo đơn Sapo.

Quên mở terminal 2 trước khi trả tiền vẫn cứu được: `npm run replay:last`.

## Thẻ test

```
Ngân hàng  NCB
Số thẻ     9704198526191432198
Tên        NGUYEN VAN A
Ngày       07/15
OTP        123456
```

## Làm việc mới thì theo quy trình này

Đừng commit thẳng lên `main` — production tự deploy từ `main`, nên một commit sai là production sai.

```bash
git checkout main
git pull
git checkout -b feat/ten-tinh-nang     # tách branch
# ... làm việc, commit ...
npm run typecheck && npm run lint && npm run build   # phải sạch cả ba
git push -u origin feat/ten-tinh-nang
gh pr create --base main               # tạo PR
```

Push branch sẽ tạo **Preview deployment** riêng trên Vercel, production không bị ảnh hưởng.
Xem preview xong thì bấm **Merge** trên PR. Merge xong Vercel tự deploy production.

Nếu công việc đó đổi cấu trúc dữ liệu đơn hàng (`PendingOrder` trong `lib/store.ts`), đọc phần
namespace trong `CLAUDE.md` trước — Redis dùng chung một database cho mọi môi trường.

## Biến môi trường — local và Vercel KHÁC nhau

| Biến | Local (`.env.local`) | Vercel |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | `https://vnpay-sapo-poc.vercel.app` |
| `SAPO_VARIANT_ID` | **đã comment** | **đã xoá** |
| `KV_REST_API_URL` / `_TOKEN` | không có → dùng RAM | có → Redis dùng chung |

`SAPO_VARIANT_ID` nghĩa là "ghim catalog vào một sản phẩm". Set lại là trang chủ chỉ còn một món.
Bản gốc `.env.local` trước khi comment nằm ở `.env.backup.local` (đã gitignore).

Vì local không có Redis nên **đơn đang chờ nằm trong RAM**: restart server giữa lúc thanh toán là
mất đơn, phải đặt lại. Production thì dùng Redis nên không bị.

## Cấu hình portal VNPAY — ĐỪNG mở lại form đó

https://sandbox.vnpayment.vn/merchantv2/Account/TerminalEdit.htm

Terminal `IG21IKOR` đã cấu hình xong và đang chạy đúng:

```
IPN URL        https://vnpay-sapo-poc.vercel.app/api/vnpay/ipn
Giao thức IPN  GET
Kiểu mã hóa    HMACSHA512
```

⚠️ **Không mở lại và lưu form này.** `HMACSHA512` là giá trị đang lưu nhưng **không có trong
dropdown** của portal (dropdown chỉ có `MD5`, `TriDes`, `SHA256` — đều là thuật toán bản cũ). Lưu
lại form có thể hạ terminal xuống thuật toán cũ, và khi đó mọi request thanh toán bị VNPAY từ chối.
Đã từng xảy ra: sau một lần lưu, terminal biến mất khỏi danh sách vài phút.

## Khi trục trặc

| Triệu chứng | Làm gì |
|---|---|
| Trang chủ chỉ hiện 1 sản phẩm | `SAPO_VARIANT_ID` đang được set. Local: comment trong `.env.local`. Vercel: xoá rồi **Redeploy** |
| `/success` kẹt `pending` quá 60 giây (local) | Xem terminal 2 còn chạy không, rồi `npm run replay:last` |
| `/success` kẹt `pending` quá 60 giây (production) | Vào Vercel → Logs → search txnRef → tìm dòng `event: return.received`, copy giá trị `query`, rồi `npm run replay-ipn -- "<query>" https://vnpay-sapo-poc.vercel.app`. **Log Vercel giữ không lâu, làm sớm.** History browser **không** có URL đó vì route trả `303` |
| Trang VNPAY báo Error | Kiểm tra terminal `IG21IKOR` còn trong portal không. Đừng dùng `curl -L` để test URL thanh toán — không giữ cookie thì luôn ra trang Error dù terminal vẫn tốt |
| "Payment is not configured" | Thiếu biến trong `.env.local` — xem README mục Troubleshooting |
| Sản phẩm mới không hiện | Kiểm tra `status` của nó trong Sapo phải là `active` |
| Đóng tab trước khi VNPAY chuyển về | Trên production thì IPN vẫn tự về, đơn vẫn tạo. Ở local thì phải replay tay |

## Lệnh hay dùng

```bash
npm run dev                     # chạy app
npm run watch:ipn               # bắt buộc khi test thanh toán ở LOCAL
npm run replay:last             # cứu đơn local gần nhất bị kẹt pending
npm run simulate:ipn -- <txnRef> <amountVnd> [code] [baseUrl]
                                # tự ký IPN, không cần VNPAY. code 24 = huỷ (KHÔNG tạo đơn Sapo)
npm run clean:orders            # liệt kê đơn test trong Sapo (chưa xoá)
npm run clean:orders -- --yes   # XOÁ THẬT, không hoàn tác
npm run typecheck && npm run lint && npm run build
```

Muốn test mà **không** tạo đơn và **không** trừ tồn kho: dùng `simulate:ipn` với code `24`.

## Lưu ý

- Mỗi thanh toán thành công tạo **đơn Sapo thật** và **trừ tồn kho thật**. Xoá đơn được, tồn kho
  phải sửa tay trong Sapo admin.
- Đừng xoá hay đổi trạng thái sản phẩm đang có nếu chưa chắc — production đọc Sapo live mỗi request.
- Portal VNPAY sandbox: https://sandbox.vnpayment.vn/merchantv2/
  (đường `/` bị 403; trang login có modal "Link thanh toán" che, bấm × để đóng)

---

**Trạng thái lúc lập ghi chú (30/09/2026):**

- `main` = commit `20d8749`, đã merge PR #1 (catalog + giỏ hàng + trang sản phẩm). Không còn PR mở.
- Branch `feat/add-to-cart` đã merge, còn trên remote — xoá được.
- 10 đơn test trong Sapo (tag `headless-poc`), mới nhất `#1018` (3 dòng, 850.000 ₫).
- Tồn kho: `TEST-001` 84 · `TEST-002` 45 · `TEST-003` 1 · `TEST-004` 0.
- Đã chạy thật end-to-end trên production với giỏ 3 sản phẩm, IPN tự về sau 21 giây.
