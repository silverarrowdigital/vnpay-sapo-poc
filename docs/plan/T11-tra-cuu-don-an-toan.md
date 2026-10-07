# T11 — Tra cứu đơn khó đoán hơn (mục "Cần sửa ngay" #2 trong doc tiến độ)

**Trạng thái (2026-10-07): ĐÃ LÀM XONG CODE, CHƯA COMMIT, CHƯA DEPLOY.** Các quyết định đã chốt (bạn bảo làm theo khuyến nghị) và kết quả kiểm chứng nằm ở cuối file.

## Vấn đề, đo từ code

- Tra cứu đơn (`lookupOrder`, `lib/order.ts`) mở bằng **mã tham chiếu + số điện thoại**. Mã là `yyyyMMddHHmmss` (GMT+7)
  cộng 6 chữ số ngẫu nhiên (`createTxnRef`, `lib/vnpay.ts`), nên với một giây đã biết chỉ có ~10^6 khả năng.
- Số điện thoại là yếu tố thứ hai duy nhất, và là thứ nhiều người quen biết nhau có sẵn. Giới hạn hiện có: 10 lượt
  mỗi 15 phút mỗi IP (`RATE_POLICIES.lookup`), sai SĐT và không có đơn trả cùng một câu (quy tắc bảo mật 12).
- Master plan yêu cầu "token khó đoán hoặc OTP". Hiện chưa đạt.
- Trang `/success` mở chỉ bằng mã (đã bỏ dòng địa chỉ từ 06/10, có giới hạn 120 lượt/10 phút), nên nó không phải
  đường lộ địa chỉ, nhưng vẫn cho biết một mã có thật hay không.

## Ai làm gì

| Việc | Ai |
|---|---|
| Chốt 3 quyết định dưới đây | Chủ shop / bạn |
| Chọn nhà cung cấp SMS và mở tài khoản (chỉ nếu chọn phương án C) | Chủ shop |
| Code, test đơn vị, kiểm chứng trên sandbox | Claude, sau khi bạn nói bắt đầu |

## Cần bạn chốt

1. **Cách làm khó đoán.**
   - **A. Kéo dài phần ngẫu nhiên của mã (khuyến nghị).** Đổi 6 chữ số thành 16 ký tự chữ-số (~80 bit) trong
     `createTxnRef`. VNPAY cho `vnp_TxnRef` dài tới 100 ký tự chữ-số. Không cần dịch vụ ngoài, không cần đổi luồng,
     không cần nhớ thêm gì. Đổi lại: khách phải gõ/dán mã dài hơn; mã đã phát hành trước đây (6 chữ số) vẫn tra được.
   - B. Thêm một "mã tra cứu" riêng, ngẫu nhiên, lưu trong `note_attributes` của đơn Sapo và hiện ở `/success`.
     Giữ mã VNPAY như cũ. Phức tạp hơn A mà lợi ích như nhau.
   - C. OTP qua SMS. Chắc nhất, nhưng cần nhà cung cấp SMS, tiền theo tin nhắn và thêm một dịch vụ ngoài, trái với
     nguyên tắc "không dịch vụ thứ ba" của dự án này.
2. **Giới hạn tốc độ.** Giữ 10 lượt/15 phút/IP, hay thêm trục theo số điện thoại như COD đã có (khuyến nghị: thêm,
   5 lượt/giờ/SĐT, vì IP xoay được).
3. **Mã cũ.** Nếu chọn A: mã 6 chữ số của đơn đã có vẫn dùng được (khuyến nghị), hay chặn?

## Việc phải làm nếu chọn A (khuyến nghị)

1. `lib/vnpay.ts` `createTxnRef`: phần ngẫu nhiên 16 ký tự chữ-số từ `crypto.randomInt`/`randomBytes`; giữ tiền tố
   thời gian để vẫn sắp xếp được. Kiểm tra độ dài toàn mã ≤ 100 và chỉ chứa ký tự VNPAY cho phép.
2. Mọi chỗ đang giả định "6 chữ số": regex `^[0-9]{6,40}$` trong `lookupOrder` và các route, ô nhập ở
   `components/OrderLookup.tsx`, các regex của `/success` và `/api/vnpay/*`. Cần grep hết trước khi sửa.
3. `lib/order.ts`: thêm trục SĐT cho `lookup` nếu chốt câu 2.
4. Test đơn vị trong `lib/vnpay.test.ts` (độ dài, bộ ký tự, không trùng trong 10.000 lần sinh) và `lib/order.test.ts`
   (trục SĐT, sai SĐT vẫn giống không có đơn).
5. `reviewer` bắt buộc: chạm `lib/vnpay.ts` và `lib/order.ts` (đường tiền).
6. Cập nhật `CLAUDE.md` (quy tắc 6 và 12, mục Known limitations) qua `doc-writer`.

## Nghiệm thu

- `npm test`, `typecheck`, `lint`, `build` đạt.
- Một đơn VNPAY sandbox thật: URL VNPAY mang mã mới, IPN `00`, đơn Sapo có tag `vnpay-<mã mới>`, tra cứu bằng mã
  mới + đúng SĐT ra đơn, sai SĐT và mã lạ cùng một câu 404. Đơn test xoá sau đó (xoá không hoàn kho).
