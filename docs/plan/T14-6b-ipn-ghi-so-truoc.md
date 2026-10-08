# T14 PR 6b — IPN ghi sổ trong một transaction rồi mới trả lời VNPAY

**Duyệt 2026-10-08**, không chỉnh sửa; D1–D5 theo khuyến nghị. Thuộc [T14](T14-so-giao-dich-postgres.md).

## Mục tiêu

Chỉ trả `00` khi **(a)** đơn đã có trong Sapo, **hoặc (b)** thanh toán + job `create_sapo_order` đã được commit trong **cùng một
transaction** Postgres. Đóng lỗ hổng "VNPAY nhận `00` rồi máy chủ chết trước khi Sapo có đơn". Trước 6b chỉ có (a); sổ là best-effort.

## Quyết định (đã chốt)

| # | Câu hỏi | Chốt |
|---|---|---|
| D1 | Đã commit mà Sapo lỗi → `00` hay `99`? | **`00`**: thử lại chuyển từ VNPAY sang job của mình, có cảnh báo |
| D2 | Tạo đơn Sapo ngay trong IPN hay `after()`? | **Ngay trong IPN** như trước; đo xong mới tính `after()` |
| D3 | DB lỗi → `99` hay đường cũ? | **Đường cũ**: Neon sập thì rủi ro đúng bằng trước 6b |
| D4 | Biến môi trường tắt nhanh? | **Không**; rollback bằng revert |
| D5 | Worker? | **Sweep hiện có** (QStash 5 phút + cron ngày); đặt `sweep-active` khi job còn chờ |

## Thứ tự trong handler

1. Verify chữ ký → `97`. 2. Đơn trong Redis → `01` (+ cảnh báo) / `99` nếu Redis lỗi. 3. Số tiền → `04` (+ cảnh báo).
4. Redis đã kết thúc → `02`. 5. Claim Redis chéo instance → `99` nếu đang bận. 6. Không thành công (vd `24`) → như cũ, `00`.
7. **`ledgerCommitPaid`** — một transaction: upsert `orders` + `payment_attempts` từ bản ghi Redis (đơn mà lần ghi lúc checkout bị
   lỡ vẫn vào sổ), `SELECT … FOR UPDATE` attempt, chuyển `paid` (cả `orders.payment_status`), `INSERT outbox_jobs … ON CONFLICT
   (dedupe_key) DO NOTHING`. Trả `committed` | `already` (đã `paid` từ trước) | `unavailable` (không DB, breaker, lỗi, quá 4 s,
   attempt đã `refunded`).
8. Redis `processing`. 9. Tạo đơn Sapo ngay (`createOrderOnce`, vẫn tra tag). 10. Trả lời theo bảng.

| Tình huống | Trước 6b | Sau 6b |
|---|---|---|
| Sai chữ ký / không có đơn / sai tiền / Redis đã kết thúc | `97` / `01` / `04` / `02` | Giữ nguyên |
| Commit (`committed`), Sapo được | `00` | `00`, job `done` |
| Commit (`committed`), **Sapo lỗi** | `99` | **`00`**, job chờ với `run_after` lùi dần, Redis `sapo_error`, cảnh báo |
| Sổ đã `paid` từ trước (`already`) | — | không thêm job; thử Sapo; **`02`** |
| `unavailable` | — | **đường cũ**: Sapo được `00`, lỗi `99` |
| Commit xong, ghi Redis lỗi | `99` | `00` (job đã bền) |

**Worker:** sweep lấy job đến hạn **trước** danh sách hỏi VNPAY; mỗi job đi qua `settlePayment(ledgerPaidParams(ref))` — đúng cửa
cũ, security rule 2 không đổi. Lùi 1, 2, 5, 10, 15, 20, 30 phút; lần thứ 8 thất bại → job `failed` + cảnh báo. Đơn đã trả có job thì
không còn nằm trong nhánh "unsynced" của danh sách hỏi (tránh thử Sapo hai đường mỗi lần chạy).

**Điều chỉnh khi thiết kế chi tiết (trước khi code):** không dùng `locked_until` để khoá job. Mọi đường tới Sapo đã đi qua claim Redis
(`SET NX EX`, chéo instance) trong `settlePayment`, nên khoá thứ hai trong Postgres chỉ thêm một chỗ để lệch nhau. `outbox_jobs`
chỉ giữ trạng thái, số lần và giờ thử lại.

## File

`lib/db/schema.ts` + `drizzle/0001_*.sql` (cột `outbox_jobs.dedupe_key` + unique index, chỉ thêm) · `lib/ledger.ts` · `lib/order.ts`
· `lib/sweep.ts` · `app/api/jobs/sweep/route.ts` · test: `lib/ledger.test.ts`, `lib/order.test.ts`, `lib/sweep.test.ts`,
`lib/db/schema.test.ts` · docs.

## Test

