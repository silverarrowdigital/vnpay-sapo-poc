/**
 * Vietnamese administrative divisions, read from Sapo. Server-only.
 *
 * Sapo is the source of truth here rather than any public dataset, for one reason: an order is
 * only useful if Sapo accepts the address on it, so the lists the customer picks from have to be
 * the lists Sapo itself knows. A nicer dataset that Sapo rejects is worth nothing. (It is also why
 * these are Sapo's ids and codes, 1–63 for provinces with `id === code`, verified live — not the
 * General Statistics Office's codes, which Sapo does not use.)
 *
 * **Sapo's filter parameters on these three endpoints are silently ignored.** `?province_id=` on
 * districts and `?district_id=` on wards both return the entire table — 723 and 11,665 rows.
 * Verified on a live store 2026-10-02, re-verified 2026-10-05; it is the same trap as `?tag` /
 * `?tags` on orders and `?code=` on price rules. So the filtering happens here, in our own code,
 * over the `province_id` and `district_id` each row carries.
 *
 * Wards are ~1.2 MB. Nothing in this module may be handed to the browser whole — callers serve one
 * level at a time, filtered — and the whole table would otherwise be fetched again for every
 * dropdown change and every checkout, so each table is memoised per process for an hour. These
 * lists change when the National Assembly redraws a boundary, not when a customer shops; an hour
 * stale is not a risk, and a cold instance pays the fetch once.
 */
import { getSapoConfig } from "./config";
import { errorMessage, log } from "./log";
import { sapoGet } from "./sapo";

export interface Province {
  id: number;
  name: string;
  code: string;
}

export interface District {
  id: number;
  name: string;
  code: string;
  provinceId: number;
}

export interface Ward {
  id: number;
  name: string;
  code: string;
  districtId: number;
  /**
   * Every ward row carries its province as well as its district (verified live). That is what
   * makes the two-tier fallback below possible without a second data source.
   */
  provinceId: number;
}

/**
 * What a validated address contributes to the Sapo order payload.
 *
 * The district is **optional** because Vietnam's 2025 reorganisation abolishes that level. Sapo has
 * not followed yet — it still serves 63 provinces and 723 districts (verified 2026-10-05) — but
 * when it does, an address will be province + ward and this shape already allows it.
 */
export interface ResolvedAddress {
  province: string;
  provinceCode: string;
  provinceId: number;
  district?: string;
  districtCode?: string;
  districtId?: number;
  ward: string;
  wardCode: string;
  wardId: number;
}

interface RawProvince {
  id?: number;
  name?: string;
  code?: string;
}
interface RawDistrict extends RawProvince {
  province_id?: number;
}
interface RawWard extends RawProvince {
  district_id?: number;
  province_id?: number;
}

/** A row with no id or no name cannot be chosen or recorded, so it is dropped rather than shown. */
const usable = (row: { id?: number; name?: string }): boolean =>
  typeof row.id === "number" && typeof row.name === "string" && row.name.length > 0;

const TABLE_TTL_MS = 60 * 60 * 1000;

interface CachedTable<T> {
  rows: T[];
  readAt: number;
}

/**
 * Kept on globalThis so `next dev`'s module reloads do not re-download 1.2 MB of wards on every
 * save — the same reason lib/store.ts keeps its Map there.
 *
 * **The number in the key is a shape version, and it has to be bumped whenever a row's mapped shape
 * changes.** A module reload re-runs this file but does not clear globalThis, so rows built by the
 * previous version of the mapper survive the edit that changed them. Hit for real while adding the
 * two-tier fallback: `Ward` gained `provinceId`, the cached rows had been built without it, and
 * `listWardsByProvince` quietly returned **zero** wards for every province — no error, no warning,
 * just an empty dropdown. It is the same class of trap as a stale `unstable_cache` entry outliving
 * a deploy (see CLAUDE.md). Production is immune — a new deployment is a new process — which is
 * exactly why it would only ever be found by someone mid-edit.
 */
const g = globalThis as typeof globalThis & {
  __vnpaySapoLocations_v2?: {
    provinces?: CachedTable<Province>;
    districts?: CachedTable<District>;
    wards?: CachedTable<Ward>;
  };
};
const cache = (g.__vnpaySapoLocations_v2 ??= {});

function fresh<T>(entry: CachedTable<T> | undefined): T[] | undefined {
  if (entry === undefined) return undefined;
  return Date.now() - entry.readAt < TABLE_TTL_MS ? entry.rows : undefined;
}

async function loadProvinces(): Promise<Province[]> {
  const hit = fresh(cache.provinces);
  if (hit !== undefined) return hit;
  const cfg = getSapoConfig();
  const data = (await sapoGet(cfg, "/admin/provinces.json")) as { provinces?: RawProvince[] };
  const rows = (data.provinces ?? [])
    .filter(usable)
    .map((p) => ({ id: p.id as number, name: p.name as string, code: String(p.code ?? p.id) }));
  cache.provinces = { rows, readAt: Date.now() };
  log.info("locations.loaded", { table: "provinces", rows: rows.length });
  return rows;
}

