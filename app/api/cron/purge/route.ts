import { NextRequest, NextResponse } from "next/server";
import { ledgerPurgeCustomers } from "@/lib/ledger";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The daily purge (T14): empties the customer's name, phone, email and address from every ledger
 * order older than 90 days, which is what the privacy policy promises. Called by Vercel Cron (see
 * vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>"; without CRON_SECRET set, or with
 * any other header, this refuses — it deletes data, so it must not be open.
 *
 * Hobby plans may run a cron once a day, which is all this needs.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const purged = await ledgerPurgeCustomers();
  log.info("ledger.purged", { purged });
  return NextResponse.json({ purged });
}
