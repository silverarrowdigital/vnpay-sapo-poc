#!/usr/bin/env node
/**
 * Dev check for /api/revalidate — the Sanity publish webhook.
 *
 * The real webhook cannot be exercised against localhost: Sanity needs a public HTTPS URL. What
 * *can* be checked locally is the part that actually guards the endpoint, and it is the part worth
 * checking, because a signature check that silently passes everything looks exactly like one that
 * works. So this sends four requests with the secret from .env.local:
 *
 *   1. correctly signed productContent  -> 200, clears only the product-content tag
 *   2. correctly signed post            -> 200, clears only the blog tag
 *   3. body changed after signing       -> 401
 *   4. no signature header at all       -> 401
 *
 * An open revalidate endpoint is both a way in and a way to empty the cache in a loop, which would
 * turn the free-plan quota protection into a way to burn quota. Hence the check.
 *
 *   npm run check:revalidate                      # against http://localhost:3000
 *   npm run check:revalidate -- https://host      # against a deployment
 */
import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";

const base = (process.argv[2] ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const url = `${base}/api/revalidate`;
const secret = process.env.SANITY_WEBHOOK_SECRET;

if (!secret) {
  console.error("Thiếu SANITY_WEBHOOK_SECRET. Chạy qua `npm run check:revalidate` để nạp .env.local.");
  process.exit(1);
}

/** Sanity signs the raw body, so the exact string sent is the one signed. */
async function send(label, body, { signature, expect, expectTags }) {
  const headers = { "content-type": "application/json" };
  if (signature !== null) headers[SIGNATURE_HEADER_NAME] = signature;

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    console.log(`✖ ${label}: không gọi được ${url} — ${err.message}`);
    return false;
  }

  const text = await res.text();
  let tagsOk = true;
  if (expectTags !== undefined) {
    let got;
    try {
      got = JSON.parse(text).revalidated;
    } catch {
      got = undefined;
    }
    tagsOk = JSON.stringify(got) === JSON.stringify(expectTags);
  }
  const ok = res.status === expect && tagsOk;
  const detail = expectTags === undefined ? "" : ` tags=${text.trim()}`;
  console.log(`${ok ? "✔" : "✖"} ${label}: HTTP ${res.status} (chờ ${expect})${detail}`);
  return ok;
}

const productBody = JSON.stringify({ _type: "productContent", _id: "productContent-check" });
const postBody = JSON.stringify({ _type: "post", _id: "post-check" });
const tamperedBody = JSON.stringify({ _type: "post", _id: "post-tampered" });

console.log(`Kiểm tra ${url}\n`);

const results = [
  await send("productContent có ký đúng", productBody, {
    signature: await encodeSignatureHeader(productBody, Date.now(), secret),
    expect: 200,
    expectTags: ["product-content"],
  }),
  await send("post có ký đúng", postBody, {
    signature: await encodeSignatureHeader(postBody, Date.now(), secret),
    expect: 200,
    expectTags: ["blog"],
  }),
  // Signed one body, sent another: this is the case a hand-rolled check tends to get wrong.
  await send("body bị đổi sau khi ký", tamperedBody, {
    signature: await encodeSignatureHeader(postBody, Date.now(), secret),
    expect: 401,
  }),
  await send("không có header ký", postBody, { signature: null, expect: 401 }),
];

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? "\nTất cả đạt." : `\n${failed} bài KHÔNG đạt.`);
// exitCode rather than process.exit(): exiting while fetch still holds a handle open makes
// libuv abort with an assertion on Windows, after the output, which reads like a failure and
// is not.
process.exitCode = failed === 0 ? 0 : 1;