Không mạng; DB là PGlite. Commit nguyên tử (lỗi giữa chừng → rollback, không nửa dòng); gọi lại → `already`, một job; không DB /
timeout / breaker / thiếu index → `unavailable`, không ném; `refunded` không thành `paid`; lùi và giới hạn 8 lần. IPN: `97`, `04`,
`01` không mở transaction; commit + Sapo được/lỗi → `00`; `unavailable` + Sapo lỗi → `99`; trùng sau `completed` → `02`; trùng sau
"commit rồi chết" → `02`, một job, Sapo tối đa một lần; hai IPN đồng thời → một `00`; mã `24` → không job; Redis lỗi sau commit →
`00`; đường `querydr` cũng tạo job. Sweep: job đến hạn được chạy, `done`/thử lại/bỏ cuộc + cảnh báo. Đột biến: tách transaction →
test nguyên tử phải fail; `00` khi `unavailable` + Sapo lỗi → test phải fail.

**Production** (chỉ khi chủ shop đồng ý, phiên chính): một thanh toán sandbox thật → `ipn.ledger_committed` → `sapo.order_created`,
job `done`, ghi `durationMs`; `replay-ipn` → `02`; xoá đơn thử. **Không kiểm được ở đây:** Sapo lỗi thật → job tự thử lại (cần
nhánh Neon riêng); chỉ có unit test.

## Rủi ro

1. Độ trễ IPN (Neon nguội ~2 s; trần 4 s rồi về đường cũ). Thời gian VNPAY chờ IPN: **chưa biết**.
2. D1 bỏ cơ chế thử lại của VNPAY khi Sapo lỗi; khôi phục dựa vào sweep (QStash). Cảnh báo chỉ chạy khi đã đặt `ALERT_EMAIL`.
3. Preview dùng chung DB, không chạy migration: thiếu index → `ON CONFLICT` lỗi → `unavailable` → đường cũ.
4. Chống tạo trùng Sapo: claim Redis, `sapo_mappings`, tra tag Sapo (đóng khi lỗi).
5. Giờ tính toán Neon: job chờ giữ sweep thức tối đa 2 giờ mỗi lần lỗi.

## Kết quả 2026-10-08

**Trạng thái: đã code, review, commit (`c8b5abb`) và deploy lên production ngày 2026-10-08. Kết quả kiểm chứng trên production nằm ở mục ngay dưới.**

### Kiểm chứng trên production, 2026-10-08

- Log build Vercel ghi "migrate: schema is up to date" (05:02:36Z), tức migration `0001` đã áp dụng.
- Một thanh toán sandbox thật, mã tham chiếu `20261008120437G5B94VT5ZQQD6X6T` (Test Product 2, 80.000₫, thẻ NCB): log ra
  `ipn.ledger_committed` (committed) → `sapo.order_created` #1043 → job `done` → IPN trả `00`, `durationMs` 7396. VNPAY gửi IPN chưa đến
  0,6 giây sau khi OTP được xác nhận.
- Phát lại đúng callback đã ký của VNPAY → trả `02`, không tạo đơn trùng. Sapo có đúng một đơn (đã trả, 80.000, giao dịch
  sale/success VNPAY); đã xoá theo id (DELETE 200, không còn đơn nào mang tag). Tồn kho Test Product 2 giảm 34 → 33 và **chưa
  được cộng lại**.
- Độ trễ IPN **trước** thay đổi một-câu-lệnh bên dưới: 7396 ms = `commit_paid` ~3,4 s (Neon nguội) + Sapo ~2,4 s + `job_done` 0,22 s
  + `sapo` 0,67 s + `compare` 0,22 s + `webhook` 0,45 s.
- Form liên hệ: `POST /api/contact` trên production lúc 05:03:33Z trả 200 `{ok:true}`, log `contact.sent` lúc 05:03:34Z, nên Resend
  nhận payload (kể cả `reply_to`). Thư có vào hộp thư hay chưa: chủ shop chưa xác nhận; code không ghi mã thư của Resend.
- Mail cảnh báo: **vẫn chưa từng gửi**. Thử kích hoạt bằng một IPN tự ký cho mã chưa phát hành bị bộ phân loại quyền của Claude Code
  chặn. Chủ shop có thể tự chạy: `node --env-file=.env.local scripts/simulate-ipn.mjs 20261008120000999999 1000 00 https://vnpay-sapo-poc.vercel.app`.
  `ALERT_EMAIL` và `CONTACT_EMAIL` đã được chủ shop đặt trên Vercel ngày 2026-10-08.
- Script `querydr` và `refund` chạy ngày 2026-10-08 với `VNPAY_PAYMENT_URL` của production và không có `VNPAY_QUERYDR_URL`: cả hai
  từ chối trước khi gọi mạng.

### Việc làm tiếp sau c8b5abb (đã sửa trong thư mục làm việc, chưa commit)

1. **Kiểm tra terminal của IPN:** sau bước chữ ký (97), thông báo thiếu `vnp_TmnCode` hoặc khác `VNPAY_TMN_CODE` bị trả `01`
   "Order not found", log lỗi `ipn.wrong_terminal`, ghi vào `webhook_inbox`; nếu báo thanh toán thành công thì gửi mail
   `paid_no_order` (lý do nêu cả hai terminal). Không đụng store, sổ hay Sapo.
