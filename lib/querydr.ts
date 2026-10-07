/**
 * Ask VNPAY what happened to a payment (API 2.1.0 `querydr`), server-side. Server-only.
 *
 * Why this exists (T13.0): on 2026-10-07 VNPAY took 361,200 VND and never sent the IPN, so the order
 * existed nowhere but in a customer's browser. The IPN is a push; this is the pull that covers a push
 * that never came. `lib/order.ts` `reconcilePendingPayment` decides **when** to ask and routes the
 * answer through the same settlement as an IPN — this module only speaks the protocol.
 *
 * Docs: https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
 *
 * **Two checksums, both unlike the payment URL's** (see also scripts/querydr.mjs, which keeps its own
 * copy of the request side on purpose):
 *
 * - the request joins nine *values* with `|`:
 *   RequestId | Version | Command | TmnCode | TxnRef | TransactionDate | CreateDate | IpAddr | OrderInfo
 * - the response joins fifteen, with an absent field as an empty string:
 *   ResponseId | Command | ResponseCode | Message | TmnCode | TxnRef | Amount | BankCode | PayDate |
 *   TransactionNo | TransactionType | TransactionStatus | OrderInfo | PromotionCode | PromotionAmount
 *
 * The response order is from the docs and was **checked against a live sandbox answer on 2026-10-07**
 * (a real transaction: our own HMAC-SHA512 over those fifteen values equalled `vnp_SecureHash`).
 * An answer that does not verify is treated as no answer — never as "not paid" and never as "paid".
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getQueryDrUrl, getVnpayConfig } from "./config";
import { errorMessage, log } from "./log";
import { formatVnpDate, type VnpParams } from "./vnpay";

// Short, because this runs while a customer's result page is rendering (T13.0).
const TIMEOUT_MS = 6_000;

const RESPONSE_FIELDS = [
  "vnp_ResponseId",
  "vnp_Command",
  "vnp_ResponseCode",
  "vnp_Message",
  "vnp_TmnCode",
  "vnp_TxnRef",
  "vnp_Amount",
  "vnp_BankCode",
  "vnp_PayDate",
  "vnp_TransactionNo",
  "vnp_TransactionType",
  "vnp_TransactionStatus",
  "vnp_OrderInfo",
  "vnp_PromotionCode",
  "vnp_PromotionAmount",
] as const;

function hmac(secret: string, data: string): string {
  return createHmac("sha512", secret).update(Buffer.from(data, "utf-8")).digest("hex");
}

/** The request body, signed. `now` and `requestId` are injectable so a test can pin the checksum. */
export function buildQueryDrBody(
  cfg: { tmnCode: string; hashSecret: string },
  txnRef: string,
  now: Date = new Date(),
  requestId: string = `${formatVnpDate(now)}${randomInt(0, 1_000_000).toString().padStart(6, "0")}`,
): Record<string, string> {
  const createDate = formatVnpDate(now);
  // vnp_TransactionDate is the original payment's time. A reference starts with exactly that.
  const transactionDate = txnRef.slice(0, 14);
  const orderInfo = `Truy van giao dich ${txnRef}`;
  const ipAddr = "127.0.0.1";
  const signData = [requestId, "2.1.0", "querydr", cfg.tmnCode, txnRef, transactionDate, createDate, ipAddr, orderInfo].join("|");
  return {
    vnp_RequestId: requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "querydr",
    vnp_TmnCode: cfg.tmnCode,
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_TransactionDate: transactionDate,
    vnp_CreateDate: createDate,
    vnp_IpAddr: ipAddr,
    vnp_SecureHash: hmac(cfg.hashSecret, signData),
  };
}

