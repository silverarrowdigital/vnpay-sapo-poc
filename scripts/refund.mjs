#!/usr/bin/env node
/**
 * Refund a VNPAY transaction (API 2.1.0 `refund`).
 *
 * Docs: https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
 *
 *   npm run refund -- <txnRef>                  # DRY RUN: prints what it would send
 *   npm run refund -- <txnRef> --confirm        # actually refunds, in full
 *   npm run refund -- <txnRef> 150000 --confirm # partial refund of 150,000đ
 *
 * **It is a dry run unless `--confirm` is passed, and that default is the point.** A refund moves
 * real money out and cannot be taken back: VNPAY answers `94` ("đã được gửi yêu cầu hoàn tiền
 * trước đó") to a second attempt, so there is no undo and no second try. The dry run prints the
 * exact body, the exact checksum source string, and the order as Sapo currently holds it, so the
 * person pressing the button can see what they are about to refund.
 *
 * **Three traps, all of them in the signing.**
 *
 * 1. The refund checksum is **not** the payment URL's checksum. The URL sorts its parameters by key
 *    and joins `key=value`; refund joins thirteen *values* with `|` in a fixed order.
 * 2. It is also **not** querydr's checksum, which joins nine. Sharing one helper between the three
 *    would eventually be "tidied" into a single wrong one, so this file signs its own.
 * 3. **`vnp_OrderInfo` is last in the checksum but eighth in the body.** The order of the JSON
 *    fields and the order of the signed values genuinely differ, and following the body order gives
 *    a well-formed request that answers `97`.
 *
 * What it does **not** do: touch Sapo. Recording the refund on the order needs a write we have not
 * verified (`POST /admin/orders/{id}/refunds.json` is plausible — the nested resource reads fine —
 * but it has never been exercised here, and guessing at a write that moves stock and money is how
 * you corrupt a shop's books). The script prints what to do in the Sapo admin instead.
 */
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const positional = args.filter((a) => !a.startsWith("--"));
const [refArg, amountArg] = positional;

const tmnCode = process.env.VNPAY_TMN_CODE;
const hashSecret = process.env.VNPAY_HASH_SECRET;
const endpoint = process.env.VNPAY_QUERYDR_URL ?? "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction";

// A production payment URL with the default (sandbox) endpoint would aim a refund at the wrong
// system. Refuse before anything is built, dry run included.
if (process.env.VNPAY_PAYMENT_URL && !process.env.VNPAY_QUERYDR_URL && !/\/\/sandbox\.vnpayment\.vn\//.test(process.env.VNPAY_PAYMENT_URL)) {
  console.error("VNPAY_PAYMENT_URL không phải sandbox nhưng VNPAY_QUERYDR_URL chưa đặt: dừng lại để không gửi hoàn tiền nhầm hệ thống.");
  process.exit(1);
}
const createBy = process.env.VNPAY_REFUND_CREATE_BY ?? "shop-admin";

const storeDomain = process.env.SAPO_STORE_DOMAIN;
const sapoKey = process.env.SAPO_API_KEY;
const sapoSecret = process.env.SAPO_API_SECRET;

if (!refArg) {
  console.error("Cách dùng: npm run refund -- <txnRef> [amountVnd] [--confirm]");
  process.exit(1);
}
if (!tmnCode || !hashSecret) {
  console.error("Thiếu VNPAY_TMN_CODE / VNPAY_HASH_SECRET trong .env.local.");
  process.exit(1);
}

const txnRef = refArg.trim();

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

/**
 * Pull the genuine VNPAY references out of the Sapo order rather than asking a person to copy them.
 * `vnp_TransactionNo` and `vnp_PayDate` are written into `note_attributes` when the order is
 * created, which is exactly what a refund needs — and reading them back means the refund is aimed
 * at the transaction Sapo actually recorded, not at one typed from memory.
 */
