import { NextRequest, NextResponse } from "next/server";
import { MissingEnvError } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { CheckoutError, overRateLimit, quoteTotals } from "@/lib/order";
import { MAX_CART_LINES } from "@/lib/product";
import { normaliseIp } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Price a cart for display: goods, discount, delivery, total.
 *
 * This route exists so the checkout summary can show the real numbers — including a verified
 * discount and the delivery fee for the chosen province — before the customer commits. It is a
 * **display** endpoint and nothing more: `/api/checkout` calls the same `quoteTotals` logic again
 * and signs the VNPAY URL with its own result, so what this returns can be tampered with freely
 * and changes nothing about what is charged.
 *
 * It does touch Sapo (catalog and price rules), so it is rate-limited twice: every call under the
 * generous `quote` policy (so it cannot be looped to exhaust Sapo's API bucket), and a call that
 * tries a code under the tighter `discount` one — this is the one place an anonymous caller can
 * make us look up codes, and guessing codes is exactly what that limit is for.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const ip = normaliseIp(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"));
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  if (rawLines.length > MAX_CART_LINES) {
    return NextResponse.json({ error: "Giỏ hàng quá nhiều dòng" }, { status: 400 });
  }

  const lines = rawLines.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    const variantId = Number(r.variantId);
    const quantity = Number(r.quantity);
    if (!Number.isSafeInteger(variantId) || variantId <= 0) return [];
    if (!Number.isInteger(quantity) || quantity < 1) return [];
    return [{ variantId, quantity }];
  });

  const provinceIdRaw = Number(b.provinceId);
  const provinceId = Number.isSafeInteger(provinceIdRaw) && provinceIdRaw > 0 ? provinceIdRaw : undefined;
  const discountCode = typeof b.discountCode === "string" ? b.discountCode : undefined;

  if (await overRateLimit("quote", ip)) {
    return NextResponse.json({ error: "Bạn thao tác quá nhanh. Vui lòng thử lại sau vài phút." }, { status: 429 });
  }

  // The tighter limit is charged only when a code is actually being tried; re-quoting delivery
  // because the customer changed province happens on every dropdown change and costs nothing here.
  if (discountCode !== undefined && discountCode.trim() !== "" && (await overRateLimit("discount", ip))) {
    return NextResponse.json({ error: "Bạn thử mã quá nhiều lần. Vui lòng chờ ít phút." }, { status: 429 });
  }

  try {
    const totals = await quoteTotals({ lines, provinceId, discountCode });
    if (totals === undefined) {
      // No province yet: delivery cannot be priced, so there is no total to show either.
      return NextResponse.json({ needsProvince: true });
    }
    return NextResponse.json({
      goodsVnd: totals.goodsVnd,
      discount:
        totals.discount !== undefined
          ? { code: totals.discount.code, amountVnd: totals.discount.amountVnd, summary: totals.discount.summary }
          : undefined,
      shipping: {
        title: totals.shipping.title,
        feeVnd: totals.shipping.feeVnd,
        listFeeVnd: totals.shipping.listFeeVnd,
        isFree: totals.shipping.isFree,
        zoneLabel: totals.shipping.zoneLabel,
      },
      totalVnd: totals.totalVnd,
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      // A refused discount code is the normal case here, and the message is for the customer.
      return NextResponse.json({ error: err.message, fields: err.fields }, { status: err.status });
    }
    if (err instanceof MissingEnvError) {
      log.error("quote.config_error", { missing: err.missing, placeholder: err.placeholder });
      return NextResponse.json({ error: "Máy chủ chưa cấu hình." }, { status: 500 });
    }
    log.error("quote.failed", { error: errorMessage(err) });
    return NextResponse.json({ error: "Không tính được đơn hàng. Vui lòng thử lại." }, { status: 502 });
  }
}