/** Constant-time check of the response's own checksum. */
export function verifyQueryDrResponse(res: Record<string, unknown>, hashSecret: string): boolean {
  const given = res.vnp_SecureHash;
  if (typeof given !== "string") return false;
  const data = RESPONSE_FIELDS.map((k) => (res[k] === undefined || res[k] === null ? "" : String(res[k]))).join("|");
  const expected = Buffer.from(hmac(hashSecret, data), "utf-8");
  const actual = Buffer.from(given.toLowerCase(), "utf-8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A verified querydr answer, reshaped as the parameters an IPN carries, so one settlement function
 * serves both. In querydr `vnp_ResponseCode` says the *query* worked and `vnp_TransactionStatus` says
 * the payment did; the IPN's success rule (both `00`) therefore means the same thing here.
 */
export function queryDrToIpnParams(res: Record<string, unknown>): VnpParams {
  const out: VnpParams = {};
  for (const k of ["vnp_TmnCode", "vnp_TxnRef", "vnp_Amount", "vnp_BankCode", "vnp_PayDate", "vnp_TransactionNo", "vnp_ResponseCode", "vnp_TransactionStatus"]) {
    const v = res[k];
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

export type QueryDrResult =
  | { ok: true; params: VnpParams }
  | { ok: false; reason: "not_configured" | "network" | "bad_response" | "bad_checksum" | "not_found_or_error" | "rate_limited" };

/** Never throws. Logs the reference and a reason, never the answer's body. */
export async function queryVnpayTransaction(txnRef: string): Promise<QueryDrResult> {
  let cfg;
  let url: string | undefined;
  try {
    cfg = getVnpayConfig();
    url = getQueryDrUrl();
  } catch (err) {
    log.error("querydr.config_error", { error: errorMessage(err) });
    return { ok: false, reason: "not_configured" };
  }
  if (url === undefined) {
    log.warn("querydr.no_endpoint", { txnRef });
    return { ok: false, reason: "not_configured" };
  }

  let json: Record<string, unknown>;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildQueryDrBody(cfg, txnRef)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    json = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    log.warn("querydr.failed", { txnRef, error: errorMessage(err) });
    return { ok: false, reason: "network" };
  }
  if (typeof json !== "object" || json === null) return { ok: false, reason: "bad_response" };

  // A "no such transaction" answer (91) and a checksum error (97) come back without our fields, and
  // are not signed the same way; both mean there is nothing to act on.
  // 94: "duplicate request within the API's time limit". Measured on the sandbox on 2026-10-07: after
  // one querydr was accepted, every further one — for the same reference or another — answered 94 for
  // about five minutes (accepted at 18:52:16, refused at +9 s, +79 s, +3 m 39 s and +4 m 40 s, accepted
  // again at +4 m 52 s). So this is not a signal about the payment: it means "ask later".
  if (json.vnp_ResponseCode === "94") {
    log.info("querydr.rate_limited", { txnRef });
    return { ok: false, reason: "rate_limited" };
  }
  if (json.vnp_ResponseCode !== "00") {
    log.info("querydr.not_a_payment", { txnRef, responseCode: String(json.vnp_ResponseCode ?? "") });
    return { ok: false, reason: "not_found_or_error" };
  }
  if (!verifyQueryDrResponse(json, cfg.hashSecret)) {
    log.warn("querydr.invalid_signature", { txnRef });
    return { ok: false, reason: "bad_checksum" };
  }
  // Only a payment (type 01) is a payment. A refund (02 full, 03 partial) is also answered with
  // status 00, and treating it as one would create an order for money that has been given back.
  // Checked live on 2026-10-07: a genuine payment answers "01".
  if (json.vnp_TransactionType !== "01") {
    log.info("querydr.not_a_payment", { txnRef, transactionType: String(json.vnp_TransactionType ?? "") });
    return { ok: false, reason: "not_found_or_error" };
  }
  // The answer must be about our terminal and our reference, not merely signed.
  if (json.vnp_TmnCode !== cfg.tmnCode || json.vnp_TxnRef !== txnRef) {
    log.warn("querydr.mismatch", { txnRef });
    return { ok: false, reason: "bad_response" };
  }
  return { ok: true, params: queryDrToIpnParams(json) };
}
