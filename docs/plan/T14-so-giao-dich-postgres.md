# T14 — Sổ giao dịch trên Postgres (PR 4–6 của kế hoạch sprint)

**Trạng thái (2026-10-07): CHỈ MỚI LÀ KẾ HOẠCH. Chưa có dòng code nào.** Việc này **không bắt đầu được** cho tới khi chủ tài
khoản Vercel bật Neon (câu 1). Khi có Neon và bạn nói "bắt đầu T14", làm theo thứ tự PR 4 → 5 → 6, mỗi PR một lần push.

## Vì sao cần

Mọi thứ về một giao dịch hiện nằm trong **một bản ghi JSON trong Redis, sống 7 ngày** (`lib/store.ts`, `PendingOrder`). Hệ quả đã
gặp hoặc đã đo:

- Không có nơi nào liệt kê "đơn chờ": store không quét được khoá, nên việc hỏi VNPAY khi mất IPN (T13.0) chỉ chạy được khi **có
  người mở `/success`**. Khách đóng tab trước thì không ai hỏi (đơn #1039 thoát được vì tôi đang nhìn log).
- Trạng thái trộn một enum duy nhất `pending/processing/completed/sapo_error/cancelled/failed`: không tách được "đã trả tiền" khỏi
  "đã ghi vào Sapo".
- Mỗi lần bấm thanh toán là một `txnRef` và một "đơn" mới; không có khái niệm nhiều lần thử cho một đơn.
- Hết hạn là mất: một khoản đã thu nhưng bản ghi biến mất thì IPN trả `01` và chỉ còn email cảnh báo.

## Những gì đã chốt (doc tiến độ, "Quyết định đã chốt" 2026-10-06)

Neon qua Vercel Marketplace · Drizzle · Outbox + xử lý ngay sau IPN + QStash cho lần thử lại (Hobby chỉ cho cron một lần/ngày) ·
nhánh Neon cho mỗi preview · mỗi việc một PR.

## Cần bạn chốt

1. **Bật Neon trên Vercel** (chỉ chủ tài khoản làm được: Marketplace → Neon → chấp nhận điều khoản → gắn vào project, cả
   Production và Preview). Chưa có gì để code nếu chưa có `DATABASE_URL`. *Khuyến nghị:* làm ngay, mất 5 phút.
2. **Lưu địa chỉ khách ở đâu.** Sổ mới lưu tên, SĐT, email, địa chỉ lâu hơn 7 ngày. *Khuyến nghị:* chỉ giữ trong bảng `orders` tới
   khi đơn Sapo được tạo xong, rồi xoá các cột đó sau 90 ngày bằng một job; chính sách bảo mật hiện hứa giữ 2 năm
   (`lib/policies.ts`, **chưa có gì thực thi lời hứa đó**), nên chủ shop cần chọn: 90 ngày hay 2 năm.
3. **Có chạy song song Redis và Postgres trong lúc chuyển không** (PR 5). *Khuyến nghị:* có. Ghi vào cả hai, đọc từ Redis, so sánh
   và ghi log lệch; chỉ chuyển nguồn đọc sang Postgres ở PR 6 sau khi log không còn lệch.

## Lược đồ tối thiểu (PR 4)

| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `orders` | một đơn của khách: dòng hàng (JSON có ảnh chụp giá), tổng, địa chỉ, 4 trạng thái riêng | `id` nội bộ; `web_ref` duy nhất |
| `payment_attempts` | mỗi lần bấm thanh toán: `vnp_txn_ref` **duy nhất**, số tiền, trạng thái, `vnp_transaction_no`, thời điểm | nhiều lần thử cho một đơn |
| `webhook_inbox` | mỗi IPN/querydr nhận được, nguyên văn đã bỏ chữ ký | để đối soát, không dùng làm quyết định |
| `outbox_jobs` | việc cần làm: `create_sapo_order`, `query_vnpay` | `run_after`, `attempts`, `last_error`, khoá chống chạy song song |
| `sapo_mappings` | `order_id` ↔ id/tên đơn Sapo | thay việc tra Sapo theo tag làm khoá chống trùng chính |

Bốn trạng thái tách riêng trên `orders`: `order_status`, `payment_status`, `integration_status` (Sapo), `fulfillment_status`.
`Reservation`, `SyncAttempt`, `AuditLog` để T15 (giữ tồn, admin).

## Các PR

| PR | Việc | Chạm đường tiền? | Kiểm chứng |
|---|---|---|---|
| **4** | Thêm `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`; `lib/db/schema.ts`, `lib/db/client.ts`, migration đầu; **không đổi hành vi** | Không (chưa nối) | Migration chạy trên nhánh Neon dev; test truy vấn bằng Postgres thật (một nhánh Neon, không mock); CI vẫn không cần bí mật |
| **5** | `startCheckout` ghi `orders` + `payment_attempts` song song với Redis (câu 3); IPN và querydr cập nhật cả hai | **Có** | Đơn sandbox thật → có dòng trong DB khớp Redis; IPN cũ vẫn chạy; log "lệch" bằng 0 qua nhiều đơn |
| **6** | IPN ghi `payment_status` + job `create_sapo_order` **trong một transaction** rồi mới trả `00`; worker (xử lý ngay sau trả lời + QStash) tạo đơn Sapo; job `query_vnpay` cho thanh toán "chờ" quá 2 phút bất kể có ai mở `/success` hay không | **Có** | Đơn sandbox → `00` nhanh, đơn Sapo do worker tạo; IPN lặp → `02`, không có job thứ hai; làm hỏng Sapo trên preview → job thử lại + cảnh báo; **đóng tab ngay sau khi trả → đơn vẫn tự vào Sapo** (đây là lỗ hổng #1039) |

Mỗi PR: `npm test`, `typecheck`, `lint`, `build`; `reviewer` bắt buộc (chạm `lib/order.ts`, `lib/store.ts`); `doc-writer`; **hỏi bạn
trước khi push** vì push là deploy.

## Rủi ro đã biết

- **Hai nguồn sự thật trong PR 5.** Nếu ghi Postgres lỗi thì không được chặn thanh toán (Redis vẫn là nguồn đọc); lỗi chỉ log và
  cảnh báo. Ngược lại ở PR 6 phải ghi Postgres thành công **trước** khi trả `00` cho VNPAY.
- **Giới hạn gọi Sapo (bộ đệm 40 lệnh, đo 2026-10-07):** worker thử lại phải có giãn cách, không được dồn cục.
- **Neon cold start** vài trăm ms trên Hobby: IPN vẫn phải trả lời trong vài giây; PR 6 đo lại `durationMs` của IPN.
- **QStash chưa dùng lần nào** (biến môi trường có từ 2026-10-06): PR 6 phải kiểm chữ ký người gọi và chạy thử trên preview.

**Cổng: không viết code cho tới khi Neon được bật (câu 1) và bạn nói "bắt đầu T14".**