2. **Dữ liệu cá nhân trong log:** `errorMessage` cắt phần `, command was: …` của `@upstash/redis`; `sapo.order_failed` /
   `cod.order_failed` chỉ log tên các trường Sapo từ chối (`errorFields`); `checkout.created` không còn log tỉnh/thành.
3. **Độ trễ:** ở đường thành công, `ledgerRecordSapo({ok:true})` là **một** câu lệnh SQL (CTE ghi dữ liệu: orders → created, thêm
   `sapo_mappings`, job → done) thay cho bốn lượt gọi. **Con số mới CHƯA đo**; một thanh toán sandbox sau lần deploy tới sẽ đo.
4. Test mới `lib/catalog.test.ts`, `lib/log.test.ts`: 15 file / 239 test đạt, typecheck, lint, build đạt (chỉ ở máy, 2026-10-08).

### Kết quả lúc code xong (trước khi deploy)

**Đã kiểm chứng (chỉ ở máy, 2026-10-08):** `npm test` 13 file / 229 test đạt; typecheck, lint, build đạt (test-runner chạy trước
vài sửa nhỏ cuối; typecheck, lint và test chạy lại sau đó). Test sổ và IPN chạy trên Postgres thật trong tiến trình (PGlite).
Kiểm đột biến, mỗi cái đã hoàn lại: chạy commit không dùng transaction → test rollback fail; trả `00` khi sổ không dùng được mà
Sapo lỗi → 3 test fail. `reviewer` không thấy lỗi nghiêm trọng, nêu 5 mục nên sửa, đã sửa cả 5: (1) mail bỏ cuộc bị chặn bởi
giới hạn một mail mỗi giờ của `sapo_failed` → nay là loại riêng `sapo_gave_up`; (2) nội dung mail `sapo_failed` sai (nay nói VNPAY
**hoặc** job nền thử lại); (3) mất dấu hiệu của sweep; (4) job của preview nằm trong database dùng chung; (5) job "bị bỏ qua"
không được tính lần thử.

**CHƯA kiểm chứng:** chưa chạy với Neon hay production; chưa có thanh toán sandbox thật qua đường mới; độ trễ IPN khi có
transaction chưa đo (trước 6b khoảng 2,4 giây, sau PR 5 là 5,5 giây khi Neon nguội); chưa biết VNPAY chờ câu trả lời IPN bao lâu;
"Sapo lỗi thật rồi job thử lại" chỉ có unit test; `ALERT_EMAIL` chưa biết đã đặt nên mail `sapo_gave_up` có thể không gửi được.

**Lỗi nhỏ để lại:** tải lại `/success` của đơn `sapo_error`/`processing` tốn một lần thử của job và bỏ qua thời gian lùi; job và
việc hỏi VNPAY dùng chung ngân sách 20 giây; nếu `scripts/migrate.mjs` lỗi, build vẫn thành công và 6b âm thầm quay về đường cũ
(cần xem log build có "migrate: schema is up to date").

**Ba chỗ làm khác bản duyệt, có chủ ý:**
1. Không có `locked_until` (đã ghi ở trên): claim Redis trong `settlePayment` đã tuần tự hoá IPN, `querydr` và job.
2. Cron Vercel hằng ngày (có `Bearer CRON_SECRET`) **bỏ qua** cổng `sweep-active`: mỗi ngày đánh thức database một lần, để mất
   dấu hiệu Redis cũng không làm job kẹt mãi. Lần chạy của QStash vẫn tôn trọng cổng.
3. Payload của job mang thêm namespace Redis (`{txnRef, ns}`) và `ledgerDueSapoJobs` lọc theo namespace của deployment, vì
   Production và Preview dùng chung một database nhưng không dùng chung Redis. Một job không có bản ghi "đã trả" dùng được vẫn
   tính là một lần thất bại (không chiếm hàng đợi) và cuối cùng kết thúc bằng cảnh báo `sapo_gave_up`.

Ngoài ra: đơn đã trả có job không còn nằm trong nhánh "unsynced" của sweep; `reconcilePendingPayment` chỉ báo "settled" khi Sapo
không lỗi; `handleIpn` chỉ trả `{RspCode, Message}`. Mục "Test" ở trên đã được viết thành test thật.

## Rollback

Revert + push (deploy, hỏi trước). Migration chỉ thêm; code cũ bỏ qua `dedupe_key`. Job còn chờ lúc revert: 6b vẫn ghi
`integration_status = failed`, nên sweep của PR 6 vẫn quét nhánh "unsynced" (nhánh này chỉ loại đơn có job khi chạy code 6b).

## Phân việc

Claude: code, test, `reviewer`, `doc-writer`, commit; hỏi trước khi push. Chủ shop: đồng ý một thanh toán sandbox thật sau deploy;
nên đặt `ALERT_EMAIL` trước.
