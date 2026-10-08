/**
 * Tell the shop owner when a customer's money has been taken and the order cannot be recorded.
 *
 * Until now the only trace of that was a log line nobody reads. It is the one failure in this shop
 * where a customer has paid and nothing happens, so it earns an email.
 *
 * Rules, because this runs inside the IPN and must never make things worse:
 *
 * - **It never throws.** The IPN answers VNPAY whatever happens here; a mail provider that is down
 *   must not turn a recoverable Sapo error into a lost payment confirmation. The provider call is
 *   cut off after 5 s; the two Redis calls around it have no timeout of their own (the Upstash client
 *   is not given one), so "never throws" is guaranteed and "never waits long" is only bounded in
 *   the normal case.
 * - **At most one mail per reference and kind per hour — counted only once a mail was actually
 *   sent.** VNPAY retries a failing IPN every five minutes, up to ten times; without a limit the
 *   owner would get ten emails for one order. But counting *before* sending would let a single
 *   failed send (a timeout, a 429) mute the whole incident for the hour, which is the status quo
 *   this exists to end. A rare duplicate is the acceptable failure; silence is not.
 * - **No customer data in the mail.** A reference, an amount and a status are enough to act on;
 *   names, phones and addresses stay in the order record.
 *
 * Server-only: reads secrets through `lib/config.ts`.
 */
import { getAlertConfig } from "./config";
import { errorMessage, log } from "./log";
import { TXN_REF_PATTERN } from "./vnpay";
import { getOrderStore } from "./store";

export type AlertKind =
  /** VNPAY says a payment succeeded for a reference this shop has no record of. */
  | "paid_no_order"
  /** A payment succeeded but for a different amount than the order was created with. */
  | "amount_mismatch"
  /** A payment succeeded and the Sapo order could not be created. */
  | "sapo_failed"
  /** The background job tried to create the Sapo order 8 times and stopped: only a person can finish it. */
  | "sapo_gave_up";

export interface AlertDetails {
  /** What VNPAY said was paid, in VND. */
  amountVnd?: number;
  vnpTransactionNo?: string;
  /** A short machine-readable reason. Not a Sapo response body: those can carry customer data. */
  reason?: string;
}

const WINDOW_SECONDS = 3600;
const TIMEOUT_MS = 5000;

const SUBJECTS: Record<AlertKind, string> = {
  paid_no_order: "Khách đã trả tiền nhưng hệ thống không có đơn này",
  amount_mismatch: "Khách đã trả tiền nhưng số tiền không khớp đơn",
  sapo_failed: "Khách đã trả tiền nhưng chưa tạo được đơn trong Sapo",
  sapo_gave_up: "CẦN TẠO ĐƠN THỦ CÔNG: khách đã trả tiền, hệ thống đã thử tạo đơn Sapo nhiều lần và dừng",
};

const MEANING: Record<AlertKind, string> = {
  paid_no_order:
    "VNPAY báo thanh toán thành công cho một mã mà cửa hàng không có bản ghi. Có thể bản ghi đã hết hạn (7 ngày), hoặc khách thanh toán từ một bản thử/preview trong khi cổng VNPAY gửi thông báo về bản chính. Tiền đã thu, chưa có đơn.",
  amount_mismatch:
    "VNPAY báo thanh toán thành công nhưng số tiền khác số tiền của đơn. Hệ thống đã từ chối xác nhận, nên đơn chưa được tạo.",
  sapo_failed:
    "Thanh toán đã được xác nhận nhưng việc tạo đơn trong Sapo chưa thành công. Hệ thống tự thử lại: nếu VNPAY chưa nhận phản hồi thành công thì VNPAY gửi lại thông báo (5 phút một lần, tối đa 10 lần); nếu khoản thanh toán đã được ghi vào sổ thì một job nền thử lại (tối đa 8 lần trong khoảng 80 phút) và VNPAY sẽ không gửi lại nữa.",
  sapo_gave_up:
    "Thanh toán đã được xác nhận và ghi vào sổ, nhưng sau 8 lần thử trong khoảng 80 phút, việc tạo đơn trong Sapo vẫn chưa thành công. Hệ thống KHÔNG còn tự thử lại: đơn này cần được tạo thủ công.",
};

/**
 * What to do, per kind. The first step is the same for all of them and is the one that prevents a
 * wrong refund: a signed callback can be replayed (by a customer who saw it in their own browser, or
 * by the operator's own replay tools), so "paid, no order" can be a false alarm for an order that
 * exists and may already have shipped.
 *
 * `npm run refund` is deliberately **not** offered for the two kinds with no Sapo order: it reads the
 * transaction out of the Sapo order and refuses when there is none.
 */
