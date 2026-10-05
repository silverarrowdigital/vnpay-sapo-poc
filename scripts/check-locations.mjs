#!/usr/bin/env node
/**
 * Watch Sapo's administrative-division tables for the 2025 reorganisation.
 *
 *   npm run check:locations
 *
 * Vietnam's 2025 reform cut 63 provinces to 34 and **abolished the district level**. Sapo has not
 * followed: as of 2026-10-05 it still serves 63 provinces, 723 districts and 11,665 wards, and
 * every ward still carries a `district_id`. That is fine — the storefront mirrors Sapo on purpose,
 * because an order is only useful if Sapo accepts the address on it.
 *
 * What is **not** fine is finding out the day it changes by way of customers who cannot check out.
 * The district select would come back empty, the submit button would stay disabled, and nothing
 * would be logged. `lib/locations.ts` has a two-tier fallback for exactly that, but it only kicks in
 * per province; a wholesale change is something a person should see.
 *
 * So this script prints the shape of the three tables and shouts when any of the expectations below
 * stops holding. Read-only: it creates, changes and deletes nothing.
 *
 * Sapo's table is an **accretion, not a snapshot** — new units are added without the superseded
 * ones being removed. Verified: `Huyện Long Điền`(67) and `Huyện Đất Đỏ`(68) are still selectable
 * alongside `Huyện Long Đất`(10929), the district that replaced both; `Huyện Tân Thành`(69) still
 * sits beside `Thị xã Phú Mỹ`(716), carved out of it in 2018. So a growing count is the normal
 * signal of an update, and a *shrinking* one is the signal that matters.
 */
const domain = process.env.SAPO_STORE_DOMAIN;
const key = process.env.SAPO_API_KEY;
const secret = process.env.SAPO_API_SECRET;

if (!domain || !key || !secret) {
  console.error("Thiếu SAPO_STORE_DOMAIN / SAPO_API_KEY / SAPO_API_SECRET trong .env.local.");
  process.exit(1);
}

/** What the code was written against. A difference is news, not necessarily a problem. */
const BASELINE = { provinces: 63, districts: 723, wards: 11665, asOf: "2026-10-05" };

const auth = Buffer.from(`${key}:${secret}`).toString("base64");
const get = async (path) => {
  const res = await fetch(`https://${domain}${path}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
};

let provinces;
let districts;
let wards;
try {
  ({ provinces } = await get("/admin/provinces.json"));
  ({ districts } = await get("/admin/districts.json"));
  ({ wards } = await get("/admin/wards.json"));
} catch (err) {
  console.error("Không đọc được bảng địa giới từ Sapo:", err.message);
  process.exit(1);
}

const alarms = [];
const notes = [];

const line = (label, now, then) => {
  const delta = now - then;
  const mark = delta === 0 ? "=" : delta > 0 ? `+${delta}` : String(delta);
  console.log(`  ${label.padEnd(12)} ${String(now).padStart(6)}   (mốc ${then}, ${mark})`);
};

console.log(`Store: ${domain}\nSo với mốc ngày ${BASELINE.asOf}:\n`);
line("tỉnh/thành", provinces.length, BASELINE.provinces);
line("quận/huyện", districts.length, BASELINE.districts);
line("phường/xã", wards.length, BASELINE.wards);

// 1. The headline: has Sapo moved to the 34-province map?
if (provinces.length !== BASELINE.provinces) {
  alarms.push(
    `Số tỉnh/thành đổi từ ${BASELINE.provinces} thành ${provinces.length}. ` +
      (provinces.length <= 34
        ? "Có vẻ Sapo đã chuyển sang bản đồ sau sáp nhập — ĐỌC KỸ phần dưới."
        : "Kiểm xem đơn vị nào được thêm/bớt."),
  );
}

// 2. The one that breaks the form: a province with no districts at all.
const byProvince = new Map();
for (const d of districts) {
  const pid = d.province_id;
  byProvince.set(pid, (byProvince.get(pid) ?? 0) + 1);
}
const districtless = provinces.filter((p) => (byProvince.get(p.id) ?? 0) === 0);
if (districts.length === 0) {
  alarms.push("KHÔNG CÒN quận/huyện nào. Sapo đã bỏ cấp này — mọi tỉnh sẽ đi đường hai cấp.");
} else if (districtless.length > 0) {
  notes.push(
    `${districtless.length} tỉnh/thành không có quận/huyện nào — các tỉnh này sẽ tự động đi đường ` +
      `hai cấp (ẩn ô quận/huyện): ${districtless.map((p) => p.name).join(", ")}`,
  );
}

// 3. Wards with no district: the other shape a two-tier switch can take.
const orphanWards = wards.filter((w) => typeof w.district_id !== "number");
if (orphanWards.length > 0) {
  notes.push(
    `${orphanWards.length} phường/xã không có district_id. Đường hai cấp xử lý được, nhưng nếu con ` +
      `số này lớn thì Sapo đang chuyển mô hình.`,
  );
}

// 4. A ward whose province we cannot read is unusable: it can never be resolved.
const unusable = wards.filter((w) => typeof w.province_id !== "number");
if (unusable.length > 0) {
  alarms.push(`${unusable.length} phường/xã KHÔNG có province_id — những mục này không thể dùng để đặt hàng.`);
}

// 5. Shrinking is the direction that matters: Sapo adds without removing, so a drop means units
//    the storefront may already have written onto orders have gone.
if (districts.length < BASELINE.districts) {
  alarms.push(`Số quận/huyện GIẢM (${BASELINE.districts} → ${districts.length}). Có đơn vị đã bị xoá.`);
}
if (wards.length < BASELINE.wards) {
  alarms.push(`Số phường/xã GIẢM (${BASELINE.wards} → ${wards.length}). Có đơn vị đã bị xoá.`);
}

// 6. Spot checks on units the 2025 reform abolished, to show plainly which map is being served.
const spots = [
  ["tỉnh", "Bà Rịa-Vũng Tàu", provinces],
  ["tỉnh", "Bình Dương", provinces],
  ["quận", "Quận 1", districts],
  ["phường", "Phường Đa Kao", wards],
];
console.log("\nCác đơn vị đã bị sáp nhập năm 2025 — Sapo còn cho chọn không:");
for (const [kind, name, table] of spots) {
  const hit = table.find((x) => x.name === name);
  console.log(`  ${kind.padEnd(8)} ${name.padEnd(20)} ${hit ? `CÒN (id ${hit.id})` : "đã bỏ"}`);
}

if (notes.length > 0) {
  console.log("\nGhi chú:");
  for (const n of notes) console.log(`  • ${n}`);
}

if (alarms.length === 0) {
  console.log("\n✔ Không có gì phải xử lý: bảng địa giới vẫn đúng hình dạng code đang mong đợi.");
} else {
  console.log("\n⚠ CẦN XEM:");
  for (const a of alarms) console.log(`  • ${a}`);
  console.log(
    "\nCode không cần sửa để chạy tiếp — lib/locations.ts đã có đường hai cấp và đọc trực tiếp từ Sapo\n" +
      "(nhớ đệm 1 giờ mỗi tiến trình). Nhưng hãy cập nhật mốc BASELINE ở đầu file này, và xem lại\n" +
      "bảng vùng phí trong lib/shipping.ts: nó khoá theo id tỉnh, nên bản đồ tỉnh đổi là phí có thể sai.",
  );
  process.exitCode = 1;
}
