import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { classifyReturn, markPaidReturn } from "@/lib/order";
import { extractVnpParams } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser redirect back from VNPAY. Per the VNPAY docs this only verifies the checksum and
 * shows a result — it NEVER creates or updates an order. The IPN (or a querydr answer) is authoritative.
 * Only the txnRef and a coarse outcome go into the URL (no customer data).
 */
export async function GET(request: NextRequest) {
  const params = extractVnpParams(request.nextUrl.searchParams);

  // Log the raw query string, signature included. This is the ONLY place the genuine VNPAY
  // callback passes through our system when the IPN cannot reach us (localhost, tunnel down,
  // Deployment Protection on) — without it a real payment is unrecoverable. Paste this line
  // into `npm run replay-ipn -- "<query>"` to drive the IPN by hand.
  // vnp_* params carry no customer data; the signature is one-way and replay is idempotent.
  log.info("return.received", {
    query: request.nextUrl.search.replace(/^\?/, ""),
    txnRef: params.vnp_TxnRef,
    responseCode: params.vnp_ResponseCode,
  });

  const { outcome, txnRef, code } = classifyReturn(params);
  // Records only a hint that VNPAY's signed return said "paid" (so recovery asks about this order
  // first); it changes no order. See markPaidReturn.
  if (outcome === "success" && txnRef) await markPaidReturn(txnRef);

  const base = process.env.APP_BASE_URL?.trim() || request.nextUrl.origin;
  const target = new URL("/success", base);
  target.searchParams.set("outcome", outcome);
  if (txnRef) target.searchParams.set("txnRef", txnRef);
  if (code) target.searchParams.set("code", code);
  return NextResponse.redirect(target, 303);
}