function nextSteps(kind: AlertKind, txnRef: string): string[] {
  const check = [
    `1. Vào Sapo tìm đơn có tag  vnpay-${txnRef}.  Nếu ĐÃ CÓ đơn thì dừng ở đây: thông báo này là một lần phát lại, không có gì mất.`,
    `2. Hỏi VNPAY chuyện gì đã xảy ra:  npm run querydr -- ${txnRef}`,
  ];
  if (kind === "sapo_gave_up") {
    return [
      ...check,
      "3. Nếu Sapo chưa có đơn: tạo đơn thủ công trong Sapo cho khách (lấy tên, địa chỉ, sản phẩm từ trang quản trị hoặc hỏi khách), GẮN TAG vnpay-" +
        txnRef +
        " và ghi mã giao dịch VNPAY vào ghi chú. Thiếu tag này thì một lần tải lại trang /success hoặc một lần phát lại thông báo có thể tạo thêm đơn thứ hai.",
      "4. Không dùng npm run refund cho đến khi có đơn Sapo: nó đọc giao dịch từ đơn Sapo. Muốn hoàn tiền khi không có đơn, liên hệ VNPAY (cách làm trên cổng merchant: chưa kiểm chứng).",
    ];
  }
  if (kind === "sapo_failed") {
    return [
      ...check,
      "3. Chờ: hệ thống tự thử lại (qua VNPAY gửi lại thông báo, hoặc qua job nền nếu khoản thanh toán đã được ghi vào sổ; trường hợp sau sẽ có thư riêng \"CẦN TẠO ĐƠN THỦ CÔNG\" nếu thử hết lần mà vẫn thất bại). Nếu sau ~90 phút vẫn chưa có đơn và không có thư nào nữa, kiểm tra Sapo, rồi chạy lại bằng npm run replay-ipn (hướng dẫn trong CLAUDE.md, mục Recovering a paid order) hoặc tạo đơn thủ công với tag vnpay-" + txnRef + ". Lưu ý: replay-ipn cần dòng log return.received của đúng giao dịch này (chỉ có nếu trình duyệt của khách đã quay về).",
      "   Nếu thư nói Sapo đã trả lời HTTP 2xx nhưng không đọc được, đơn CÓ THỂ đã được tạo: bước 1 sẽ cho biết.",
    ];
  }
  return [
    ...check,
    "3. Nếu querydr xác nhận đã thu tiền (00/00) và Sapo không có đơn: tạo đơn thủ công trong Sapo cho khách, gắn tag vnpay-" +
      txnRef +
      " và ghi mã giao dịch VNPAY vào ghi chú (để lần sau bước 1 tìm thấy và npm run refund dùng được), hoặc liên hệ VNPAY để hoàn tiền (cách làm trên cổng merchant: chưa kiểm chứng).",
    "4. Không dùng npm run replay-ipn với bản chính (sẽ bị từ chối lại) — trừ khi khách đặt từ một bản preview/local: khi đó replay về đúng bản đó. Bỏ qua gợi ý npm run simulate:ipn của querydr và KHÔNG sửa số tiền cho khớp: tự ký một thông báo khớp sẽ tạo đơn \"đã thanh toán\" cho khoản tiền VNPAY chưa thu. npm run refund cần có đơn Sapo nên không dùng được ở đây.",
  ];
}

function formatBody(kind: AlertKind, txnRef: string, d: AlertDetails): string {
  const lines = [
    MEANING[kind],
    "",
    `Mã giao dịch: ${txnRef}`,
    d.amountVnd !== undefined ? `Số tiền VNPAY ghi nhận: ${d.amountVnd.toLocaleString("vi-VN")}₫` : undefined,
    d.vnpTransactionNo ? `Mã giao dịch VNPAY: ${d.vnpTransactionNo}` : undefined,
    d.reason ? `Lý do: ${d.reason}` : undefined,
    "",
    "Việc cần làm:",
    ...nextSteps(kind, txnRef),
    "",
    "Thư này không chứa thông tin cá nhân của khách. Tối đa một thư mỗi mã mỗi giờ.",
  ];
  return lines.filter((l): l is string => l !== undefined).join("\n");
}

/**
 * The reference ends up in a subject line and a store key. The value is bound to VNPAY's signature,
 * so this is defence in depth: anything that is not one of our two shapes is replaced, not trusted.
 */
function safeRef(txnRef: string): string {
  return TXN_REF_PATTERN.test(txnRef) ? txnRef : "(ma-khong-hop-le)";
}

function dedupeKey(kind: AlertKind, ref: string): string {
  return `alert:${kind}:${ref}`;
}

/** Has a mail of this kind already gone out for this reference in the current window? */
async function alreadyTold(kind: AlertKind, ref: string): Promise<boolean> {
  try {
    return (await getOrderStore().count(dedupeKey(kind, ref))) > 0;
  } catch (err) {
    // A store that cannot be read cannot dedupe. Better a repeated email than none about lost money.
    log.warn("alert.dedupe_failed", { kind, txnRef: ref, error: errorMessage(err) });
    return false;
  }
}

/** Record that a mail went out. Failing to record only risks a duplicate, so it is never fatal. */
async function markTold(kind: AlertKind, ref: string): Promise<void> {
  try {
    await getOrderStore().hit(dedupeKey(kind, ref), WINDOW_SECONDS);
  } catch (err) {
    log.warn("alert.dedupe_failed", { kind, txnRef: ref, error: errorMessage(err) });
  }
}

/**
 * Send one alert. Resolves in every case; reports its own failure through the log.
 * Returns whether an email was handed to the provider, for tests and for the log.
 */
export async function sendAlert(kind: AlertKind, txnRef: string, details: AlertDetails = {}): Promise<boolean> {
  const ref = safeRef(txnRef);
  try {
    const cfg = getAlertConfig();
    if (cfg === undefined) {
      // The line production had before alerts existed, now with a name an operator can search for.
      log.error("alert.not_configured", { kind, txnRef: ref, amountVnd: details.amountVnd, reason: details.reason });
      return false;
    }
    if (await alreadyTold(kind, ref)) {
      log.info("alert.suppressed_duplicate", { kind, txnRef: ref });
      return false;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.from,
        to: [cfg.to],
        subject: `[Cần xử lý] ${SUBJECTS[kind]} — ${ref}`,
        text: formatBody(kind, ref, details),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body is not logged: it can echo the recipient address. Not counted either, so the next
      // IPN retry tries again.
      log.error("alert.send_failed", { kind, txnRef: ref, status: res.status });
      return false;
    }
    await markTold(kind, ref);
    log.info("alert.sent", { kind, txnRef: ref });
    return true;
  } catch (err) {
    log.error("alert.send_failed", { kind, txnRef: ref, error: errorMessage(err) });
    return false;
  }
}
