# T14 — Sổ giao dịch trên Postgres (PR 4–6 của kế hoạch sprint)

**Trạng thái (2026-10-08): PR 4 xong. PR 5 xong và đã kiểm chứng trên production. PR 6 xong ở dạng "quét đơn" (sweep). PR 6b
(IPN ghi sổ trong một transaction rồi mới trả lời VNPAY) đã code và đã review, CHƯA commit, CHƯA deploy, mới có unit test (xem
[T14-6b](T14-6b-ipn-ghi-so-truoc.md)).** Neon đã được chủ tài khoản bật (Production và Preview dùng chung **một** database).
Còn lại: deploy và kiểm 6b bằng một thanh toán sandbox thật, đọc từ Postgres thay Redis, PR 7–10 (xem cuối trang).

## Vì sao cần

Mọi thứ về một giao dịch từng nằm trong **một bản ghi JSON trong Redis, sống 7 ngày** (`lib/store.ts`, `PendingOrder`). Hệ quả đã
gặp hoặc đã đo:

- Không có nơi nào liệt kê "đơn chờ": Redis không quét được khoá, nên việc hỏi VNPAY khi mất IPN (T13.0) chỉ chạy được khi **có
  người mở `/success`**. Khách đóng tab trước thì không ai hỏi (đơn #1039 thoát được vì tôi đang nhìn log).
- Trạng thái trộn một enum duy nhất `pending/processing/completed/sapo_error/cancelled/failed`: không tách được "đã trả tiền" khỏi
  "đã ghi vào Sapo".
- Mỗi lần bấm thanh toán là một `txnRef` và một "đơn" mới; không có khái niệm nhiều lần thử cho một đơn.
- Hết hạn là mất: một khoản đã thu nhưng bản ghi biến mất thì IPN trả `01` và chỉ còn email cảnh báo.

## Những gì đã chốt

Neon qua Vercel Marketplace · Drizzle · QStash cho việc chạy định kỳ (Hobby chỉ cho cron một lần/ngày) · mỗi việc một PR.
Quyết định về dữ liệu khách (câu 2 cũ): **giữ 90 ngày** rồi xoá tên, SĐT, email, địa chỉ khỏi sổ (chính sách bảo mật đã sửa thành
90 ngày). Câu 3 cũ: **ghi song song Redis và Postgres, Redis vẫn là nguồn đọc** — và đang chạy đúng như vậy.

## Lược đồ (PR 4, `lib/db/schema.ts`, `drizzle/0000_ledger.sql`)

| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `orders` | một đơn của khách: dòng hàng, tổng, địa chỉ, **4 trạng thái riêng** | cột `purge_after` mặc định now()+90 ngày |
| `payment_attempts` | mỗi lần bấm thanh toán | `vnp_txn_ref` **duy nhất** |
| `webhook_inbox` | mỗi IPN/querydr nhận được, nguyên văn đã **bỏ chữ ký** | để đối soát, không dùng để quyết định |
| `outbox_jobs` | việc cần làm | đã tạo bảng ở PR 4; **PR 6b dùng** làm hàng đợi việc `create_sapo_order` (thêm cột `dedupe_key` + index duy nhất, migration `0001_outbox_dedupe.sql`; chưa deploy) |
| `sapo_mappings` | `order_id` ↔ đơn Sapo | |

Migration chạy ở đầu `npm run build` (`scripts/migrate.mjs`): **không bao giờ làm hỏng build**, **bỏ qua khi build preview** (vì
preview dùng chung database production), hết hạn kết nối 10 giây, tổng 60 giây.

## Các PR

| PR | Việc | Trạng thái |
|---|---|---|
| **4** | Lược đồ + migration + `lib/db/client.ts` (commit `be7dbb9`) | ✅ Xong. Log build Vercel: "migrate: schema is up to date" trên Neon |
| **5** | `lib/ledger.ts` ghi đơn, thanh toán, kết quả Sapo, bằng chứng webhook vào Postgres song song với Redis; xoá dữ liệu khách sau 90 ngày (commit `511d65e`) | ✅ Xong và **đã kiểm chứng trên production** (xem dưới) |
| **6** | `lib/sweep.ts` + `app/api/jobs/sweep/route.ts`: tự quét đơn VNPAY chờ và đơn đã trả tiền nhưng chưa vào Sapo, kể cả khi khách đã đóng tab (commit `a41c659`) | ✅ Xong code, đã chạy trên production; **chưa từng cứu một đơn mất IPN thật** |
| **6b** | IPN ghi trạng thái thanh toán + job `create_sapo_order` **trong một transaction trước khi trả `00`**, dùng `outbox_jobs` | 🔧 **Đã code và review (2026-10-08), chưa commit, chưa deploy, mới có unit test** (229 test đạt ở máy; chưa chạy với Neon hay production). Xem [T14-6b](T14-6b-ipn-ghi-so-truoc.md) |

Mỗi PR: `npm test`, `typecheck`, `lint`, `build`; `reviewer` bắt buộc (chạm `lib/order.ts`, `lib/store.ts`); `doc-writer`; hỏi
trước khi push vì push là deploy.

## Kết quả 2026-10-07

**PR 4–5, đo trên production bằng một thanh toán sandbox thật (đơn #1042, đã xoá):**
- Log có `ledger.ok` cho checkout, payment, sapo, webhook và compare; **không có `ledger.mismatch`**.
- Nhưng IPN trả lời mất **5,5 giây** (trước đó khoảng 2,4 giây) vì lần gọi Neon đầu tiên sau một lúc rảnh mất khoảng 2 giây. Chưa
  tìm cách giảm; xem "Rủi ro".
- Cách làm sổ an toàn cho tiền: mọi lần ghi bị chặn ở 4 giây, lỗi bị nuốt, sau một lần lỗi thì nghỉ 30 giây (đọc không làm
  nghỉ), pool tối đa 3 kết nối. Nội dung lỗi được làm sạch vì câu lệnh lỗi của drizzle chứa cả SQL lẫn tham số (có dữ liệu khách):
  chỉ ghi mã lỗi Postgres. Trạng thái không bao giờ đi lùi.
- Xoá dữ liệu khách sau 90 ngày: cron Vercel hằng ngày `/api/cron/purge` (cần `Authorization: Bearer CRON_SECRET`; đã thử không
  có thì trả **401**). Redis nay giữ bản ghi 7 ngày.

**PR 6, đo trên production:**
- Một lời gọi do QStash ký lúc 12:15:01Z ghi `sweep.run candidates 0` (không có đơn nào cần quét). Một POST không chữ ký trả
  **401** và ghi `sweep.unauthorised`.
- Lịch QStash `vnpay-sapo-sweep-production` chạy **mỗi 5 phút** (tạo bằng `scripts/qstash-schedule.mjs`); thêm một cron Vercel
  hằng ngày 21:00 UTC làm "nhịp tim" (chỉ thấy đơn trong 2 giờ gần nhất, không thay được QStash).
- **Chưa kiểm chứng:** việc sweep cứu một đơn mất IPN thật. Chỉ có test đơn vị.

**Giới hạn của VNPAY sandbox, đo 2026-10-07:** sau khi **một** lệnh `querydr` được nhận, các lệnh tiếp theo trả `vnp_ResponseCode
94` trong khoảng **5 phút**, dù cùng mã đơn hay mã đơn khác (nhận lúc 18:52:16; bị từ chối sau +9 giây, +79 giây, +3 phút 39,
+4 phút 40; nhận lại lúc +4 phút 52; mã đơn khác chỉ 1 giây sau một lệnh được nhận cũng bị từ chối). **Chưa biết** VNPAY
production có giới hạn này không. Cách xử lý trong code:
- một "khoá nghỉ" dùng chung cho cả terminal (`querydr-cooldown`, 290 giây; chỉ 60 giây sau khi gặp 94);
- trang `/success` chỉ được hỏi VNPAY khi **trình duyệt đã quay về với chữ ký VNPAY ghi "đã trả"** (`markPaidReturn`); đây chỉ là
  gợi ý, không đổi trạng thái đơn nào;
- đơn đã được xác nhận trả tiền nhưng Sapo từ chối (`sapo_error`/`processing`) được thử lại từ bản ghi trong sổ, **không cần gọi
  VNPAY**;
- khi một đơn "đã trả" mà đạt giới hạn số lần hỏi, hoặc đã quá 105 phút chưa được xác nhận, hệ thống **gửi mail cho chủ shop**
  (`alertUnsettledPaidReturn`) — nếu đã bật cảnh báo (xem dưới).

**Sweep, các giới hạn:** tối đa 10 đơn mỗi lần chạy; mỗi mã đơn hỏi tối đa 5 lần (đang chờ) hoặc 8 lần (đã trả mà chưa vào
Sapo); ngân sách 20 giây mỗi lần chạy. Ưu tiên: đơn có dấu "đã trả" trước, rồi đơn ít bị hỏi nhất, rồi đơn mới nhất.

**Email (Resend):** chủ shop đã bật Resend (`RESEND_API_KEY` cho Production và Preview, người gửi `onboarding@resend.dev`, chưa có
tên miền riêng). Hai biến mới `CONTACT_EMAIL` và `ALERT_EMAIL` (tên cũ `…_TO` vẫn được đọc nếu thiếu) **chưa được đặt** trên Vercel
— chủ shop sẽ tự thêm (địa chỉ thử, đổi sau). Nên **form liên hệ và cảnh báo vẫn đang tắt**, chưa có thư nào từng được gửi, và
việc Resend nhận trường `reply_to` **chưa kiểm chứng**.

## Giới hạn phải nói thật

- Sweep **không cứu được đơn tạo trước khi có sổ** (sổ chỉ có đơn từ PR 5 trở đi).
- Vì `querydr` chỉ cho khoảng 1 lần/5 phút/terminal (ở sandbox), nếu **nhiều** IPN mất cùng lúc thì chỉ cứu được khoảng **một đơn
  mỗi 5 phút**.
- **Gói Neon Free (chủ shop xác nhận 2026-10-07):** 100 giờ tính toán mỗi tháng, tự tắt sau 5 phút rảnh (trang gói của Neon). Hỏi cơ sở dữ liệu mỗi 5 phút sẽ giữ nó thức gần như cả ngày, khoảng 180 giờ tính toán mỗi tháng, nên bộ quét **chỉ mở kết nối khi có dấu hiệu trong Redis** (30 phút sau một lần thanh toán được bắt đầu, 2 giờ sau khi trình duyệt nhận chữ ký "đã trả"; commit 3b5f99d). **Chưa đo** số giờ thực dùng trong một tháng.
- Chưa đo lại LCP sau khi thêm bộ nhớ đệm 30 giây cho trang danh sách.
- Production và Preview dùng **chung một database** nên preview không được chạy migration và lịch sweep chỉ trỏ vào production.
  Biến Neon là "sensitive" của Vercel, không kéo về máy được; vì vậy test dùng PGlite thay vì Neon thật.

## Còn lại

- **PR 6b**: đã code (IPN ghi thanh toán + job trong một transaction **trước** khi trả `00`). Còn: commit, deploy (hỏi trước), xem
  log build có "migrate: schema is up to date", một thanh toán sandbox thật, đo độ trễ IPN. Chỉ sau đó mới coi là đóng lỗ hổng
  "VNPAY nhận `00` rồi máy chủ chết".
- Chuyển nguồn đọc từ Redis sang Postgres (chỉ khi log không còn lệch).
- PR 7–10 của kế hoạch sprint (gồm nhánh Neon riêng cho mỗi preview, rồi mới bật migration trên preview).

## Rủi ro đã biết

- **Hai nguồn sự thật.** Ghi Postgres lỗi không được chặn thanh toán (Redis vẫn là nguồn đọc): lỗi chỉ log. Ở PR 6b thì ngược lại,
  phải ghi thành công trước khi trả `00`.
- **Giới hạn gọi Sapo (bộ đệm 40 lệnh, đo 2026-10-07):** các lần thử lại phải có giãn cách. Sweep đã bị chặn theo số lần và theo ngân sách thời gian.
- **Neon khởi động nguội:** lần gọi đầu sau lúc rảnh mất khoảng 2 giây (đo trên production, làm IPN chậm lên 5,5 giây). VNPAY vẫn
  nhận được `00`, nhưng cần xem lại khi làm PR 6b vì khi đó việc ghi nằm **trước** câu trả lời. Transaction của 6b bị chặn ở 4 giây
  rồi về đường cũ; **độ trễ thật chưa đo**, và **chưa biết VNPAY chờ câu trả lời IPN bao lâu**.
- **PR 6b, những điều CHƯA kiểm chứng (2026-10-08):** chưa chạy với Neon hay trên production; chưa có thanh toán sandbox thật nào đi
  qua đường mới; "Sapo lỗi thật rồi job tự thử lại" chỉ có unit test (không có nhánh Neon riêng để thử); thư `sapo_gave_up` cần
  `ALERT_EMAIL`, chưa biết đã đặt.
- **PR 6b, lỗi nhỏ biết trước và để lại:** tải lại `/success` của một đơn đang `sapo_error`/`processing` tốn một lần thử của job và
  bỏ qua thời gian lùi; job và việc hỏi VNPAY dùng chung ngân sách 20 giây của sweep; nếu `scripts/migrate.mjs` lỗi thì build vẫn
  thành công và 6b âm thầm quay về đường cũ — sau khi deploy phải xem log build Vercel có dòng "migrate: schema is up to date".
