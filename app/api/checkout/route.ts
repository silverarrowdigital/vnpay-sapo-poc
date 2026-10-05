import { NextRequest, NextResponse } from "next/server";
import { MissingEnvError } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { CheckoutError, overRateLimit, phoneRateKey, startCheckout, validateCheckout } from "@/lib/order";
import { normaliseIp } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const result = validateCheckout(body);
  if (!result.ok) {
    return NextResponse.json({ error: "Thông tin chưa hợp lệ", fields: result.errors }, { status: 400 });
  }

  const ip = normaliseIp(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"));

  // Throttled before any work: with COD a request on this route creates a real Sapo order, so an
  // open endpoint is a way to fill the shop's order list. Counted before validation would punish a
  // customer fixing a typo, so it sits here — after the shape is known good, before Sapo is called.
  if (await overRateLimit("checkout", ip)) {
    return NextResponse.json({ error: "Bạn thao tác quá nhanh. Vui lòng thử lại sau vài phút." }, { status: 429 });
  }

  // COD gets two more counters, on two different axes, because it is the only path where a request
  // produces a real order and moves real stock without any money arriving. One by IP, tighter than
  // the shared limit above; one by phone number, which is the axis an IP limit misses — IPs rotate,
  // and a mobile network puts many genuine customers behind a single one.
  if (result.value.paymentMethod === "cod") {
    if (await overRateLimit("cod", ip)) {
      return NextResponse.json(
        { error: "Bạn đã đặt nhiều đơn COD liên tiếp. Vui lòng chờ ít phút hoặc thanh toán qua VNPAY." },
        { status: 429 },
      );
    }
    if (await overRateLimit("codPhone", phoneRateKey(result.value.phone))) {
      return NextResponse.json(
        { error: "Số điện thoại này đã đặt nhiều đơn COD trong một giờ. Vui lòng thanh toán qua VNPAY." },
        { status: 429 },
      );
    }
  }

  try {
    const started = await startCheckout(result.value, ip);
    if (started.method === "cod") {
      // Nothing to redirect to a gateway: the order already exists. The browser goes straight to
      // the result page, which reads the same stored record a VNPAY order would leave behind.
      return NextResponse.json({
        txnRef: started.txnRef,
        method: "cod",
        orderName: started.sapoOrder.name,
        successUrl: `/success?txnRef=${encodeURIComponent(started.txnRef)}&outcome=cod`,
      });
    }
    return NextResponse.json({ txnRef: started.txnRef, method: "vnpay", paymentUrl: started.paymentUrl });
  } catch (err) {
    if (err instanceof CheckoutError) {
      // Out of stock, a withdrawn product, a bad address, a refused discount code: all things
      // the customer can act on, so the message goes back as written.
      log.warn("checkout.rejected", { status: err.status, reason: err.message });
      return NextResponse.json({ error: err.message, fields: err.fields }, { status: err.status });
    }
    if (err instanceof MissingEnvError) {
      log.error("checkout.config_error", { missing: err.missing, placeholder: err.placeholder });
      // In development, name the offending variables (never their values) so the checkout
      // page can say what to fix in .env.local. Production stays generic.
      const detail =
        process.env.NODE_ENV === "production" ? {} : { missing: err.missing, placeholder: err.placeholder };
      return NextResponse.json({ error: "Máy chủ chưa cấu hình thanh toán.", ...detail }, { status: 500 });
    }
    log.error("checkout.failed", { error: errorMessage(err) });
    return NextResponse.json({ error: "Không khởi tạo được đơn hàng. Vui lòng thử lại." }, { status: 500 });
  }
}
