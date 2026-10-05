import { NextRequest, NextResponse } from "next/server";
import { MissingEnvError } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { lookupOrder } from "@/lib/order";
import { normaliseIp } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Look up one order from its reference plus the phone number on it (T7.6).
 *
 * This is the only route in the project that hands customer data back out, so the shape of its
 * answers matters as much as the lookup itself:
 *
 * - A wrong phone number and a reference that does not exist return the **same** 404. Telling them
 *   apart would make this an oracle for which references are real.
 * - Every attempt is counted against the caller's IP before anything is read, so the
 *   reference/phone pair cannot be brute-forced (`lookupOrder` owns that).
 * - The response carries only what the customer already knows: their own order. No Sapo id of
 *   anyone else's, no customer record, no internal notes.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const txnRef = typeof b.txnRef === "string" ? b.txnRef : "";
  const phone = typeof b.phone === "string" ? b.phone : "";
  if (txnRef.trim() === "" || phone.trim() === "") {
    return NextResponse.json({ error: "Hãy nhập mã đơn hàng và số điện thoại." }, { status: 400 });
  }

  const ip = normaliseIp(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"));

  try {
    const result = await lookupOrder(txnRef, phone, ip);
    if (result.outcome === "rate_limited") {
      return NextResponse.json({ error: "Bạn tra cứu quá nhiều lần. Vui lòng chờ ít phút." }, { status: 429 });
    }
    if (result.outcome === "not_found") {
      return NextResponse.json({ error: "Không tìm thấy đơn hàng khớp với thông tin này." }, { status: 404 });
    }
    // Listed field by field rather than spread, so `phoneDigits` — and anything added to
    // SapoOrderDetail later — cannot reach the browser by accident. That field exists for the
    // server's own comparison: the caller already knows the number they typed, and echoing the
    // stored one back would make a loosened comparison into an oracle that completes a
    // partially-known phone number.
    const o = result.order;
    return NextResponse.json({
      order: {
        id: o.id,
        name: o.name,
        createdOn: o.createdOn,
        financialStatus: o.financialStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        status: o.status,
        totalVnd: o.totalVnd,
        shippingVnd: o.shippingVnd,
        discountVnd: o.discountVnd,
        lines: o.lines,
        address: o.address,
      },
      paymentMethod: result.paymentMethod,
    });
  } catch (err) {
    if (err instanceof MissingEnvError) {
      log.error("lookup.config_error", { missing: err.missing, placeholder: err.placeholder });
      return NextResponse.json({ error: "Máy chủ chưa cấu hình." }, { status: 500 });
    }
    log.error("lookup.failed", { error: errorMessage(err) });
    return NextResponse.json({ error: "Không tra cứu được. Vui lòng thử lại." }, { status: 502 });
  }
}
