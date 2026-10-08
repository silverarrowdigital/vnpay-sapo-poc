import { after, NextRequest, NextResponse } from "next/server";
import { errorMessage, log } from "@/lib/log";
import { handleIpn } from "@/lib/order";
import { extractVnpParams } from "@/lib/vnpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Sapo call runs after the answer (T14 PR 6c), through `after`, which lives as long as this limit. Worst
// case, with Sapo slow: a 4 s ledger commit, then two Sapo calls of 15 s, three more ledger calls of up to
// 4 s and the 5 s alert mail — about 55 s. 120 s (as for the sweep) leaves room instead of cutting off the
// job count and the owner's mail exactly when they are needed.
export const maxDuration = 120;

/**
 * VNPAY server-to-server IPN (GET with vnp_* query params). Authoritative payment result.
 * Must always answer HTTP 200 with JSON { RspCode, Message } — see lib/order.ts handleIpn.
 */
export async function GET(request: NextRequest) {
  const receivedAt = Date.now();
  const params = extractVnpParams(request.nextUrl.searchParams);

  // Log every hit before any processing: if VNPAY never reaches us, the absence of this line
  // for a txnRef is the proof. vnp_* params carry no customer data. The signature is truncated
  // because a full one is replayable by anyone who can read the log.
  const { vnp_SecureHash, ...safeParams } = params;
  log.info("ipn.received", {
    ...safeParams,
    vnp_SecureHash: vnp_SecureHash ? `${vnp_SecureHash.slice(0, 16)}…(${vnp_SecureHash.length} chars)` : undefined,
    remoteIp: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  try {
    const result = await handleIpn(params, { defer: (work) => after(work) });
    log.info("ipn.response", {
      txnRef: params.vnp_TxnRef,
      rspCode: result.RspCode,
      message: result.Message,
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json(result); // always HTTP 200, per the VNPAY docs
  } catch (err) {
    log.error("ipn.unhandled", {
      txnRef: params.vnp_TxnRef,
      error: errorMessage(err),
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json({ RspCode: "99", Message: "Unknown error" });
  }
}
