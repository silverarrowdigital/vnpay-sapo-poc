/**
 * Dev-only: tải lại giao diện tham chiếu vào design/reference/site/.
 *
 * Trang mẫu (thehourtea.com) là Shopify Oxygen/Hydrogen — React SSR + Tailwind. Nghĩa là:
 *   - HTML trả về đã render sẵn (220 div, 14 section trên trang chủ), nên đọc được cấu trúc thật;
 *   - toàn bộ CSS nằm trong 2 file build, không có <style> inline nào.
 * Vì vậy curl là đủ; không cần headless browser.
 *
 * Tên file CSS có hash nội dung (app-DnN_kR_S.css), nên mỗi lần họ deploy là hash đổi. Script
 * đọc hash từ <link rel="stylesheet"> của trang chủ thay vì hardcode, nếu không thì lần chạy sau
 * sẽ tải 404 và ghi đè CSS cũ bằng trang lỗi.
 *
 *   node scripts/fetch-reference.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ORIGIN = "https://thehourtea.com";
const OUT = "design/reference/site";

/** Trang nào đáng giữ, và lưu dưới tên gì. Một trang cho mỗi khuôn bố cục cần dựng lại. */
const PAGES = {
  "index.html": "/",
  "shop.html": "/shop",
  "collection.html": "/collections/tea-by-hour",
  "product.html": "/products/tra-oolong-tu-quy-four-seasons-oolong",
  "blogs.html": "/blogs",
  "blog-detail.html": "/blogs/kien-thuc-ve-tra/cach-pha-tra-o-long",
  "cart.html": "/cart",
  "about.html": "/about",
};

/**
 * Font riêng của thương hiệu, self-host ở app/fonts/ khi áp giao diện. Inter và Plus Jakarta Sans
 * cũng được trang mẫu khai @font-face, nhưng chúng là Google Fonts mã nguồn mở nên dự án dùng
 * next/font/google thay vì copy .ttf từ CDN Shopify.
 */
const BRAND_FONTS = {
  "fonts/TheHourTeaSerif.ttf": "The Hour Tea Serif",
  "fonts/TheHourTeaMono.ttf": "The Hour Tea Mono",
};

// Không có User-Agent thì CDN có thể trả về bản rút gọn hoặc chặn.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

async function save(name, body) {
  const path = join(OUT, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  const kb = (body.length / 1024).toFixed(0);
  console.log(`  ${String(kb).padStart(5)} KB  ${name}`);
}

async function main() {
  console.log(`Tải giao diện tham chiếu từ ${ORIGIN}\n`);

  console.log("Trang:");
  const html = {};
  for (const [name, path] of Object.entries(PAGES)) {
    const body = Buffer.from(await (await get(ORIGIN + path)).arrayBuffer());
    html[name] = body.toString("utf8");
    await save(name, body);
  }

  // Hash trong tên file đổi mỗi lần họ deploy, nên đọc từ markup chứ không hardcode.
  const hrefs = [...html["index.html"].matchAll(/<link[^>]+rel="?stylesheet"?[^>]*>/gi)]
    .map((m) => m[0].match(/href="([^"]+)"/i)?.[1])
    .filter((h) => typeof h === "string");
  if (hrefs.length === 0) throw new Error("Không tìm thấy <link rel=stylesheet> nào — markup đã đổi?");

  console.log("\nCSS:");
  let fontCss = "";
  for (const href of hrefs) {
    const url = new URL(href, ORIGIN).href;
    const text = await (await get(url)).text();
    const name = `css/${url.split("/").pop()}`;
    await save(name, Buffer.from(text, "utf8"));
    if (/@font-face/i.test(text)) fontCss += text;
  }

  // Tên file font cũng có hash, nên lấy URL từ @font-face vừa tải.
  console.log("\nFont thương hiệu:");
  for (const [name, family] of Object.entries(BRAND_FONTS)) {
    const block = fontCss.split("@font-face").find((b) => b.includes(encodeURI(family)) || b.includes(family));
    const url = block?.match(/url\("?([^")]+)"?\)/)?.[1];
    if (url === undefined) {
      console.log(`  (bỏ qua) không thấy @font-face cho "${family}"`);
      continue;
    }
    await save(name, Buffer.from(await (await get(url)).arrayBuffer()));
  }

  console.log(`\nXong → ${OUT}/`);
  console.log("Kiểm kê token: design/TOKENS.md (chạy lại T0.2 nếu CSS đổi)");
}

main().catch((err) => {
  console.error(`\nThất bại: ${err.message}`);
  process.exit(1);
});
