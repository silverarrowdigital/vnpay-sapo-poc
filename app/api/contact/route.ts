import { NextRequest, NextResponse } from "next/server";
import { getContactConfig } from "@/lib/config";
import { sendContactMessage, validateContact } from "@/lib/contact";
import { overRateLimit } from "@/lib/order";
import { normaliseIp } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The contact form (T12.3). Switched off — 404 — until `CONTACT_EMAIL_TO` is set, so the endpoint
 * does not exist for a shop that has not chosen an inbox. Each send is a real email, hence the rate
 * limit, counted once the message has passed validation. Nothing the visitor typed is logged.
 */
export async function POST(request: NextRequest) {
  if (getContactConfig() === undefined) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }
  const checked = validateContact(body);
  if (!checked.ok) return NextResponse.json({ error: "Vui lòng kiểm tra lại thông tin", fields: checked.errors }, { status: 400 });

  // Counted only once the message is valid and about to cost an email: a visitor who mistypes a
  // field is not penalised, and validation sends nothing, so it needs no limit of its own.
  const ip = normaliseIp(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"));
  if (await overRateLimit("contact", ip)) {
    return NextResponse.json({ error: "Bạn gửi quá nhiều lần. Vui lòng thử lại sau ít phút." }, { status: 429 });
  }

  if (!(await sendContactMessage(checked.input))) {
    return NextResponse.json({ error: "Chưa gửi được tin nhắn. Vui lòng gọi hotline hoặc thử lại sau." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
