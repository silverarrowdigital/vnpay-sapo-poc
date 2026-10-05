"use client";

import { useEffect, useState } from "react";
import { FIELD_CLASS, FIELD_ERROR_CLASS } from "./formField";

/** The three ids the checkout needs. `undefined` until the customer has picked that level. */
export interface AddressSelection {
  provinceId?: number;
  districtId?: number;
  wardId?: number;
}

interface Row {
  id: number;
  name: string;
}

/** A child list together with the parent id it was fetched for. */
type Loaded = { parentId: number; rows: Row[] } | undefined;

/**
 * Tỉnh/thành → quận/huyện → phường/xã, the three levels a Vietnamese address needs and no courier
 * will accept an order without.
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
 * If the lists cannot be loaded the component says so and the submit button stays disabled,
 * because three empty dropdowns look like a broken page and silently drop the address.
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
  // Each child list is stored **with the parent it belongs to**, and read back only when that
  // parent is still the chosen one. Clearing it from an effect would be a synchronous setState in
  // an effect body (a cascading render, and a lint error); deriving it means the list of the
  // previous province can never flash under the new one.
  const [districts, setDistricts] = useState<Loaded>(undefined);
  const [wards, setWards] = useState<Loaded>(undefined);
  const [failed, setFailed] = useState(false);

  // Both halves of each test must be present: with nothing loaded and nothing chosen, `?.parentId`
  // and the id would both be undefined, compare equal, and read `rows` off undefined.
  const districtRows = districts !== undefined && districts.parentId === value.provinceId ? districts.rows : [];
  const wardRows = wards !== undefined && wards.parentId === value.districtId ? wards.rows : [];

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

  // One effect per level, each keyed on its parent id, so a fast double-change cannot leave the
  // list of one province showing under another (the `active` flag drops the late response).
  useEffect(() => {
    const parentId = value.provinceId;
    if (parentId === undefined) return;
    let active = true;
    fetch(`/api/locations?level=districts&parentId=${parentId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { districts?: Row[] }) => {
        if (active) setDistricts({ parentId, rows: j.districts ?? [] });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value.provinceId]);

  useEffect(() => {
    const parentId = value.districtId;
    if (parentId === undefined) return;
    let active = true;
    fetch(`/api/locations?level=wards&parentId=${parentId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { wards?: Row[] }) => {
        if (active) setWards({ parentId, rows: j.wards ?? [] });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value.districtId]);

  const pick = (raw: string): number | undefined => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };

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
          <option value="">{value.provinceId === undefined ? "— Chọn tỉnh/thành trước —" : "— Chọn quận/huyện —"}</option>
          {districtRows.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {errors?.districtId && <span className={FIELD_ERROR_CLASS}>{errors.districtId}</span>}
      </div>

      <div>
        <label htmlFor="wardId" className="mb-1 block text-xs tracking-wide uppercase">
          Phường / Xã
        </label>
        <select
          id="wardId"
          name="wardId"
          required
          disabled={value.districtId === undefined}
          className={`${FIELD_CLASS} disabled:opacity-50`}
          value={value.wardId ?? ""}
          onChange={(e) =>
            onChange({ provinceId: value.provinceId, districtId: value.districtId, wardId: pick(e.target.value) })
          }
        >
          <option value="">{value.districtId === undefined ? "— Chọn quận/huyện trước —" : "— Chọn phường/xã —"}</option>
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
