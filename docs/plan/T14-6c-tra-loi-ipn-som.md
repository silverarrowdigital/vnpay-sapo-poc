# T14 PR 6c — Trả lời VNPAY ngay sau khi sổ đã ghi, tạo đơn Sapo sau

**Trạng thái: CHỜ DUYỆT (2026-10-08). Chưa có dòng code nào.** Thuộc [T14](T14-so-giao-dich-postgres.md), nối tiếp
[PR 6b](T14-6b-ipn-ghi-so-truoc.md) (đã deploy).

## Vì sao

IPN trên production hiện mất **5,66 s** (đo 2026-10-08, đơn #1044, thanh toán sandbox thật; trước khi gộp câu lệnh là 7,40 s):

| Bước (đơn #1044) | Thời gian |
|---|---|
| `commit_paid` (transaction ghi sổ, Neon nguội) | ~2,6 s |
| Tạo đơn Sapo | ~2,2 s |
| Ghi sổ sau Sapo (`sapo`, `compare`, `webhook`) | ~0,9 s |

Sau PR 6b, thanh toán đã **bền** (sổ + job) trước khi Sapo được gọi, nên VNPAY không cần chờ Sapo nữa: trả lời sau `commit_paid`
(~2,7–3 s) và để việc còn lại chạy sau câu trả lời.

**Thành thật về lợi ích:** thời gian VNPAY chờ IPN tối đa **chưa biết** (trang tài liệu đã đọc không ghi). 5,7 s chưa từng làm mất
một IPN nào; lợi ích là giảm rủi ro, không phải sửa lỗi đã xảy ra. Nếu bạn thấy rủi ro đó không đáng, bỏ qua PR này cũng được.

## Thiết kế

1. `handleIpn(params, opts?: { defer?: (work: () => Promise<void>) => void })`. `lib/` vẫn không import `next`: route IPN truyền
   `after` từ `next/server` (Next 16: `after` chạy tới `maxDuration` của route, kể cả khi response đã gửi — đọc ở
   `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`). Không truyền `defer` (test, script) thì mọi thứ
   chạy trước khi trả lời, như hôm nay.
2. Chỉ hoãn khi `ledgerCommitPaid` trả `committed` hoặc `already`. Khi sổ **không dùng được** (`unavailable`) vẫn chạy đồng bộ và
   trả `99` nếu Sapo lỗi — không bao giờ trả `00` mà chưa có gì bền.
3. Thứ tự mới ở nhánh thành công: verify chữ ký → terminal → đơn → số tiền → trạng thái cuối → claim → `commit_paid` → ghi Redis
   `processing` → **đặt dấu `sweep-active`** → trả `00`/`02` → (sau câu trả lời) tạo đơn Sapo → ghi `sapo` + `compare` + `webhook`.
   Dấu `sweep-active` đặt **trước** khi trả lời để nếu tiến trình chết sau câu trả lời, sweep (QStash 5 phút) vẫn thấy job.
4. **Claim Redis giữ tới hết phần hoãn**, không nhả lúc trả lời. Hết hạn 120 s nếu tiến trình chết. IPN lặp trong lúc đó nhận `99`
   ("đang xử lý"), VNPAY thử lại và nhận `02`.
5. Phần hoãn lỗi (Sapo lỗi): làm đúng như hôm nay — đếm lần thử trên job, cảnh báo, không ném lỗi ra ngoài.
6. Sweep/`runSapoJob`: gặp claim đang bị giữ thì **không tính là một lần thử thất bại** (hôm nay có tính), kẻo một job đang chạy
   dở bị đốt mất lần thử.
7. Đường `querydr` và sweep **không đổi** (không truyền `defer`).

## Quyết định cần bạn chốt

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| D1 | Làm PR này, hay để IPN 5,7 s? | **Làm.** Nhỏ, không migration, rollback bằng revert; giảm ~2,7 s |
| D2 | Đặt `maxDuration = 60` cho route IPN? | **Có.** Phần hoãn cần chạy hết Sapo (15 s × 2 lần gọi) mà không chờ mặc định |
| D3 | Thêm log thời gian chi tiết cho `commit_paid` (kết nối vs từng câu lệnh) | **Có**, cùng PR: để biết 2,6 s là kết nối nguội hay 9 câu lệnh — quyết định bước giảm tiếp theo |

## File

`app/api/vnpay/ipn/route.ts` · `lib/order.ts` (`handleIpn`, `settlePayment`, `applyIpnResult`, `runSapoJob`) · `lib/ledger.ts` (log
thời gian) · `lib/order.test.ts` · docs (`CLAUDE.md`, T14, README). Đụng đường tiền ⇒ `reviewer` bắt buộc.

## Test (không mạng, PGlite như PR 6b)

- Có `defer`: `handleIpn` trả `00` **trước khi** `createOrderOnce` được gọi; chạy phần hoãn thì tạo đúng một đơn, job `done`, Redis
  `completed`, claim đã nhả.
- Phần hoãn không bao giờ chạy (mô phỏng chết): job vẫn `pending`, dấu `sweep-active` đã đặt, claim hết hạn → `runSapoJob` hoàn tất,
  tổng cộng một đơn Sapo.
- `unavailable` + `defer` truyền vào: vẫn đồng bộ; Sapo lỗi ⇒ `99`.
- Sapo lỗi trong phần hoãn: job tăng `attempts`, có cảnh báo, không ném lỗi, claim vẫn nhả.
- IPN lặp trong lúc phần hoãn đang chạy ⇒ `99`; sau khi xong ⇒ `02`; hai IPN đồng thời ⇒ một `00`.
- `runSapoJob` gặp claim bị giữ ⇒ `attempts` không tăng.
- Đột biến: trả lời trước khi `commit_paid` xong ⇒ test phải đỏ; nhả claim lúc trả lời ⇒ test IPN lặp phải đỏ.

**Kiểm trên production (đã được phép dùng thanh toán sandbox, đơn thử xoá sau):** một thanh toán NCB; trong log `ipn.response`
phải đến **trước** `sapo.order_created`, `durationMs` kỳ vọng ~3 s; replay callback ⇒ `02`; Sapo đúng một đơn.
**Chưa kiểm được ở đây:** tiến trình bị Vercel dừng thật giữa phần hoãn (chỉ mô phỏng); và việc `after` trên deployment này thật sự
sống đủ lâu — log phải chứng minh bằng cách `sapo.order_created` xuất hiện sau `ipn.response`.

## Rủi ro

1. `after` không được đảm bảo ở mọi tình huống: nếu bị cắt, job `pending` + dấu `sweep-active` ⇒ sweep tạo đơn trong ≤ 5 phút
   (trước 6c: trong vài giây). Đây là điểm đánh đổi chính — **đơn có thể vào Sapo muộn hơn** trong ca xấu.
2. Khách xem `/success` có thể thấy "đang chờ" thêm ~2 s (trang tự làm mới mỗi 3 s).
3. Giờ tính toán Neon: không đổi.

## Rollback

Revert commit rồi push (deploy, hỏi trước). Không migration; job đang chờ vẫn được sweep xử lý.

## Phân việc

Claude: code, test, `reviewer`, `doc-writer`, commit, đo trên production. Chủ shop: duyệt D1–D3; **gate: không code cho tới khi bạn nói
"bắt đầu".**
