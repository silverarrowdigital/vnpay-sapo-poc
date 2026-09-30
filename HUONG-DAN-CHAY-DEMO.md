 Hướng dẫn chạy demo VNPAY → Sapo

Ghi nhớ nhanh. Chi tiết kỹ thuật nằm trong `CLAUDE.md`.

## Mỗi lần muốn chạy demo — 3 bước

1. Terminal 1, trong thư mục dự án:

       npm run dev

2. Terminal 2 (mở SAU khi terminal 1 đã chạy xong):

       npm run watch:ipn

3. Mở http://localhost:3000 → bấm **Buy now** → điền form → thanh toán.

Thẻ test NCB của VNPAY sandbox:

    Số thẻ   9704198526191432198
    Tên      NGUYEN VAN A
    Ngày     07/15
    OTP      123456

Xong. Đơn tự vào Sapo sau khoảng 1 giây, trang `/success` tự chuyển sang hoàn tất.

## Tại sao phải có terminal 2

VNPAY chỉ gọi IPN tới địa chỉ đã khai trong merchant portal — hiện chưa khai.
`watch:ipn` đọc log, lấy callback thật (đã có chữ ký của VNPAY) và phát lại
vào `/api/vnpay/ipn`. Đó là thứ tạo đơn Sapo.

Không có terminal 2 thì thanh toán vẫn thành công nhưng đơn kẹt ở `pending`.

## KHÔNG cần làm gì thêm

- Không cần đăng ký lại VNPAY. Credential sandbox trong `.env.local` không hết hạn.
- Không cần ngrok hay tunnel. Đã gỡ.
- Không cần sửa `.env.local`. Đã đúng: `APP_BASE_URL=http://localhost:3000`.
- Không cần khai IPN URL trong portal — chỉ cần nếu sau này chạy thật.

## Khi trục trặc

| Triệu chứng                              | Làm gì                                              |
|------------------------------------------|-----------------------------------------------------|
| `/success` kẹt `pending` quá 5 giây      | Xem terminal 2 còn chạy không, rồi `npm run replay:last` |
| Quên mở terminal 2 trước khi trả tiền    | `npm run replay:last` — cứu được, callback đã nằm trong log |
| Đóng tab trước khi VNPAY chuyển về       | Không cứu tự động được; tra giao dịch trong portal VNPAY |
| Lỗi "Payment is not configured"          | Thiếu biến trong `.env.local` — xem README mục Troubleshooting |

## Lệnh hay dùng

    npm run dev              # chạy app
    npm run watch:ipn        # tự tạo đơn khi thanh toán xong  ← bắt buộc
    npm run replay:last      # cứu đơn gần nhất bị kẹt pending
    npm run clean:orders     # liệt kê đơn test trong Sapo (chưa xoá)
    npm run clean:orders -- --yes   # XOÁ THẬT, không hoàn tác được

## Lưu ý

- Mỗi thanh toán thành công tạo **đơn Sapo thật** và **trừ tồn kho thật**.
- Đơn đang chờ nằm trong RAM: restart server giữa chừng là mất, phải đặt lại từ đầu.
- Portal VNPAY sandbox: https://sandbox.vnpayment.vn/merchantv2/
  (đường `/` bị 403; trang login có modal "Link thanh toán" che, bấm × để đóng)

---
Trạng thái lúc lập ghi chú (29/09/2026): 5 đơn test trong Sapo (tag `headless-poc`),
tồn kho còn 94.