async function loadDistricts(): Promise<District[]> {
  const hit = fresh(cache.districts);
  if (hit !== undefined) return hit;
  const cfg = getSapoConfig();
  const data = (await sapoGet(cfg, "/admin/districts.json")) as { districts?: RawDistrict[] };
  const rows = (data.districts ?? [])
    .filter((d) => usable(d) && typeof d.province_id === "number")
    .map((d) => ({
      id: d.id as number,
      name: d.name as string,
      code: String(d.code ?? d.id),
      provinceId: d.province_id as number,
    }));
  cache.districts = { rows, readAt: Date.now() };
  log.info("locations.loaded", { table: "districts", rows: rows.length });
  return rows;
}

async function loadWards(): Promise<Ward[]> {
  const hit = fresh(cache.wards);
  if (hit !== undefined) return hit;
  const cfg = getSapoConfig();
  const data = (await sapoGet(cfg, "/admin/wards.json")) as { wards?: RawWard[] };
  const rows = (data.wards ?? [])
    .filter((w) => usable(w) && typeof w.province_id === "number")
    .map((w) => ({
      id: w.id as number,
      name: w.name as string,
      code: String(w.code ?? w.id),
      // -1 for a ward with no district: unreachable through the district path, which is what a
      // two-tier row should be. It is never compared against a real id.
      districtId: typeof w.district_id === "number" ? w.district_id : -1,
      provinceId: w.province_id as number,
    }));
  cache.wards = { rows, readAt: Date.now() };
  log.info("locations.loaded", { table: "wards", rows: rows.length });
  return rows;
}

/** Vietnamese sorts by locale, not by code point: "Đà Nẵng" belongs after "Cần Thơ", not last. */
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "vi");

export async function listProvinces(): Promise<Province[]> {
  return [...(await loadProvinces())].sort(byName);
}

export async function listDistricts(provinceId: number): Promise<District[]> {
  return (await loadDistricts()).filter((d) => d.provinceId === provinceId).sort(byName);
}

export async function listWards(districtId: number): Promise<Ward[]> {
  return (await loadWards()).filter((w) => w.districtId === districtId).sort(byName);
}

/**
 * Wards of a province, ignoring the district level entirely.
 *
 * This is the two-tier path. Vietnam's 2025 reorganisation abolishes the district level, and the
 * day Sapo follows, `listDistricts` will return an empty list for a province and the three-step
 * cascade would dead-end: an empty dropdown the customer cannot get past, with nothing logged and
 * nothing to see but a disabled button. Sales would stop silently.
 *
 * Sapo has **not** followed yet (63 provinces, 723 districts, every ward carrying a `district_id`,
 * verified 2026-10-05), so today this returns the same wards the district path would, just
 * unfiltered by district. It exists so the switch, whenever it comes, costs nothing.
 */
export async function listWardsByProvince(provinceId: number): Promise<Ward[]> {
  return (await loadWards()).filter((w) => w.provinceId === provinceId).sort(byName);
}

/**
 * Does Sapo still know a district level for this province?
 *
 * This is the gate on the two-tier path, and it is a security check rather than a convenience. A
 * request may omit the district **only** when Sapo genuinely has none for that province — otherwise
 * a forged request could drop `districtId` and skip the containment check that keeps a ward from
 * being attached to the wrong district.
 */
export async function provinceHasDistricts(provinceId: number): Promise<boolean> {
  return (await loadDistricts()).some((d) => d.provinceId === provinceId);
}

/**
 * Turn three ids from the browser into the names and codes Sapo wants, refusing anything that
 * does not hang together.
 *
 * The containment checks are the point. A browser can post any three numbers, and a ward that
 * belongs to a different district would produce an order addressed to a place that does not
 * exist — accepted by Sapo, undeliverable by a courier, and discovered only when someone tries
 * to ship it.
 */
export async function resolveAddress(
  provinceId: number,
  districtId: number | undefined,
  wardId: number,
): Promise<ResolvedAddress | undefined> {
  const province = (await loadProvinces()).find((p) => p.id === provinceId);
  if (province === undefined) return undefined;

  const districts = await loadDistricts();
  const wards = await loadWards();

  // Two-tier: no district sent. Allowed only when Sapo itself has no district level for this
  // province — never merely because the request left the field out. Otherwise dropping `districtId`
  // would be a way to skip the containment check below.
  if (districtId === undefined) {
    if (districts.some((d) => d.provinceId === provinceId)) return undefined;
    const ward = wards.find((w) => w.id === wardId && w.provinceId === provinceId);
    if (ward === undefined) return undefined;
    return {
      province: province.name,
      provinceCode: province.code,
      provinceId: province.id,
      ward: ward.name,
      wardCode: ward.code,
      wardId: ward.id,
    };
  }

  const district = districts.find((d) => d.id === districtId && d.provinceId === provinceId);
  if (district === undefined) return undefined;

  const ward = wards.find((w) => w.id === wardId && w.districtId === districtId);
  if (ward === undefined) return undefined;

  return {
    province: province.name,
    provinceCode: province.code,
    provinceId: province.id,
    district: district.name,
    districtCode: district.code,
    districtId: district.id,
    ward: ward.name,
    wardCode: ward.code,
    wardId: ward.id,
  };
}

/**
 * True when the three tables can be read at all. Used by the checkout page to decide whether to
 * offer the cascading selects — if Sapo's location tables are unreachable we must not render three
 * empty dropdowns the customer cannot get past.
 */
export async function locationsAvailable(): Promise<boolean> {
  try {
    return (await loadProvinces()).length > 0;
  } catch (err) {
    log.warn("locations.unavailable", { error: errorMessage(err) });
    return false;
  }
}
