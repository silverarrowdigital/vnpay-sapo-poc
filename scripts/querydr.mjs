#!/usr/bin/env node
/**
 * Ask VNPAY what actually happened to a transaction (API 2.1.0 `querydr`), for an order stuck in
 * `pending` or `sapo_error`.
 *
 * Docs: https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
 *
 *   npm run querydr -- <txnRef> [transactionDate]
 *
 * **Its checksum is not the payment URL's checksum.** The payment URL sorts its parameters by key
 * and joins them `key=value&…`; querydr joins nine *values* with `|` in a fixed order and nothing
 * else:
 *
 *   vnp_RequestId | vnp_Version | vnp_Command | vnp_TmnCode | vnp_TxnRef
 *     | vnp_TransactionDate | vnp_CreateDate | vnp_IpAddr | vnp_OrderInfo
 *
 * Signing it the other way produces a well-formed request that answers `97` (invalid checksum), so
 * this file deliberately does not share code with `lib/vnpay.ts` — the two schemes look alike
 * enough that one helper serving both would eventually be "tidied" into a single wrong one.
 *
 * `vnp_TransactionDate` is the original transaction's time, `yyyyMMddHHmmss` in GMT+7. A txnRef
 * from this project already starts with exactly that (timestamp + 6 random digits), so it is
 * derived from the reference unless given explicitly.
 *
 * This script **only reads**. It never creates a Sapo order: when VNPAY confirms a payment it
 * prints the one command that does (`npm run simulate:ipn`), which runs the same verified IPN path
 * a real notification would. Reconciliation stays a decision a person makes.
 */
import { createHmac } from "node:crypto";

const [refArg, dateArg] = process.argv.slice(2);

const tmnCode = process.env.VNPAY_TMN_CODE;
const hashSecret = process.env.VNPAY_HASH_SECRET;
const endpoint = process.env.VNPAY_QUERYDR_URL ?? "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction";

if (!refArg) {
  console.error("Cách dùng: npm run querydr -- <txnRef> [transactionDate yyyyMMddHHmmss]");
  process.exit(1);
}
if (!tmnCode || !hashSecret) {
  console.error("Thiếu VNPAY_TMN_CODE / VNPAY_HASH_SECRET trong .env.local.");
  process.exit(1);
}

const txnRef = refArg.trim();
const transactionDate = (dateArg ?? txnRef.slice(0, 14)).trim();
if (!/^\d{14}$/.test(transactionDate)) {
  console.error(
    `Không suy ra được vnp_TransactionDate từ "${txnRef}". Hãy truyền thêm tham số yyyyMMddHHmmss (GMT+7).`,
  );
  process.exit(1);
}