- Mã cũ 6 chữ số của một đơn đã có vẫn tra được (nếu chốt giữ).

## Rủi ro đã biết

- Đổi định dạng mã chạm vào chữ ký VNPAY và vào tag Sapo dùng để chống trùng đơn. Nếu một chỗ nào còn giả định 6
  chữ số, hậu quả có thể là IPN trả `01` cho một khoản đã thu. Vì vậy bước 2 (grep hết) và đơn sandbox thật là bắt buộc.
- Bản ghi đơn chờ trong Redis của production có thể còn mã cũ lúc deploy; phải đọc được cả hai dạng.

**Cổng (đã qua): code chỉ được viết sau khi bạn chốt 3 câu và nói bắt đầu.**

## Đã chốt (2026-10-07, theo đúng khuyến nghị)

1. **Phương án A.** Mã mới = 14 chữ số giờ GMT+7 + 16 ký tự ngẫu nhiên lấy từ 32 ký hiệu (chữ số và chữ in hoa, bỏ I, L, O, U) = 30 ký tự, 80 bit (`createTxnRef`, `lib/vnpay.ts`). Bỏ I/L/O/U để khách đọc, gõ lại không nhầm.
2. **Thêm trục theo số điện thoại**: `lookupPhone` 5 lượt/giờ, khoá theo 9 chữ số cuối của SĐT, chỉ tính khi mã đúng dạng; giữ nguyên `lookup` 10 lượt/15 phút/IP.
3. **Mã cũ (20 chữ số) vẫn tra được.** `TXN_REF_PATTERN` nhận đúng dạng cũ hoặc dạng mới; `normaliseTxnRef` cắt khoảng trắng và đổi chữ hoa cho thứ khách gõ. Dùng ở `lookupOrder`, `lib/alert.ts` và ô điền sẵn của `/tra-cuu-don`.
4. `matchesRef` (`lib/sapo.ts`) so tag Sapo không phân biệt hoa/thường, vì chưa biết Sapo có giữ nguyên chữ hoa của tag hay không.

**Đánh đổi đã chấp nhận:** ai biết SĐT của một khách và tạo được một chuỗi đúng dạng mã có thể dùng hết 5 lượt/giờ của SĐT đó, khiến khách thật tra không được trong một giờ (đơn vẫn không bị lộ).

## Đã kiểm chứng (2026-10-07)

- Test: 81 test đạt (trước đó 75). Mới có: hình dạng và tính không trùng của `createTxnRef` (10.000 lần sinh), pattern, normalise, `lookupOrder` (mã viết thường, sai SĐT giống không có đơn, mã sai dạng không tốn lượt, 5 lượt/giờ/SĐT qua nhiều IP). `typecheck`, `lint`, `build` đạt. `reviewer` không thấy lỗi nghiêm trọng; các mục nên sửa (pattern chặt, comment cũ, độ dài mã trong test, tag không phân biệt hoa thường) đã sửa.
- Chạy thật trên `next dev` cục bộ, Sapo thật và VNPAY sandbox:
  - **Mã cũ** `20261007122617412151` (Test Product 2 x1, 80.000₫ = 50.000 + 30.000 ship): thanh toán sandbox thật, IPN `00`, đơn Sapo #1037 `paid` tổng 80.000. `/success` hiện dòng hàng và tổng tiền nhưng **không có địa chỉ giao** (grep HTML không thấy đường, phường, quận; chỉ có địa chỉ doanh nghiệp ở chân trang). Tra cứu với đúng SĐT ra đơn kèm địa chỉ; sai SĐT trả 404 cùng một câu như mã không có.
  - **Mã mới** `202610071231096AG1E2XQ171NNBEE`: trang VNPAY hiện "Chọn phương thức thanh toán (Test)" với mã 30 ký tự (VNPAY chấp nhận; chưa trả tiền qua trang thẻ). Sau đó IPN giả lập có ký (`npm run simulate:ipn`) trả `00` và tạo đơn #1038, gửi lại trả `02`. Tra theo mã in hoa và in thường, đúng SĐT (cả dạng +84) ra đơn; sai SĐT 404.
  - Lần tra đầu tiên vài giây sau khi tạo đơn trả "không có", vài giây sau tra lại thì thấy (Sapo lập chỉ mục tag chậm; chưa tìm nguyên nhân).
- Đơn #1037 và #1038 đã xoá theo id (DELETE 200, không còn đơn nào dưới tag đó). **Xoá không hoàn kho**: tồn của Test Product 2 đang là 37 (trước là 38), shop cần chỉnh tồn thực tế về 38 bằng tay.

## Chưa kiểm chứng, không coi là sự thật

- Sapo có lưu tag đúng chữ hoa/thường ban đầu hay không.
- Mã cũ đi qua code tra cứu mới trên Sapo thật (mới chỉ có unit test).
- Chốt chặn trùng đơn phía Sapo khi IPN lặp lại (lần lặp trả `02` từ trạng thái đã lưu, chưa chạm tới Sapo).
- Kiểm tra đột biến (mutation) cho các test mới chưa làm.
- Chưa commit, chưa deploy; bản ghi chờ trong Redis của production phải đọc được cả hai dạng mã khi deploy (đã có pattern nhận cả hai, nhưng chưa thử trên production).
