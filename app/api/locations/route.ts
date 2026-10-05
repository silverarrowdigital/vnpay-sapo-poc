import { NextRequest, NextResponse } from "next/server";
import { errorMessage, log } from "@/lib/log";
import { listDistricts, listProvinces, listWards, listWardsByProvince } from "@/lib/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vietnam's administrative divisions, one level at a time, for the checkout form's three selects.
 *
 * Public on purpose — this is the same list every delivery form in the country shows, and it holds
 * nothing about the shop, its prices or its customers. What it must never do is hand over a whole
 * table: `wards` is 11,665 rows and ~1.2 MB, so the only way to ask for wards is to name a
 * district. A request without the parent id is a 400, not a full dump.
 *
 * `lib/locations.ts` memoises each table per process for an hour, and the response carries a cache
 * header for the same reason: these lists change when a boundary is redrawn, not when a customer
 * shops.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const level = params.get("level") ?? "provinces";
  const parentId = Number(params.get("parentId") ?? "");

  try {
    if (level === "provinces") {
      return cached({ provinces: await listProvinces() });
    }
    if (!Number.isSafeInteger(parentId) || parentId <= 0) {
      return NextResponse.json({ error: "Thiếu parentId" }, { status: 400 });
    }
    if (level === "districts") {
      return cached({ districts: await listDistricts(parentId) });
    }
    if (level === "wards") {
      return cached({ wards: await listWards(parentId) });
    }
    // Wards of a whole province, for the day Sapo drops the district level (Vietnam's 2025
    // reorganisation). A separate `level` rather than letting `parentId` mean either a district or
    // a province depending on context: a number whose meaning depends on the caller's intent is
    // exactly the kind of parameter that gets passed the wrong id a year from now.
    if (level === "province-wards") {
      return cached({ wards: await listWardsByProvince(parentId) });
    }
    return NextResponse.json({ error: "level không hợp lệ" }, { status: 400 });
  } catch (err) {
    // The form degrades to "could not load" and says so; it never silently shows empty dropdowns.
    log.error("locations.request_failed", { level, error: errorMessage(err) });
    return NextResponse.json({ error: "Không đọc được danh sách địa giới." }, { status: 502 });
  }
}

function cached(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
