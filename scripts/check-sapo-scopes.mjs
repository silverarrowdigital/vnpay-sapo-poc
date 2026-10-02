#!/usr/bin/env node
/**
 * Dev check: which Sapo Admin API resources this Private App may actually reach.
 *
 * Sapo answers an endpoint the app has no scope for with `access_denied`, and a path that is not
 * a route at all with a framework 403 that echoes the path back. Those look the same in a status
 * code and mean opposite things — one is a setting to change, the other is an endpoint that does
 * not exist and must never be called from code. This prints which is which.
 *
 *   npm run check:sapo-scopes
 */
const domain = process.env.SAPO_STORE_DOMAIN;
const key = process.env.SAPO_API_KEY;
const secret = process.env.SAPO_API_SECRET;

if (!domain || !key || !secret) {
  console.error("Thiếu SAPO_STORE_DOMAIN / SAPO_API_KEY / SAPO_API_SECRET.");
  process.exitCode = 1;
} else {
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  /** Read-only probes. Nothing here creates, changes or deletes anything. */
  const paths = [
    ["/admin/products.json?limit=1", "Sản phẩm"],
    ["/admin/orders.json?limit=1", "Đơn hàng"],
    ["/admin/customers.json?limit=1", "Khách hàng"],
    ["/admin/price_rules.json", "Khuyến mãi — ĐÂY là hệ giảm giá, cần cho T7.3"],
    ["/admin/discounts.json", "Khuyến mãi — đường cụt, xem T7.3"],
    ["/admin/shipping_zones.json", "Vận chuyển — cần cho T7.2"],
    ["/admin/carrier_services.json", "Vận chuyển"],
  ];

  const verdict = (status, body) => {
    if (status === 200) return "CÓ QUYỀN";
    if (/access_denied/.test(body)) return "THIẾU QUYỀN — bật trong Ứng dụng riêng";
    if (status === 403 || status === 404) return "KHÔNG PHẢI ROUTE — đừng gọi từ code";
    return `HTTP ${status}`;
  };

  console.log(`Store: ${domain}\n`);
  for (const [path, label] of paths) {
    let status = 0;
    let body = "";
    try {
      const res = await fetch(`https://${domain}${path}`, { headers: { Authorization: `Basic ${auth}` } });
      status = res.status;
      body = await res.text();
    } catch (err) {
      console.log(`  ${String(path).padEnd(36)} LỖI MẠNG: ${err.message}`);
      continue;
    }
    console.log(`  ${path.padEnd(36)} ${String(status).padEnd(4)} ${verdict(status, body).padEnd(38)} ${label}`);
  }
}
