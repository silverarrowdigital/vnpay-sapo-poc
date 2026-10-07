/**
 * VNPAY Payment Gateway (API version 2.1.0) — server-side only.
 *
 * Verified against the official sandbox docs:
 *   https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
 *
 * - Payment URL: GET https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?<params>&vnp_SecureHash=<hash>
 * - Checksum: HMAC-SHA512(hashSecret, data) where data = all vnp_* params (except
 *   vnp_SecureHash / vnp_SecureHashType) sorted ascending by key, joined as key=value with '&',
 *   keys and values URL-encoded the same way PHP urlencode() does (space => '+'),
 *   which is what VNPAY's own PHP and NodeJS samples produce.
 * - vnp_Amount = amount in VND * 100. vnp_CreateDate / vnp_ExpireDate = yyyyMMddHHmmss in GMT+7.
 * - The IPN URL is NOT a request parameter; it is configured per terminal in the VNPAY
 *   merchant portal (sandbox: sandbox.vnpayment.vn/merchantv2).
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { VnpayConfig } from "./config";

export type VnpParams = Record<string, string>;

/** PHP urlencode()-compatible encoding (matches VNPAY's reference implementations). */
function vnpEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

/** Build the canonical sign data: sorted, encoded, '&'-joined. */
export function buildSignData(params: VnpParams): string {
  return Object.keys(params)
    .filter((k) => k !== "vnp_SecureHash" && k !== "vnp_SecureHashType")
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${vnpEncode(k)}=${vnpEncode(params[k])}`)
    .join("&");
}

export function sign(params: VnpParams, hashSecret: string): string {
  return createHmac("sha512", hashSecret).update(Buffer.from(buildSignData(params), "utf-8")).digest("hex");
}

/** yyyyMMddHHmmss in GMT+7 regardless of the server's own timezone (Vercel runs in UTC). */
export function formatVnpDate(date: Date): string {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

/**
 * Alphabet of the random part of a reference: digits and upper-case letters without the four that
 * read alike (I, L, O, U), 32 symbols, so each character carries exactly 5 bits.
 */
const TXN_REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TXN_REF_RANDOM_LENGTH = 16;

/**
 * Unique, alphanumeric reference (VNPAY: max 100 chars, must be unique per day): the GMT+7
 * timestamp, then 16 random symbols — 80 bits.
 *
 * randomInt, not Math.random: the reference is what a stranger would have to guess to reach an
 * order. It used to be six digits (a million candidates per timestamp second, T11); 80 bits makes
 * walking references hopeless whatever the rate limit does.
 */
export function createTxnRef(now = new Date()): string {
  let rand = "";
  for (let i = 0; i < TXN_REF_RANDOM_LENGTH; i++) rand += TXN_REF_ALPHABET[randomInt(0, TXN_REF_ALPHABET.length)];
  return `${formatVnpDate(now)}${rand}`;
}

/**
 * Exactly the two shapes we ever issued: the old 20 digits (still in Sapo tags and in customers'
 * hands) and the new 14 digits plus 16 symbols. Anything looser would let junk spend a phone number's
 * lookup tries (`lookupPhone`) and let a one-character typo do the same to a customer. Upper-case only; `normaliseTxnRef` folds a typed
 * reference into it first.
 */
export const TXN_REF_PATTERN = /^(?:[0-9]{20}|[0-9]{14}[0-9A-HJKMNP-TV-Z]{16})$/;

/** What a customer typed → the form we store: trimmed, upper-cased. Digit-only references are unchanged. */
export function normaliseTxnRef(raw: string): string {
  return raw.trim().toUpperCase();
}

/** VNPAY requires an IP string of 7–45 chars; fall back to a safe value when unknown. */
export function normaliseIp(raw: string | null | undefined): string {
  let ip = (raw ?? "").split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip.length >= 7 && ip.length <= 45 ? ip : "127.0.0.1";
}

export interface CreatePaymentUrlInput {
  txnRef: string;
  amountVnd: number;
  orderInfo: string;
  ipAddr: string;
  createdAt?: Date;
  expireMinutes?: number;
  locale?: "vn" | "en";
}

export function createPaymentUrl(config: VnpayConfig, input: CreatePaymentUrlInput): string {
  const created = input.createdAt ?? new Date();
  const expire = new Date(created.getTime() + (input.expireMinutes ?? 15) * 60 * 1000);
  const params: VnpParams = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(Math.round(input.amountVnd * 100)),
    vnp_CurrCode: "VND",
    vnp_TxnRef: input.txnRef,
    // Docs: Vietnamese without diacritics, no special characters.
    vnp_OrderInfo: input.orderInfo.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 255),
    vnp_OrderType: "other",
    vnp_Locale: input.locale ?? "vn",
    vnp_ReturnUrl: config.returnUrl,
    vnp_IpAddr: input.ipAddr,
    vnp_CreateDate: formatVnpDate(created),
    vnp_ExpireDate: formatVnpDate(expire),
  };
  const query = buildSignData(params);
  const hash = sign(params, config.hashSecret);
  return `${config.paymentUrl}?${query}&vnp_SecureHash=${hash}`;
}

/** Keep only vnp_* params from an incoming query string (return URL or IPN). */
export function extractVnpParams(search: URLSearchParams): VnpParams {
  const out: VnpParams = {};
  search.forEach((value, key) => {
    if (key.startsWith("vnp_")) out[key] = value;
  });
  return out;
}

/** Constant-time check of vnp_SecureHash against our own computation. */
export function verifySignature(params: VnpParams, hashSecret: string): boolean {
  const received = (params.vnp_SecureHash ?? "").toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(received)) return false;
  const expected = sign(params, hashSecret);
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Payment succeeded only when BOTH codes are "00". Requiring both is stricter than the
 * minimum in the docs, so an ambiguous notification never creates a Sapo order.
 */
export function isPaymentSuccess(params: VnpParams): boolean {
  return params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00";
}

export const CANCELLED_RESPONSE_CODE = "24";

/** vnp_ResponseCode meanings from the official docs (subset relevant to customers). */
const RESPONSE_MESSAGES: Record<string, string> = {
  "00": "Giao dịch thành công",
  "07": "Trừ tiền thành công nhưng giao dịch bị nghi ngờ",
  "09": "Thẻ/Tài khoản chưa đăng ký InternetBanking",
  "10": "Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần",
  "11": "Đã hết hạn chờ thanh toán",
  "12": "Thẻ/Tài khoản bị khóa",
  "13": "Nhập sai mật khẩu xác thực (OTP)",
  "24": "Khách hàng đã hủy giao dịch",
  "51": "Tài khoản không đủ số dư",
  "65": "Vượt quá hạn mức giao dịch trong ngày",
  "75": "Ngân hàng thanh toán đang bảo trì",
  "79": "Nhập sai mật khẩu thanh toán quá số lần quy định",
  "99": "Lỗi không xác định",
};

export function describeResponseCode(code: string | undefined): string {
  if (!code) return "Không có mã phản hồi";
  return RESPONSE_MESSAGES[code] ?? `Mã lỗi ${code}`;
}

/** IPN response body. VNPAY retries on 01, 04, 97, 99 and stops on 00, 02. */
export type IpnRspCode = "00" | "01" | "02" | "04" | "97" | "99";
export interface IpnResponse {
  RspCode: IpnRspCode;
  Message: string;
}