/** yyyyMMddHHmmss in GMT+7, whatever the machine's own timezone is. */
function vnpDate(date) {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

const requestId = `${vnpDate(new Date())}${Math.floor(Math.random() * 1_000_000)
  .toString()
  .padStart(6, "0")}`;
const createDate = vnpDate(new Date());
const orderInfo = `Truy van giao dich ${txnRef}`;
const ipAddr = "127.0.0.1";
const version = "2.1.0";
const command = "querydr";

// The nine values, in the documented order. Order is the whole specification here.
const signData = [requestId, version, command, tmnCode, txnRef, transactionDate, createDate, ipAddr, orderInfo].join(
  "|",
);
const secureHash = createHmac("sha512", hashSecret).update(Buffer.from(signData, "utf-8")).digest("hex");

const body = {
  vnp_RequestId: requestId,
  vnp_Version: version,
  vnp_Command: command,
  vnp_TmnCode: tmnCode,
  vnp_TxnRef: txnRef,
  vnp_OrderInfo: orderInfo,
  vnp_TransactionDate: transactionDate,
  vnp_CreateDate: createDate,
  vnp_IpAddr: ipAddr,
  vnp_SecureHash: secureHash,
};

const RESPONSE_CODES = {
  "00": "Yêu cầu thành công",
  "02": "Mã định danh kết nối (TmnCode) không hợp lệ",
  "03": "Dữ liệu gửi sang không đúng định dạng",
  "91": "Không tìm thấy giao dịch",
  "94": "Yêu cầu bị trùng trong thời gian giới hạn của API",
  "97": "Checksum không hợp lệ",
  "99": "Lỗi không xác định",
};

const TRANSACTION_STATUS = {
  "00": "Giao dịch thanh toán thành công",
  "01": "Giao dịch chưa hoàn tất",
  "02": "Giao dịch bị lỗi",
  "04": "Giao dịch đảo (khách đã bị trừ tiền tại ngân hàng nhưng GD chưa thành công ở VNPAY)",
  "05": "VNPAY đang xử lý giao dịch hoàn tiền",
  "06": "VNPAY đã gửi yêu cầu hoàn tiền sang ngân hàng",
  "07": "Giao dịch bị nghi ngờ gian lận",
  "09": "Hoàn tiền bị từ chối",
};

console.log(`Truy vấn ${txnRef} (vnp_TransactionDate ${transactionDate})…\n`);

let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
} catch (err) {
  console.error("Lỗi mạng khi gọi VNPAY:", err.message);
  process.exit(1);
}

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  console.error(`VNPAY trả về không phải JSON (HTTP ${res.status}):`, text.slice(0, 400));
  process.exit(1);
}

const code = String(json.vnp_ResponseCode ?? "");
const status = String(json.vnp_TransactionStatus ?? "");
const amountVnd = json.vnp_Amount !== undefined ? Number(json.vnp_Amount) / 100 : undefined;

console.log(`  vnp_ResponseCode     ${code} — ${RESPONSE_CODES[code] ?? "?"}`);
console.log(`  vnp_TransactionStatus ${status} — ${TRANSACTION_STATUS[status] ?? "?"}`);
console.log(`  vnp_Message          ${json.vnp_Message ?? ""}`);
console.log(`  vnp_TransactionNo    ${json.vnp_TransactionNo ?? ""}`);
console.log(`  vnp_BankCode         ${json.vnp_BankCode ?? ""}`);
console.log(`  vnp_PayDate          ${json.vnp_PayDate ?? ""}`);
console.log(`  Số tiền              ${amountVnd !== undefined ? amountVnd.toLocaleString("vi-VN") + "đ" : ""}`);

if (code === "97") {
  console.log(
    "\n97 nghĩa là chữ ký sai, không phải giao dịch sai. Kiểm tra VNPAY_HASH_SECRET và thứ tự chín giá trị nối bằng | ở đầu file này.",
  );
  process.exit(2);
}
if (code === "91") {
  console.log("\nVNPAY không có giao dịch nào với mã này: khách chưa từng tới trang thanh toán, hoặc sai txnRef.");
  process.exit(0);
}
if (code !== "00") {
  process.exit(2);
}

if (status === "00") {
  console.log("\n✔ VNPAY xác nhận ĐÃ THU TIỀN. Đơn này đáng được tạo trong Sapo.");
  console.log("  Kiểm tra trong Sapo trước (tag vnpay-" + txnRef + "); nếu chưa có đơn, chạy:\n");
  console.log(`    npm run simulate:ipn -- ${txnRef} ${amountVnd ?? "<amountVnd>"}\n`);
  console.log(
    "  Lệnh đó đi qua đúng đường IPN đã được xác minh (checksum của chính ta, chống trùng hai lớp),\n" +
      "  nên chạy lại lần hai chỉ trả 02 chứ không tạo đơn thứ hai.",
  );
} else if (status === "04") {
  console.log("\n⚠ Giao dịch đảo: khách bị trừ tiền ở ngân hàng nhưng VNPAY chưa ghi nhận thành công.");
  console.log("  ĐỪNG tạo đơn từ đây. Đây là việc phải đối soát với VNPAY/ngân hàng.");
} else {
  console.log("\nKhông phải giao dịch thành công — không tạo đơn.");
}
