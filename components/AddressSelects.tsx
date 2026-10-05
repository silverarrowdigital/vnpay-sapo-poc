"use client";

import { useEffect, useMemo, useState } from "react";
import { FIELD_CLASS, FIELD_ERROR_CLASS } from "./formField";

/** The ids the checkout needs. `districtId` stays absent where Sapo has no district level. */
export interface AddressSelection {
  provinceId?: number;
  districtId?: number;
  wardId?: number;
}

interface Row {
  id: number;
  name: string;
}

/** A child list together with the parent it was fetched for. */
type Loaded = { key: string; rows: Row[] } | undefined;

/**
 * Tỉnh/thành → quận/huyện → phường/xã, the levels a Vietnamese address needs and no courier will
 * accept an order without.
 *
 * Each level is fetched when its parent is chosen, never all at once: the ward table is 11,665 rows
 * and about 1.2 MB, so `/api/locations` refuses to serve it unprefiltered and this component asks
 * for one district's worth at a time.
 *
 * Choosing a province clears the district and the ward, and choosing a district clears the ward.
 * That is not tidiness — a stale ward id from the previous province would be a real address in the
 * wrong place, and while the server refuses that pairing outright, the customer would be told their
 * address is invalid without being shown which part.
 *
 * **Two-tier provinces.** Vietnam's 2025 reorganisation abolishes the district level. Sapo has not
 * followed (63 provinces, 723 districts, verified 2026-10-05) so today every province has one, but
 * when a province comes back with **no districts** this component drops that step: it hides the
 * select and asks for the province's wards directly. Without that branch, the day Sapo switches is
 * the day the form dead-ends on an empty dropdown with a disabled button — no error, no log, no
 * sales. The server still decides whether skipping the level was legitimate.
 *
 * If the lists cannot be loaded at all the component says so, because three empty dropdowns look
 * like a broken page and silently drop the address.
 */
export default function AddressSelects({
  value,
  onChange,
  errors,
}: {
  value: AddressSelection;
  onChange: (next: AddressSelection) => void;
  errors?: { provinceId?: string; districtId?: string; wardId?: string };
}) {
  const [provinces, setProvinces] = useState<Row[]>([]);
  const [districts, setDistricts] = useState<Loaded>(undefined);
  const [wards, setWards] = useState<Loaded>(undefined);
  const [failed, setFailed] = useState(false);

  const provinceKey = value.provinceId === undefined ? "" : `p:${value.provinceId}`;
  const districtsReady = districts !== undefined && districts.key === provinceKey;
  const districtRows = districtsReady ? districts.rows : [];

  // Known only once the district list for this province has actually arrived: an empty list before
  // then means "not loaded", not "no districts".
  const hasDistricts = districtsReady ? districtRows.length > 0 : undefined;

  // Which parent the wards hang off. Undefined means "not ready to ask yet". Memoised so the fetch
  // effect can depend on the object itself: rebuilt every render, it would refetch every render.
  const wardParent = useMemo(
    () =>
      value.districtId !== undefined
        ? { level: "wards", id: value.districtId, key: `d:${value.districtId}` }
        : hasDistricts === false && value.provinceId !== undefined
          ? { level: "province-wards", id: value.provinceId, key: `pw:${value.provinceId}` }
          : undefined,
    [value.districtId, value.provinceId, hasDistricts],
  );
  const wardRows = wards !== undefined && wardParent !== undefined && wards.key === wardParent.key ? wards.rows : [];

  useEffect(() => {
    let active = true;
    fetch("/api/locations?level=provinces")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { provinces?: Row[] }) => {
        if (active) setProvinces(j.provinces ?? []);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const parentId = value.provinceId;
    if (parentId === undefined) return;
    let active = true;
    fetch(`/api/locations?level=districts&parentId=${parentId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { districts?: Row[] }) => {
        if (active) setDistricts({ key: `p:${parentId}`, rows: j.districts ?? [] });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value.provinceId]);

  useEffect(() => {
    if (wardParent === undefined) return;
    const { level, id, key } = wardParent;
    let active = true;
    fetch(`/api/locations?level=${level}&parentId=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { wards?: Row[] }) => {
        if (active) setWards({ key, rows: j.wards ?? [] });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
    // One effect covers both the district path and the province path.
  }, [wardParent]);

  const pick = (raw: string): number | undefined => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };

  const wardDisabled = wardParent === undefined;

  return (
    <>
      <div>
        <label htmlFor="provinceId" className="mb-1 block text-xs tracking-wide uppercase">
          Tỉnh / Thành phố
        </label>
        <select
          id="provinceId"
          name="provinceId"
          required
          className={FIELD_CLASS}
          value={value.provinceId ?? ""}
          onChange={(e) => onChange({ provinceId: pick(e.target.value) })}
        >
          <option value="">— Chọn tỉnh/thành phố —</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {errors?.provinceId && <span className={FIELD_ERROR_CLASS}>{errors.provinceId}</span>}
      </div>

      {/* Hidden entirely where Sapo has no district level for the chosen province. */}
      {hasDistricts !== false && (
        <div>
          <label htmlFor="districtId" className="mb-1 block text-xs tracking-wide uppercase">
            Quận / Huyện
          </label>
          <select
            id="districtId"
            name="districtId"
            required
            disabled={value.provinceId === undefined}
            className={`${FIELD_CLASS} disabled:opacity-50`}
            value={value.districtId ?? ""}
            onChange={(e) => onChange({ provinceId: value.provinceId, districtId: pick(e.target.value) })}
          >
            <option value="">
              {value.provinceId === undefined ? "— Chọn tỉnh/thành trước —" : "— Chọn quận/huyện —"}
            </option>
            {districtRows.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {errors?.districtId && <span className={FIELD_ERROR_CLASS}>{errors.districtId}</span>}
        </div>
      )}

      <div>
        <label htmlFor="wardId" className="mb-1 block text-xs tracking-wide uppercase">
          Phường / Xã
        </label>
        <select
          id="wardId"
          name="wardId"
          required
          disabled={wardDisabled}
          className={`${FIELD_CLASS} disabled:opacity-50`}
          value={value.wardId ?? ""}
          onChange={(e) =>
            onChange({ provinceId: value.provinceId, districtId: value.districtId, wardId: pick(e.target.value) })
          }
        >
          <option value="">
            {wardDisabled
              ? value.provinceId === undefined
                ? "— Chọn tỉnh/thành trước —"
                : "— Chọn quận/huyện trước —"
              : "— Chọn phường/xã —"}
          </option>
          {wardRows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {errors?.wardId && <span className={FIELD_ERROR_CLASS}>{errors.wardId}</span>}
      </div>

      {failed && (
        <p className="m-0 text-sm text-[color:var(--err)]">
          Không tải được danh sách tỉnh/quận/phường. Vui lòng tải lại trang.
        </p>
      )}
    </>
  );
}
