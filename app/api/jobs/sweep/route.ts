import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { errorMessage, log } from "@/lib/log";
import { alertUnsettledPaidReturn, hasPaidReturn, reconcilePendingPayment } from "@/lib/order";
import { runSweep } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The sweep asks VNPAY and Sapo about up to ten orders one after another; no item is started after
// 20 s (lib/sweep.ts), and one item can take close to a minute.
export const maxDuration = 120;

/**
 * Who may start a sweep. Either QStash (every five minutes; its request carries an Upstash-Signature
 * that is verified against our signing keys, current or next, over the exact body) or Vercel Cron (a
 * daily net underneath it; sends "Authorization: Bearer <CRON_SECRET>"). Nothing else: a sweep asks
 * VNPAY and writes to Sapo, so it must not be callable by the public.
 */
function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorised(request: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && sameSecret(request.headers.get("authorization"), secret)) return true;

  const signature = request.headers.get("upstash-signature");
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  // The signature names the address it was issued for. Checking it against ours means a request QStash
  // signed for another endpoint of the same account is refused here — so the address must be known.
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (!signature || !current || !next || !base) {
    log.warn("sweep.unauthorised", { hasSignature: Boolean(signature), hasKeys: Boolean(current && next), hasBaseUrl: Boolean(base) });
    return false;
  }
  try {
    const ok = await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({ signature, body, url: `${base}/api/jobs/sweep` });
    if (!ok) log.warn("sweep.unauthorised", { reason: "signature did not verify (is APP_BASE_URL the address the schedule points at?)" });
    return ok;
  } catch {
    log.warn("sweep.unauthorised", { reason: "signature check threw (is APP_BASE_URL the address the schedule points at?)" });
    return false;
  }
}

async function handle(request: NextRequest) {
  const body = await request.text();
  if (!(await authorised(request, body))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runSweep((txnRef) => reconcilePendingPayment(txnRef, Date.now(), { skipWait: true }), {
      hasPaidReturn,
      onGiveUp: alertUnsettledPaidReturn,
    });
    return NextResponse.json(result);
  } catch (err) {
    log.error("sweep.failed", { error: errorMessage(err) });
    // 200 on purpose: a 5xx makes QStash retry the same run, and the next scheduled one is five minutes away.
    return NextResponse.json({ error: "sweep failed" });
  }
}

export const POST = handle;
export const GET = handle;