async function readSapoOrder() {
  if (!storeDomain || !sapoKey || !sapoSecret) return undefined;
  const auth = Buffer.from(`${sapoKey}:${sapoSecret}`).toString("base64");
  for (const method of ["vnpay", "cod"]) {
    const qs = new URLSearchParams({ tag: `${method}-${txnRef}`, limit: "5" });
    let res;
    try {
      res = await fetch(`https://${storeDomain}/admin/orders.json?${qs}`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return undefined;
    }
    if (!res.ok) return undefined;
    const { orders } = await res.json();
    const order = (orders ?? []).find((o) =>
      (o.note_attributes ?? []).some((a) => (a.name === "order_ref" || a.name === "vnp_TxnRef") && a.value === txnRef),
    );
    if (order) {
      const attr = (name) => (order.note_attributes ?? []).find((a) => a.name === name)?.value;
      return {
        name: order.name,
        id: order.id,
        method,
        financialStatus: order.financial_status,
        totalPrice: Number(order.total_price ?? 0),
        transactionNo: attr("vnp_TransactionNo"),
        payDate: attr("vnp_PayDate"),
      };
    }
  }
  return undefined;
}

const order = await readSapoOrder();

if (order === undefined) {
  console.error(
    `Không tìm thấy đơn Sapo nào cho mã ${txnRef}.\n` +
      "Hoàn tiền cần vnp_TransactionNo và vnp_TransactionDate của giao dịch gốc, mà chúng nằm trong\n" +
      "note_attributes của đơn. Nếu đơn chưa từng được tạo, hãy chạy `npm run querydr -- " +
      txnRef +
      "` trước\n" +
      "để lấy chúng từ VNPAY, rồi hoàn tiền qua cổng merchant.",
  );
  process.exit(1);
}
if (order.method === "cod") {
  console.error(
    `Đơn ${order.name} là đơn COD — chưa từng có tiền qua VNPAY, nên không có gì để hoàn.\n` +
      "Nếu đã thu tiền mặt thì việc hoàn là thao tác ngoài hệ thống, ghi lại trong Sapo.",
  );
  process.exit(1);
}
if (!order.transactionNo || !order.payDate) {
  console.error(
    `Đơn ${order.name} thiếu vnp_TransactionNo hoặc vnp_PayDate trong note_attributes.\n` +
      `Chạy \`npm run querydr -- ${txnRef}\` để lấy chúng từ VNPAY.`,
  );
  process.exit(1);
}

const fullAmount = order.totalPrice;
const amountVnd = amountArg === undefined ? fullAmount : Number(amountArg);
if (!Number.isFinite(amountVnd) || amountVnd <= 0 || !Number.isInteger(amountVnd)) {
  console.error(`Số tiền hoàn không hợp lệ: ${amountArg}`);
  process.exit(1);
}
if (amountVnd > fullAmount) {
  console.error(`Không hoàn được ${amountVnd.toLocaleString("vi-VN")}đ: đơn ${order.name} chỉ có ${fullAmount.toLocaleString("vi-VN")}đ.`);
  process.exit(1);
}

// 02 = hoàn toàn phần, 03 = hoàn một phần (tài liệu VNPAY).
const transactionType = amountVnd === fullAmount ? "02" : "03";

const requestId = `${vnpDate(new Date())}${Math.floor(Math.random() * 1_000_000)
  .toString()
  .padStart(6, "0")}`;
const createDate = vnpDate(new Date());
const orderInfo = `Hoan tien don hang ${txnRef}`;
const ipAddr = "127.0.0.1";
const version = "2.1.0";
const command = "refund";
const amountX100 = String(Math.round(amountVnd * 100));

// THE signing order. Note vnp_OrderInfo at the END — it sits eighth in the body below.
const signData = [
  requestId,
  version,
  command,
  tmnCode,
  transactionType,
  txnRef,
  amountX100,
  order.transactionNo,
  order.payDate,
  createBy,
  createDate,
  ipAddr,
  orderInfo,
].join("|");
const secureHash = createHmac("sha512", hashSecret).update(Buffer.from(signData, "utf-8")).digest("hex");

const body = {
  vnp_RequestId: requestId,
  vnp_Version: version,
  vnp_Command: command,
  vnp_TmnCode: tmnCode,
  vnp_TransactionType: transactionType,
  vnp_TxnRef: txnRef,
  vnp_Amount: amountX100,
  vnp_OrderInfo: orderInfo,
  vnp_TransactionNo: order.transactionNo,
  vnp_TransactionDate: order.payDate,
  vnp_CreateBy: createBy,
  vnp_CreateDate: createDate,
  vnp_IpAddr: ipAddr,
  vnp_SecureHash: secureHash,
};

const RESPONSE_CODES = {
  "00": "Yêu cầu thành công",
  "02": "Mã định danh kết nối (TmnCode) không hợp lệ",
  "03": "Dữ liệu gửi sang không đúng định dạng",
  "91": "Không tìm thấy giao dịch",
  "94": "Giao dịch đã được gửi yêu cầu hoàn tiền trước đó",
  "95": "Giao dịch này không thành công bên VNPAY",
  "97": "Checksum không hợp lệ",
  "99": "Lỗi không xác định",
};

console.log(`Đơn Sapo        ${order.name} (id ${order.id})`);
console.log(`Trạng thái      ${order.financialStatus}`);
console.log(`Tổng đơn        ${fullAmount.toLocaleString("vi-VN")}đ`);
console.log(`vnp_TxnRef      ${txnRef}`);
console.log(`vnp_TransactionNo ${order.transactionNo}  |  vnp_PayDate ${order.payDate}`);
console.log(
  `\nSẼ HOÀN         ${amountVnd.toLocaleString("vi-VN")}đ  (${transactionType === "02" ? "toàn phần" : "một phần"})`,
);
console.log(`Người yêu cầu   ${createBy}   (đặt VNPAY_REFUND_CREATE_BY để đổi)`);

// if/else rather than an early process.exit: exiting while the Sapo fetch's socket is still
// closing makes Node on Windows print an assertion failure after the output, which reads like a
// crash in a script whose whole job is to look harmless until you mean it.
if (!confirm) {
  console.log("\n--- CHẠY THỬ, chưa gửi gì cả ---");
  console.log("\nChuỗi ký (13 giá trị nối bằng |):");
  console.log("  " + signData);
  console.log("\nBody sẽ gửi:");
  console.log("  " + JSON.stringify(body, null, 2).split("\n").join("\n  "));
  console.log(
    "\nHoàn tiền KHÔNG hoàn lại được: gửi lần hai sẽ nhận mã 94. Khi đã chắc, thêm --confirm:\n" +
      `  npm run refund -- ${txnRef}${amountArg ? " " + amountArg : ""} --confirm`,
  );
} else {
  await sendRefund();
}

async function sendRefund() {
console.log("\nĐang gửi yêu cầu hoàn tiền tới VNPAY…");
let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
} catch (err) {
  console.error("Lỗi mạng khi gọi VNPAY:", err.message);
  console.error("KHÔNG rõ yêu cầu đã tới hay chưa. Chạy `npm run querydr -- " + txnRef + "` để kiểm trước khi thử lại.");
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
console.log(`\n  vnp_ResponseCode  ${code} — ${RESPONSE_CODES[code] ?? "?"}`);
console.log(`  vnp_Message       ${json.vnp_Message ?? ""}`);
console.log(`  vnp_TransactionNo ${json.vnp_TransactionNo ?? ""}`);
console.log(`  vnp_TransactionType ${json.vnp_TransactionType ?? ""}`);
console.log(`  vnp_TransactionStatus ${json.vnp_TransactionStatus ?? ""}`);

if (code === "00") {
  console.log(
    `\n✔ VNPAY đã nhận yêu cầu hoàn ${amountVnd.toLocaleString("vi-VN")}đ.\n\n` +
      "CÒN PHẢI LÀM BẰNG TAY TRONG SAPO — script này cố ý không ghi gì vào Sapo:\n" +
      `  1. Mở đơn ${order.name}: https://${storeDomain ?? "<store>"}/admin/orders/${order.id}\n` +
      "  2. Ghi nhận hoàn tiền cho đúng số tiền trên, để sổ sách khớp với VNPAY\n" +
      "  3. Nếu hàng được trả lại, cộng lại tồn kho — đơn hàng không tự hoàn kho\n" +
      "  4. Ghi lý do hoàn vào note của đơn, để sau này đối soát còn đọc được",
  );
} else if (code === "94") {
  console.log("\nGiao dịch này đã được yêu cầu hoàn trước đó. Không gửi lại — kiểm trong cổng merchant VNPAY.");
  process.exitCode = 2;
} else {
  console.log("\nHoàn tiền KHÔNG thành công. Không có tiền nào chuyển đi.");
  if (code === "97") console.log("97 là lỗi chữ ký, không phải lỗi giao dịch: xem thứ tự 13 giá trị ở đầu file này.");
  process.exitCode = 2;
}
}
