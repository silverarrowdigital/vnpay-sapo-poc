#!/usr/bin/env node
/**
 * DEV/RECOVERY: replay a real VNPAY callback at our own IPN endpoint.
 *
 * VNPAY signs the Return URL with the same secret and the same algorithm as the IPN, so the
 * query string the browser landed on can be replayed verbatim to /api/vnpay/ipn and will pass
 * the checksum. Use it when VNPAY could not reach your IPN URL (localhost, tunnel down,
 * Deployment Protection on) but the customer did pay: the signature is genuine, not forged.
 *
 * Usage (quote the URL — it contains & which the shell would otherwise split):
 *   npm run replay-ipn -- "<full return URL or query string>" [baseUrl]
 *
 *   npm run replay-ipn -- "http://localhost:3000/api/vnpay/return?vnp_Amount=70000000&...&vnp_SecureHash=abc"
 *   npm run replay-ipn -- "vnp_Amount=70000000&...&vnp_SecureHash=abc" https://xxxx.ngrok-free.app
 *
 * baseUrl defaults to $APP_BASE_URL, then http://localhost:3000.
 * The query string is passed through untouched — nothing is re-signed.
 */
const [rawInput, baseArg] = process.argv.slice(2);

if (!rawInput) {
  console.error("Usage: npm run replay-ipn -- \"<return URL or query string>\" [baseUrl]");
  console.error("Tip: wrap the URL in quotes, it contains & characters.");
  process.exitCode = 1;
} else {
  const base = (baseArg || process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  // Accept a full URL or a bare query string, with or without a leading "?".
  let query;
  try {
    query = new URL(rawInput).search.replace(/^\?/, "");
  } catch {
    query = rawInput.replace(/^\?/, "");
  }

  const params = new URLSearchParams(query);
  const vnpKeys = [...params.keys()].filter((k) => k.startsWith("vnp_"));

  if (vnpKeys.length === 0) {
    console.error("No vnp_* parameters found in the input. Did you paste the whole Return URL?");
    process.exitCode = 1;
  } else if (!params.get("vnp_SecureHash")) {
    console.error("No vnp_SecureHash in the input — the IPN would answer 97. Paste the full Return URL.");
    process.exitCode = 1;
  } else {
    const target = `${base}/api/vnpay/ipn?${query}`;
    console.log(`Replaying ${vnpKeys.length} vnp_* params to ${base}/api/vnpay/ipn`);
    console.log(`  vnp_TxnRef            : ${params.get("vnp_TxnRef")}`);
    console.log(`  vnp_Amount            : ${params.get("vnp_Amount")} (= ${Number(params.get("vnp_Amount")) / 100} VND)`);
    console.log(`  vnp_ResponseCode      : ${params.get("vnp_ResponseCode")}`);
    console.log(`  vnp_TransactionStatus : ${params.get("vnp_TransactionStatus")}`);
    console.log(`  vnp_TransactionNo     : ${params.get("vnp_TransactionNo")}`);
    console.log();

    try {
      const res = await fetch(target, { redirect: "manual" });
      const body = await res.text();
      console.log(`HTTP ${res.status}`);
      try {
        const json = JSON.parse(body);
        console.log(JSON.stringify(json, null, 2));
        const meaning = {
          "00": "Confirm Success — result recorded (order created when the payment succeeded)",
          "01": "Order not found — this server has no pending order with that txnRef",
          "02": "Already confirmed — a previous IPN handled it (no duplicate order)",
          "04": "Invalid amount — vnp_Amount does not match the stored order",
          "97": "Invalid checksum — wrong hash secret, or the query string was altered",
          "99": "Unknown error — Sapo failed or is processing; VNPAY would retry",
        }[json.RspCode];
        if (meaning) console.log(`\n=> ${meaning}`);
      } catch {
        console.log(body.slice(0, 500));
        console.log("\n=> Response was not JSON. Is that really the IPN endpoint?");
      }
    } catch (err) {
      console.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}
