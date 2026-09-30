#!/usr/bin/env node
/**
 * DEV/RECOVERY: drive our own IPN endpoint from the genuine VNPAY callback in the dev log.
 *
 * Why this exists: VNPAY only calls the IPN URL registered in its merchant portal. Until that
 * is configured (or when the tunnel was down), a paid order stays "pending" forever even though
 * the signed callback DID reach us — through the browser, on the Return URL, where
 * app/api/vnpay/return/route.ts logs the raw query string, signature included.
 *
 * This replays that query string verbatim at /api/vnpay/ipn. Nothing is re-signed: the checksum
 * is VNPAY's own, and /api/vnpay/ipn verifies it exactly as it would a real IPN. The return
 * route still never mutates state; the decision still belongs to handleIpn.
 *
 * NOT a substitute for the portal IPN URL in production: the trigger here is the customer's
 * browser coming back, so a customer who closes the tab leaves the order pending.
 *
 * Usage:
 *   npm run replay:last              # replay the most recent return.received
 *   npm run watch:ipn                # follow the log, replay each new callback as it lands
 *   node scripts/auto-ipn.mjs --watch --base https://example.ngrok-free.dev
 *
 * The log is Next's dev log: each line is JSON whose "message" field holds our own JSON
 * (escaped), so the query must be recovered by parsing twice, never by a regex.
 */
import fs from "node:fs";

const LOG = ".next/dev/logs/next-development.log";
const args = process.argv.slice(2);
const watch = args.includes("--watch");
const baseArg = args[args.indexOf("--base") + 1];
const base = (args.includes("--base") && baseArg ? baseArg : "http://localhost:3000").replace(/\/+$/, "");

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run with NODE_ENV=production — this is a dev/recovery tool.");
  process.exit(1);
}

const MEANING = {
  "00": "Confirm Success — result recorded (order created when the payment succeeded)",
  "01": "Order not found — this server has no pending order with that txnRef (restarted?)",
  "02": "Already confirmed — a previous IPN handled it (no duplicate order)",
  "04": "Invalid amount — vnp_Amount does not match the stored order",
  "97": "Invalid checksum — wrong hash secret, or the query string was altered",
  "99": "Unknown error — Sapo failed or is processing; VNPAY would retry",
};

/** A Next dev-log line → our return.received payload, or null. Parses twice, never regex. */
function parseLine(raw) {
  const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!line.startsWith("{")) return null;
  let outer;
  try {
    outer = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof outer.message !== "string") return null;
  let inner;
  try {
    inner = JSON.parse(outer.message);
  } catch {
    return null;
  }
  if (inner.event !== "return.received" || typeof inner.query !== "string") return null;
  const params = new URLSearchParams(inner.query);
  if (!params.get("vnp_SecureHash") || !params.get("vnp_Amount")) return null;
  return { query: inner.query, txnRef: params.get("vnp_TxnRef"), code: params.get("vnp_ResponseCode") };
}

async function replay({ query, txnRef, code }) {
  process.stdout.write(`${new Date().toISOString()}  ${txnRef}  vnp_ResponseCode=${code} → `);
  try {
    const res = await fetch(`${base}/api/vnpay/ipn?${query}`, { redirect: "manual" });
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      console.log(`HTTP ${res.status}, non-JSON response: ${body.slice(0, 120)}`);
      return null;
    }
    console.log(`RspCode ${json.RspCode} — ${MEANING[json.RspCode] ?? json.Message}`);
    return json.RspCode;
  } catch (err) {
    console.log(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function readLog() {
  try {
    return fs.readFileSync(LOG, "utf8");
  } catch {
    console.error(`Cannot read ${LOG} — is \`npm run dev\` running in this project?`);
    process.exit(1);
  }
}

if (!watch) {
  const found = readLog().split(/\r?\n/).map(parseLine).filter(Boolean);
  if (found.length === 0) {
    console.error("No usable return.received in the log. Has a customer come back from VNPAY yet?");
    process.exit(1);
  }
  console.log(`Found ${found.length} genuine callback(s); replaying the most recent to ${base}/api/vnpay/ipn`);
  await replay(found[found.length - 1]);
} else {
  // Follow the log from its current end; settled txnRefs are never replayed twice.
  const settled = new Set();
  let offset = (() => {
    try {
      return fs.statSync(LOG).size;
    } catch {
      return 0;
    }
  })();
  let buffer = "";
  console.log(`Watching ${LOG} → ${base}/api/vnpay/ipn  (Ctrl+C to stop)`);
  console.log("Pay at VNPAY as usual; the order is created the moment the browser lands back.");

  setInterval(async () => {
    let size;
    try {
      size = fs.statSync(LOG).size;
    } catch {
      return;
    }
    if (size < offset) {
      offset = 0; // log rotated or truncated (dev server restart)
      buffer = "";
    }
    if (size === offset) return;
    const chunk = fs.createReadStream(LOG, { start: offset, end: size - 1, encoding: "utf8" });
    offset = size;
    for await (const part of chunk) buffer += part;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? ""; // last element may be a partial line
    for (const line of lines) {
      const hit = parseLine(line);
      if (!hit || settled.has(hit.txnRef)) continue;
      const rsp = await replay(hit);
      if (rsp === "00" || rsp === "02") settled.add(hit.txnRef);
    }
  }, 1000);
}
