#!/usr/bin/env node
/**
 * DEV-ONLY: simulate a VNPAY IPN against your running app, signed with your own
 * VNPAY_HASH_SECRET. Use it to test the IPN → Sapo half of the flow on localhost,
 * where the real VNPAY sandbox cannot reach your IPN URL.
 *
 * Usage (Node 20.6+):
 *   node --env-file=.env.local scripts/simulate-ipn.mjs <txnRef> <amountVnd> [responseCode] [baseUrl]
 *
 *   txnRef       the "Reference" shown on the result page / returned by /api/checkout
 *   amountVnd    the order total in VND, e.g. 100000
 *   responseCode "00" (success, default), "24" (cancelled), "51" (failed)...
 *   baseUrl      defaults to http://localhost:3000
 *
 * The signing code mirrors lib/vnpay.ts (sorted params, urlencode, HMAC-SHA512).
 */
import { createHmac } from "node:crypto";

const [txnRef, amountVnd, responseCode = "00", baseUrl = "http://localhost:3000"] = process.argv.slice(2);
if (!txnRef || !amountVnd) {
  console.error("Usage: node --env-file=.env.local scripts/simulate-ipn.mjs <txnRef> <amountVnd> [responseCode] [baseUrl]");
  process.exit(1);
}
const secret = process.env.VNPAY_HASH_SECRET;
const tmnCode = process.env.VNPAY_TMN_CODE ?? "TESTCODE";
if (!secret) {
  console.error("VNPAY_HASH_SECRET is not set (did you pass --env-file=.env.local?)");
  process.exit(1);
}

const enc = (v) =>
  encodeURIComponent(v)
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");

const now = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace(/\D/g, "").slice(0, 14);
const params = {
  vnp_Amount: String(Number(amountVnd) * 100),
  vnp_BankCode: "NCB",
  vnp_CardType: "ATM",
  vnp_OrderInfo: `Thanh toan don hang ${txnRef}`,
  vnp_PayDate: now,
  vnp_ResponseCode: responseCode,
  vnp_TmnCode: tmnCode,
  vnp_TransactionNo: String(Date.now()).slice(-8),
  vnp_TransactionStatus: responseCode === "00" ? "00" : "02",
  vnp_TxnRef: txnRef,
};
const data = Object.keys(params)
  .sort()
  .map((k) => `${enc(k)}=${enc(params[k])}`)
  .join("&");
const hash = createHmac("sha512", secret).update(Buffer.from(data, "utf-8")).digest("hex");
const url = `${baseUrl.replace(/\/+$/, "")}/api/vnpay/ipn?${data}&vnp_SecureHash=${hash}`;

const res = await fetch(url);
console.log(`HTTP ${res.status}`, await res.text());
