#!/usr/bin/env node
/**
 * DEV-ONLY: xoa cac don hang test do PoC nay tao ra (tag "headless-poc").
 * Mac dinh CHI LIET KE. Phai them --yes moi thuc su xoa.
 *
 *   npm run clean:orders              # xem truoc, khong xoa
 *   npm run clean:orders -- --yes    # xoa that (khong hoan tac duoc)
 *
 * Endpoint: DELETE /admin/orders/{id}.json
 *   https://support.sapo.vn/phuong-thuc-delete-cua-order
 */
const TAG = "headless-poc";
const confirm = process.argv.includes("--yes");

const domain = (process.env.SAPO_STORE_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const key = process.env.SAPO_API_KEY;
const secret = process.env.SAPO_API_SECRET;

async function main() {
  if (!domain || !key || !secret) {
    console.error("Thieu bien SAPO_*. Da truyen --env-file=.env.local chua?");
    process.exitCode = 1;
    return;
  }
  const auth = "Basic " + Buffer.from(`${key}:${secret}`, "utf-8").toString("base64");
  const api = (path, method = "GET") =>
    fetch(`https://${domain}${path}`, { method, headers: { Authorization: auth, Accept: "application/json" } });

  const res = await api(`/admin/orders.json?limit=250&tag=${encodeURIComponent(TAG)}&fields=id,name,total_price,tags`);
  if (!res.ok) {
    console.error(`Khong doc duoc danh sach don: HTTP ${res.status}`);
    process.exitCode = 1;
    return;
  }
  const orders = (await res.json()).orders ?? [];

  if (orders.length === 0) {
    console.log(`Khong con don nao co tag "${TAG}". Store da sach.`);
    return;
  }

  console.log(`Tim thay ${orders.length} don co tag "${TAG}":\n`);
  for (const o of orders) console.log(`  ${o.name}   id=${o.id}   ${o.total_price}d   [${o.tags}]`);

  if (!confirm) {
    console.log(`\nCHE DO XEM TRUOC - chua xoa gi ca.`);
    console.log(`De xoa that, chay lai voi --yes:`);
    console.log(`  npm run clean:orders -- --yes`);
    return;
  }

  console.log(`\nDang xoa vinh vien ${orders.length} don...\n`);
  let ok = 0, fail = 0;
  for (const o of orders) {
    const r = await api(`/admin/orders/${o.id}.json`, "DELETE");
    if (r.ok) {
      ok++;
      console.log(`  da xoa  ${o.name} (id ${o.id})  HTTP ${r.status}`);
    } else {
      fail++;
      console.log(`  LOI     ${o.name} (id ${o.id})  HTTP ${r.status}  ${(await r.text()).slice(0, 160)}`);
    }
  }
  console.log(`\nXong: ${ok} da xoa, ${fail} that bai.`);
  if (fail > 0) process.exitCode = 1;
}

await main();
