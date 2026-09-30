import { NextRequest, NextResponse } from "next/server";
import { MissingEnvError } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { CheckoutError, startCheckout, validateCheckout } from "@/lib/order";
import { normaliseIp } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = validateCheckout(body);
  if (!result.ok) {
    return NextResponse.json({ error: "Invalid checkout data", fields: result.errors }, { status: 400 });
  }

  const ip = normaliseIp(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"));

  try {
    const { txnRef, paymentUrl } = await startCheckout(result.value, ip);
    return NextResponse.json({ txnRef, paymentUrl });
  } catch (err) {
    if (err instanceof CheckoutError) {
      // Unknown sku / out of stock / more than we have: the customer can act on this.
      log.warn("checkout.rejected", { status: err.status, reason: err.message });
      return NextResponse.json({ error: err.message, fields: err.fields }, { status: err.status });
    }
    if (err instanceof MissingEnvError) {
      log.error("checkout.config_error", { missing: err.missing, placeholder: err.placeholder });
      // In development, name the offending variables (never their values) so the checkout
      // page can say what to fix in .env.local. Production stays generic.
      const detail =
        process.env.NODE_ENV === "production" ? {} : { missing: err.missing, placeholder: err.placeholder };
      return NextResponse.json({ error: "Payment is not configured on the server.", ...detail }, { status: 500 });
    }
    log.error("checkout.failed", { error: errorMessage(err) });
    return NextResponse.json({ error: "Could not start payment. Please try again." }, { status: 500 });
  }
}
