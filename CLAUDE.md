# CLAUDE.md — VNPAY → Sapo headless checkout PoC

Source of truth for future work on this repo. Read it before changing anything.

## Purpose

Prove one flow end to end, with the smallest possible system:

**Product → Checkout → VNPAY Sandbox payment → server-side payment verification (IPN) → order created in Sapo.**

Since T7 it is also a shop that can actually take an order: a real Vietnamese address, a delivery
fee, a Sapo discount code, cash on delivery, and a way for the customer to find their order again.

Not a full store: no database beyond Redis, no auth, no accounts, no extra third-party services.

## Architecture

```
Browser                         Next.js (App Router, Node runtime)                External
───────                         ─────────────────────────────────                 ────────
/            product page
/checkout    AddressSelects ─GET /api/locations──► provinces/districts/wards ◄─ Sapo
             CheckoutForm ──POST /api/quote─────► reprice from Sapo, verify code,
             ◄── { goods, discount, ship, total }  quote delivery   (display only)

             CheckoutForm ──POST /api/checkout──► validate, reprice from Sapo,
                                                  resolve address, verify discount,
                                                  quote delivery, store pending
                              ┌── paymentMethod = vnpay ──────────────────────────┐
             ◄── { paymentUrl } ────────────────  sign VNPAY URL  (total = the one amount)
             ── redirect ──────────────────────────────────────────────────────► VNPAY sandbox
                                                  GET /api/vnpay/ipn  ◄──────── VNPAY (server-to-server)
                                                    verify checksum → order → amount → not done
                                                    success? → Sapo POST /admin/orders.json ─► Sapo
                                                               financial_status: paid
             ◄── GET /api/vnpay/return ◄─────────────────────────────────────── VNPAY (browser)
                  verify checksum only, redirect →
                              └── paymentMethod = cod ────────────────────────────┘
             ◄── { successUrl } ──────────────── Sapo POST /admin/orders.json ──► Sapo
                                                  financial_status: pending, no transaction
/success     reads server-side order state (auto-refreshes until the IPN arrives)
/tra-cuu-don OrderLookup ──POST /api/order-lookup► ref + phone → GET /admin/orders.json ─► Sapo
                                                  rate-limited; wrong phone == no order
                                                  same markup prints as the order slip
```

| Path | Role |
|---|---|
| `app/page.tsx` | Catalog grid; each tile links to the product page |
| `app/products/[handle]/page.tsx` | Product page: details, quantity, add to cart |
| `app/checkout/page.tsx`, `components/CheckoutForm.tsx` | Cart editor + delivery form (client) |
| `components/useCart.ts` | Cart state in `localStorage`, read through `useSyncExternalStore` |
| `components/AddToCartForm.tsx`, `components/CartMenu.tsx`, `components/ClearCartOnSuccess.tsx` | Cart controls. `CartMenu` is the header button **and** the drawer in one component, so they share open state without a context |
| `app/api/catalog/route.ts` | Public product data for the cart drawer. Changes nothing about pricing — `/api/checkout` re-prices every line from Sapo |
| `app/blog/page.tsx`, `app/blog/[slug]/page.tsx` | Blog, laid out from the reference and reading Sanity |
| `lib/blog.ts` | Post queries. Throws on failure, unlike `lib/content.ts` — see below |
| `app/api/revalidate/route.ts` | Sanity content webhook → `revalidateTag`. Signature-checked |
| `app/sitemap.ts` | Listings, products and posts |
| `sanity/schemas/post.ts`, `sanity/schemas/author.ts` | Blog schemas. `post.body` uses the same `blocksField` as `productContent` |
| `app/success/page.tsx`, `components/AutoRefresh.tsx` | Result page; server component reading order state |
| `app/api/checkout/route.ts` | Validate input, start checkout, return a VNPAY URL **or** create the COD order |
| `app/api/quote/route.ts` | Price a cart for display: goods, discount, delivery, total. Calls the same `quoteTotals` the real checkout uses, so the summary cannot drift from the charge |
| `app/api/locations/route.ts` | Provinces / districts / wards, one level at a time. Refuses to serve a whole table |
| `app/api/order-lookup/route.ts` | Reference + phone → one order. A wrong phone and a missing order answer identically |
| `app/tra-cuu-don/page.tsx`, `components/OrderLookup.tsx` | Customer order lookup, and the printable slip (same markup, `@media print`) |
| `components/AddressSelects.tsx` | Tỉnh/thành → quận/huyện → phường/xã, cascading |
| `components/formField.ts` | The one input style, shared by the form's two components |
| `app/api/vnpay/return/route.ts` | Browser return: checksum check + redirect. **Never mutates state.** |
| `app/api/vnpay/ipn/route.ts` | VNPAY IPN: **the only place a *paid* Sapo order is created** (COD creates an unpaid one — security rule 2) |
| `lib/vnpay.ts` | VNPAY URL building, HMAC-SHA512 signing/verification, date format, codes |
| `lib/sapo.ts` | Sapo Admin API client: payload, create, idempotent lookup |
| `lib/order.ts` | Validation, totals, IPN state machine, COD order creation, rate-limit policies, order lookup |
| `lib/shipping.ts` | Delivery fees — **client-safe**, and the only place a fee is computed |
| `lib/discount.ts` | Sapo `price_rules` → a verified, server-computed discount |
| `lib/locations.ts` | Vietnam's administrative divisions, read from Sapo and memoised per process |
| `lib/store.ts` | Pending-order storage + the cross-instance processing claim: Redis when configured, in-memory Map otherwise |
| `lib/config.ts` | Env var reading + `MissingEnvError` |
| `lib/product.ts` | Hardcoded product (safe for client import) |
| `lib/blocks.ts` | CMS block shapes — **types only, client-safe** (see conventions) |
| `lib/sanity.ts` | Sanity read client + `groqQuery` (swallows every failure) |
| `lib/content.ts` | `getProductContent` + `BLOCKS_PROJECTION` shared with the blog |
| `components/blocks/*` | One component per block type + `BlockRenderer` |
| `sanity.config.ts`, `sanity.cli.ts`, `sanity/schemas/*` | Hosted Studio config + schemas |
| `lib/log.ts` | JSON logger |
| `scripts/simulate-ipn.mjs` | Dev-only signed IPN simulator |
| `scripts/replay-ipn.mjs` | Dev/recovery: replay a real VNPAY callback query string at our IPN endpoint |
| `scripts/auto-ipn.mjs` | Dev/recovery: find that callback in the dev log by itself (`--watch` to follow) |
| `scripts/fetch-reference.mjs` | Dev-only: re-download the UI reference into `design/reference/site/` |
| `scripts/check-revalidate.mjs` | Dev-only: four signed/unsigned requests at `/api/revalidate`, checking what the signature guard actually refuses |
| `scripts/querydr.mjs` | Ask VNPAY what really happened to a transaction (API 2.1.0 `querydr`). Read-only; prints the one command that would finish the order |
| `design/TOKENS.md` | Where every design token came from, with its source |
| `docs/huong-dan-them-san-pham.md` | Shop-owner guide (Vietnamese, no CLI): add a Sapo product, then its Sanity content. Written for someone who is not a developer |

`lib/*` is framework-independent (no `next` imports) so it can be tested in isolation. Inside `lib/`, use relative imports; app code uses `@/`.

## Coding conventions

- TypeScript strict. **Tailwind CSS v4** (`@import "tailwindcss"` in `app/globals.css`, `postcss.config.mjs`), plus project CSS in the same file. No `tailwind.config.js` — v4 scans the project itself and declares tokens with `@theme`.
  - Chosen so the storefront can be rebuilt faithfully from `design/reference/`, which is a Tailwind site: sharing the utility vocabulary makes the reference markup comparable class by class. An earlier decision said "plain CSS, no framework"; it was made partly on a Tailwind detection I mis-read, and is reversed. See `docs/plan/T3-ui-redesign.md`.
  - Preflight (Tailwind's reset) removes browser defaults. Anything relying on them must be declared — e.g. `ul`/`ol` bullets in CMS rich text (`.rt-list`).
- Server-only modules (`config`, `vnpay`, `sapo`, `order`, `log`, `sanity`, `content`, `discount`, `locations`) must never be imported from a `"use client"` file. **Three** modules in `lib/` are client-safe: `lib/product.ts`, `lib/blocks.ts` — which holds types only and whose single import is type-only (erased at compile time), what `ImageSlider`/`VideoEmbed` need — and `lib/shipping.ts`. Keep them that way: no config, no client, no logger.
  - `lib/shipping.ts` is client-safe **so that there is exactly one fee calculation**. The fee has to show in the checkout summary, be added to the amount the VNPAY URL is signed with, and be sent to Sapo as a `shipping_line`; the plan's third big risk is those three disagreeing. One pure function used by all three makes them agree by construction, and the browser only ever displays what it returns.
- The UI is built from the token layer at the top of `app/globals.css` (`--ink`, `--accent`, `--step-*`, `--space-*`, `--radius-*`, `--font-*`), extracted from `design/reference/` with every value's source recorded in `design/TOKENS.md`. New components use the variables; no hardcoded colours or pixel values. There is **no dark mode** — the reference design has one theme, so inventing a second with nothing to check it against was not worth the contrast work.
- Prices are always computed on the server from the live Sapo catalog; never trust amounts from the browser. That now covers three numbers, not one: the goods subtotal, the **delivery fee** (from the resolved province) and the **discount** (from a Sapo price rule). The browser sends quantities, three address ids and a discount *code* — nothing else about money.
- Log with `log.info/warn/error(event, data)`. Never log secrets or full customer records (txnRef, amounts, codes, Sapo ids are fine).
- Keep integrations in their module; routes stay thin.

## Environment variables

See `.env.example`. All server-only (no `NEXT_PUBLIC_` prefix).

| Name | Required | Notes |
|---|---|---|
| `APP_BASE_URL` | yes | Public HTTPS base URL; return URL = `${APP_BASE_URL}/api/vnpay/return` |
| `VNPAY_TMN_CODE` | yes | Sandbox terminal code |
| `VNPAY_HASH_SECRET` | yes | Sandbox hash secret |
| `VNPAY_PAYMENT_URL` | no | Defaults to `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` |
| `SAPO_STORE_DOMAIN` | yes | e.g. `your-store.mysapo.net` |
| `SAPO_API_KEY` / `SAPO_API_SECRET` | yes | Sapo Private App credentials, Orders read+write |
| `SAPO_VARIANT_ID` | no | Attach line item to a real Sapo variant instead of a custom line item. Also enables stock deduction (see below) |
| `SAPO_SEND_RECEIPT` | no | `true` asks Sapo to email the customer its own order confirmation. Off by default on purpose — see below |
| `VNPAY_QUERYDR_URL` | no | Override for the `querydr` endpoint used by `npm run querydr`. Defaults to the sandbox one |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | no locally, **yes on serverless** | Redis (Upstash) for the shared pending-order store. Injected by Vercel's Marketplace Redis integration |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | no | Same thing under Upstash's own names, for a database created outside Vercel. Takes precedence over the `KV_*` pair |
| `ORDER_STORE_NAMESPACE` | no | Overrides the Redis key namespace (see below). Empty string selects production's |
| `SANITY_PROJECT_ID` | no | Unset ⇒ the CMS is simply off and the product page shows Sapo's plain-text description |
| `SANITY_DATASET` | no | Defaults to `production` |
| `SANITY_API_VERSION` | no | Pinned date, defaults to `2026-10-01`. Never `v1`/`vX` |
| `SANITY_READ_TOKEN` | no — **leave empty** | A token forces reads past the CDN to the origin: slower, and against the costlier quota the free plan hits first. Kept only for a future draft-preview mode |
| `SANITY_STUDIO_PROJECT_ID` / `SANITY_STUDIO_DATASET` | no | Same two values again. Only the `SANITY_STUDIO_` prefix reaches the Studio bundle, so the CLI needs its own pair. Not used by the storefront |
| `SANITY_WEBHOOK_SECRET` | for the webhook | Shared secret for `/api/revalidate`. Unset, that route refuses every request |

Missing variables raise `MissingEnvError`; `/api/checkout` returns 500 with a generic message and logs the names. Checkout also fails fast if Sapo is not configured, so we never take a payment we cannot record.

A value copied unchanged from `.env.example` counts as **not configured**: `lib/config.ts` rejects anything starting with `YOUR_` plus the literals `your-store.mysapo.net` and `https://your-public-url.example.com`. `MissingEnvError` carries `missing` (absent/empty) and `placeholder` (still a dummy) separately. In development only (`NODE_ENV !== "production"`) `/api/checkout` echoes both lists as variable **names** in its JSON error so the checkout form can say what to fix; production keeps the generic message. Values are never returned or logged.

## Security rules

1. VNPAY and Sapo credentials live only in env vars and server code.
2. **Payment success is decided only by a checksum-verified IPN, and only the IPN may mark an order
   paid.** The return URL is display-only. COD (T7.5) opens the second and only other door into
   Sapo, so the rule is stated as two halves that must both hold:
   - A **VNPAY** order is created only by `app/api/vnpay/ipn/route.ts`, and only ever as
     `financial_status: "paid"`.
   - A **COD** order is created only by `placeCodOrder` in `lib/order.ts`, and only ever as
     `financial_status: "pending"`, with **no `transactions` array**. Nothing on that path can
     mark an order paid, so no amount of calling it can fabricate a payment record — only an
     unpaid order a human confirms by phone. What it *can* produce is junk orders, which is what
     the rate limit on `/api/checkout` is for.
3. IPN check order (from VNPAY docs): checksum (97) → order exists (01) → amount matches (04) → not already confirmed (02) → apply result.
4. Success requires `vnp_ResponseCode === "00"` **and** `vnp_TransactionStatus === "00"`.
5. Signature comparison is constant-time.
6. No customer data in URLs; the result page URL carries only txnRef, outcome, response code. The
   order-lookup page accepts a prefilled reference in its query string but **never** the phone
   number, so a shared link is not a shared address book.
7. Never invent API endpoints. Anything new must be checked against the official docs listed below.
8. **No CMS content is ever rendered as HTML.** `htmlToText` already strips Sapo's description; Sanity rich text goes through Portable Text into our own React elements (`components/blocks/RichText.tsx`). No `dangerouslySetInnerHTML` anywhere.
9. **A video block stores `provider` (enum) + `videoId` (regex-validated), never a URL and never an iframe.** The player address is assembled in `components/blocks/VideoEmbed.tsx`, so nothing typed into the CMS can retarget the frame. The iframe is also not created until the reader presses play, so a reader who never watches sends no request to the video host.
10. Links in CMS rich text are restricted by schema to `http`, `https`, `mailto`.
11. **A discount is a code from the browser and an amount from the server.** `/api/quote` exists to
    display a total and is otherwise worthless: `/api/checkout` re-verifies the code against Sapo
    and recomputes the money before signing anything. Accepting an amount from the browser would be
    a gift to anyone who can open DevTools.
12. **The order lookup is rate-limited and answers failures identically.** A reference is a
    timestamp plus six digits — guessable with enough tries — so the phone-number check is backed by
    a counter in the shared store, and "wrong phone" is indistinguishable from "no such order".

## VNPAY flow (API 2.1.0) — verified docs

Docs: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html

- Payment: `GET https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` with `vnp_Version=2.1.0, vnp_Command=pay, vnp_TmnCode, vnp_Amount (VND×100), vnp_CurrCode=VND, vnp_TxnRef, vnp_OrderInfo (no diacritics/special chars), vnp_OrderType=other, vnp_Locale=vn, vnp_ReturnUrl, vnp_IpAddr, vnp_CreateDate, vnp_ExpireDate (+15 min)`; dates `yyyyMMddHHmmss` in GMT+7.
- Checksum: sort params by key ascending, `key=value` joined with `&`, URL-encoded PHP-style (space → `+`), `HMAC-SHA512(hashSecret)` hex → `vnp_SecureHash`. Verification excludes `vnp_SecureHash` and `vnp_SecureHashType`.
- IPN: GET to the IPN URL **configured in the VNPAY merchant portal** (not a request param). Must answer JSON `{"RspCode","Message"}`. VNPAY stops retrying on `00`/`02`, retries on `01/04/97/99` (up to 10×, 5-min interval).

**Configuring that portal IPN URL (sandbox), verified on a live terminal.** The page is
`https://sandbox.vnpayment.vn/merchantv2/Account/TerminalEdit.htm` — reachable directly; the menu
path is the top-right account menu, and the edit icon sits at the far right of the website row, so
the table has to be scrolled sideways to find it. Pick the row whose terminal is the `vnp_TmnCode`
the app actually sends; an account with several websites will otherwise look configured and never
receive an IPN. The form holds three fields: IPN URL, **Giao thức IPN** = `GET` (the route only
exports GET, so POST answers 405) and **Kiểu mã hóa** = `HMACSHA512`.

Two traps, both hit for real:

- **`HMACSHA512` is not in the "Kiểu mã hóa" dropdown** on a 2.1.0 terminal — it offers only
  `MD5`, `TriDes`, `SHA256`, all from older API versions, while the stored value shows as
  `HMACSHA512`. Do not re-save the form once it is right: picking any listed value would downgrade
  the terminal below what `lib/vnpay.ts` signs with. A save also once made the terminal vanish from
  the list for several minutes before it came back intact.
- **A payment URL cannot be checked with `curl -L` alone.** `vpcpay.html` answers `302` to
  `/paymentv2/Transaction/PaymentMethod.html?token=…` and that page needs the cookie from the
  redirect, so a cookie-less follow lands on `paymentv2/Payment/Error.html` and looks exactly like a
  dead terminal. Use a cookie jar (`curl -sL -c jar -b jar`); a working terminal then renders
  "Chọn phương thức thanh toán (Test)".

With all three fields right the flow is fully automatic: verified live, `vnp_PayDate 20260930132702`
(GMT+7) and Sapo order `#1015` created at `06:27:10Z` — **8 seconds** after the payment, with no
replay, and a repeated IPN answering `02` while stock stayed put.
- txnRef: `yyyyMMddHHmmss` (GMT+7) + 6 random digits.
- Sandbox test card (NCB): `9704198526191432198`, `NGUYEN VAN A`, issue `07/15`, OTP `123456`.

## Sapo flow — verified docs

- Auth (Private App): HTTP Basic with API Key : API Secret — https://support.sapo.vn/ung-dung-rieng-private-apps
- Create: `POST https://{store}/admin/orders.json` `{ "order": {...} }` — https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2
- List: `GET /admin/orders.json?status=any&created_on_min=...&fields=...` — https://support.sapo.vn/phuong-thuc-get-cua-order-phan-1
- Attributes (`financial_status`, `note_attributes`, `tags`, `source_name`) — https://support.sapo.vn/cac-thuoc-tinh-cua-order-api

Payload sent (see `buildOrderPayload`): email, phone, `line_items` — one per cart line, each either `{variant_id, quantity, price}` or, with no variant, custom `{title, sku, price, quantity}`, `customer {first_name, last_name, email, phone}`, billing + shipping address (`address1`, `country: Vietnam`), `financial_status: "paid"`, `transactions [{kind: sale, status: success, amount, gateway: VNPAY}]`, `note`, `note_attributes` (vnp_TxnRef, vnp_TransactionNo, vnp_BankCode, vnp_PayDate, sku, amount_vnd), `tags` (`headless-poc, vnpay, vnpay-<txnRef>`), receipts off.

**T7 additions to the payload, every one verified on a live order (#1025, COD, 2026-10-05, created
through `/api/checkout` itself and then deleted).** The order was goods 268,000 − discount 26,800 +
delivery 25,000:

- **`shipping_lines` IS persisted** — unlike `transactions`. Sent as `{title, code, price, source}`
  and read back with `carrier`, `carrier_name`, `discount_allocations`, `tax_lines` added by Sapo.
  `total_shipping_price` came back 25,000.
- **`discount_codes` is persisted and counted.** Sent as `{code, amount, type: "fixed_amount"}`, it
  came back with `"custom": true` and `discount_applications[0].price_rule_id: **null**` — which
  looks like the rule was not matched. **It was:** the rule's `times_used` and the code's
  `usage_count` both went 0 → 1. So the `usage_limit` check in `lib/discount.ts` reads a counter
  Sapo really does maintain for API-created orders. Do not "fix" the null `price_rule_id`.
- **The discount is sent as the amount we charged, as `fixed_amount`, even for a percentage rule.**
  Sending `percentage` would ask Sapo to recompute it, and one đồng of rounding difference would put
  the order total out of step with the money VNPAY took. It lands at order level:
  `cart_discount_amount` 26,800, while `line_items[].total_discount` stays 0.
- **`total_price` came back 266,200** — exactly goods − discount + shipping, i.e. the number the
  summary showed and the number VNPAY would be asked for. The three places agree.
- **`district`/`district_code`/`ward`/`ward_code` are stored**, even though the attribute docs stop
  at `province`. Sapo also **filled `city` itself** ("TP Hồ Chí Minh") from the province, which is
  why `buildOrderPayload` does not send one.
- **A COD order comes back `financial_status: "pending"`, `unpaid_amount` = the total,
  `net_payment: 0`, `gateway: null`.** The null gateway is expected: Sapo derives the order's
  top-level gateway from `transactions`, and a COD order deliberately sends none. Its payment
  method lives in `note_attributes.payment_method`, the note and the tags.
- **Stock moves on a COD order too** (115 → 114 on a quantity of 1), because the line carries a
  `variant_id` and the payload sends `inventory_behaviour`. That is right for COD — the goods are
  committed — but it means **a cancelled COD order needs a manual restock**.
- **A variant's `inventory_quantity` is "có thể bán" (available), not "tồn kho" (on hand).** Verified
  2026-10-05: the admin showed on hand 119 and available 114 for `TEST-005` while the API returned
  `inventory_quantity: 114`; the gap was exactly the 5 units committed by open, unfulfilled order
  #1024 (`fulfillable_quantity: 5`). Available is the right number to sell against and is what
  `maxOrderableQuantity` already reads — on hand would oversell goods already promised to an open
  order. It also means **a stock correction is made against on hand**, which is the only one of the
  two the admin lets you edit; available then recomputes itself.
- **`DELETE /admin/orders/{id}.json` does not restock and does not decrement `times_used`.**
  Verified on the same order: deleting it left stock at 114 and the code's usage at 1. A deleted
  test order is not an undone test order.
- **`?fields=` is ignored on `GET /admin/orders.json`** — the full object comes back regardless.
  Harmless (it is a superset), but do not rely on it to keep a response small.

**Discounts live in `price_rules`, and the code is not where it looks.** Verified against a live store on 2026-10-02 with one real rule created for the purpose:

- `GET /admin/price_rules.json` is the discount system. `/admin/discounts.json` answers `access_denied` even with the Khuyến mãi scope on, and a top-level `/admin/discount_codes.json` is not a route at all — neither is needed, and neither should be chased by granting more access.
- **The customer-facing code is not the rule's `title`.** It lives in `GET /admin/price_rules/{id}/discount_codes.json` → `{"discount_codes":[{id, code, usage_count}]}`. A rule's title merely happened to equal its code in the test because both were typed the same; matching on `title` would be matching on a label an editor can rename freely.
- **`?code=` and `?title=` are silently ignored — they return every rule.** Only `?query=` filters, and it is a **fuzzy, case-insensitive substring search**: `?query=T` returns `TEST10`. So it narrows the candidates and never identifies one. Re-check the exact `code` on the nested resource before honouring anything, exactly as `findOrderByTxnRef` re-checks the tag. This is the `?tag` / `?tags` trap in a second place.
- Value shape: `value` is a **negative string** (`"-10"`) with `value_type: "percentage"`. Conditions ride on `status`, `starts_on`, `ends_on`, `usage_limit` vs `times_used`, `once_per_customer`, `prerequisite_subtotal_range`, `prerequisite_quantity_range`, `value_limit_amount` and the `entitled_*_ids` lists. `summary` carries a ready-made Vietnamese sentence ("Giảm 10% cho toàn bộ đơn hàng") worth showing the customer rather than re-deriving.

**Two Sapo deviations from the Shopify-style API, both verified against a live store:**

- **No `source_name`.** Sapo reserves values like `web`/`pos` for its own channels and rejects a private app that sets one: `HTTP 422 {"errors":{"source_name":["cannot be set to a protected value by an untrusted API client."]}}`. The order is identified by `tags` and `note_attributes` instead.
- **No `status=any` on the idempotency lookup.** Shopify's `status=any` is not valid on Sapo: it returns `HTTP 200` with an **empty** list, so `findOrderByTxnRef` always returned `null` and the Sapo-side duplicate guard was silently dead. `GET /admin/orders.json` is now sent without a `status` filter (Sapo's default covers open orders, which is what an IPN retry looks for). Valid values are `open`/`closed`/`cancelled`.
- **Filter with `tag`, never `tags`.** The singular `?tag=vnpay-<txnRef>` filters server-side on the **whole** tag (a prefix of the tag matches nothing, an unknown tag returns an empty list). The plural `?tags=` is silently ignored and returns every order. Both verified against a live store.

Also observed on a live store: `transactions` is **not** persisted on an API-created order (confirming Sapo's own note), but `gateway` is — so the VNPAY trail survives in `gateway`, `note`, `note_attributes` and `tags`. `source_name` is assigned by Sapo itself to the private app's id. `GET /admin/orders/{id}.json` returns no `line_items`; read them from the list endpoint with `fields=...,line_items`.

**`SAPO_VARIANT_ID` links the line item and now also moves stock.** With it set, the payload sends `{variant_id, quantity, price}` and Sapo fills `title`/`sku` from the catalog — so the order shows the catalog's product name, not `PRODUCT.name`.

Stock deduction is explicit: without an `inventory_behaviour` field Sapo defaults to `bypass` and never touches stock (https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2). `buildOrderPayload` therefore sends `inventory_behaviour: "decrement_ignoring_policy"`, but **only when `cfg.variantId` is set** — a custom line item has no variant to deduct.

`decrement_ignoring_policy` is chosen over `decrement_obeying_policy` on purpose: this code only runs after the payment is verified, so a refusal for being out of stock would leave money taken and no order (IPN `99` → VNPAY retries → still fails). Overselling into negative stock is an ops problem; a paid transaction with no order is a money problem. Verified live: stock 10 → 8 after a paid order of 2, and an order of 10 against a stock of 8 still succeeded (`RspCode 00`, stock `-2`).

Sapo's Order API overview notes payment info/transactions may not be stored for API-created orders; the VNPAY references are therefore also in `note` and `note_attributes`.

## Sanity CMS flow

Holds how a product is *presented* (and, from T2, the blog). Never price, never stock, never anything checkout reads.

- Client: `@sanity/client`, not `next-sanity` — `lib/*` must stay framework-independent, and next-sanity's value is its Next cache wrapper, which belongs at the app layer. `useCdn: true`, `perspective: "published"` (an editor's draft is not a product page), `timeout: 5000`.
- **Matched on `sapoProductId`.** `alias` changes when a product is renamed and `variantId` changes when a variant is recreated; the product id is stable for the product's whole life. `SapoCatalogEntry` always had it but `toCatalogProduct` dropped it — now carried through to `CatalogProduct`, which is the only reason that field exists.
- Blocks are read with `BLOCKS_PROJECTION` (`lib/content.ts`), shared with the blog so the two cannot drift. Its `...` spread carries simple block types through untouched, so a new block type needs no query change. Five conditional overrides resolve image assets to URLs **in the query**, which is why there is no `@sanity/image-url` here: Sanity's CDN takes sizing as query parameters, so `components/blocks/imageUrl.ts` is a pair of string helpers. Intrinsic `w`/`h` come along so markup reserves the box.
- **`BlockRenderer` returns `null` for a `_type` it does not know.** An editor can publish a block before the code that draws it ships; a missing section beats a 500.
- **Twelve block types** (`sanity/schemas/blocks/index.ts`, one component each in `components/blocks/`): `richText`, `imageSlider`, `faq`, `videoEmbed`, `specs`, `callout` (T1), `logoRow`, `steps`, `featureGrid`, `comparisonTable` (T4), `brewProfile`, `ingredientCards` (T5). Because `blocksField` and `BLOCKS_PROJECTION` are shared, **every one of them works in a blog post as well as on a product page**. All of the T4 and T5 ones are server components; none holds state, so they add no JavaScript.
  - `brewProfile` carries the brewing numbers **and** the light-to-strong scale in one block, because the reference draws them as one panel; splitting it would leave an unwritten rule that the two must always sit together. The bar is `role="img"` with the whole reading in its label rather than `role="meter"` — the latter says it more precisely but is announced unevenly, and a bar with no text equivalent hides the strength of the tea from anyone not looking at it.
  - `ingredientCards` differs from `featureGrid` in that the card body is a **list of tags**, not a paragraph. Flattening the tags into a sentence to reuse `featureGrid` would lose the list semantics a screen reader needs.
- **`productContent.meta` is document-level, not a block, and `getProductContent()` returns `{ meta, blocks }`.** The buy-box facts (quy cách, loại trà, caffeine, hương vị, hợp với, huy hiệu lợi ích) are drawn in a fixed order beside the price; as a block an editor could drag them below the description, where they mean nothing. The buy box drops any row whose value is missing rather than printing a label with nothing after it. **Changing this shape changes what sits in the cache while the cache key stays the same** — the deploy that introduced it had to be followed by a revalidate, or pages would have handed the new code an array where it expects an object and silently rendered nothing.
- **An optional CMS field reaches the code as `null`, not as an absent key.** GROQ projects `"image": image{…}` or `"poster": poster.asset->url` to `null` when the editor left it empty (verified against the live dataset), so a `!== undefined` test reads "no image" as "image present" and emits `src="null?w=1024…"`. That was a live bug in `VideoEmbed`, found while writing the T4 blocks and fixed with them. Optional block fields are therefore typed `?: T | null` in `lib/blocks.ts` and tested by truthiness. A field the editor never touched at all can also be **missing entirely** — `comparisonRow.cells` arrives with no key — which is why it is typed `cells?: string[] | null`.
- **The comparison table scrolls sideways on purpose; do not make it fit the screen.** Eleven columns squeezed into 390px is not a readable table. `ComparisonTable` puts `overflow-x-auto` **and `min-w-0`** on a wrapper that is also a focusable `role="region"` (without `tabindex` the scroll is mouse-only), and pins the label column with `sticky left-0` so a reader at column nine still knows the row. `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`, and without it the table can widen its ancestor instead of scrolling — which is how a wide table ends up scrolling the whole page. Both axes carry `<th scope>`.
- **`.blocks` declares `overflow-wrap: break-word`, and that one line is load-bearing.** CMS text is typed by a person, and sooner or later somebody pastes a URL — a token with nowhere to break. Without the rule it widens the grid track holding it and pushes the *whole page* into horizontal scroll at phone width, while desktop looks fine. It is declared on the container rather than per component because `overflow-wrap` inherits, so it also covers block types written later. Found by feeding a 140-character unbroken string through `featureGrid`, `steps` and a `comparisonTable` label: all four text elements had no guard.
- **A mismatched cell count cannot break the table.** A short row is padded with an `aria-hidden` em dash (the cell stays empty to a screen reader, which is the truth) and a long one is cut to the header width; the Studio only *warns*, so an editor is never blocked mid-table. `steps` numbers itself from array position for the same reason — no field to renumber by hand.
- **Document ids must not contain a dot. No read token is needed.**

  The storefront reads anonymously, which is what keeps it on Sanity's CDN and off the costlier request quota. That works because of the dataset's `_.groups.public` grant, whose filter is `_id in path("*")` — **one** asterisk, which matches only ids with a *single* path segment. A dot starts a new segment.

  A document created as `productContent.92442610` is therefore two segments and invisible to an anonymous read; `productContent-92442610` is one segment and visible. This was found the slow way: anonymous queries returned HTTP 200 with `result: 0` while authenticated ones returned `1`, and the only documents anonymous callers could see were image assets — whose ids (`image-<hash>-1200x900-png`) happen to contain no dots. A read token was added to work around it before the cause was understood; the token has since been deleted and the id renamed.

  Studio-created documents get a UUID, which has no dots, so **this only bites ids assigned by hand** (`sanity documents create`, migrations, seed scripts). Use a dash.

  Drafts stay private either way: `drafts.<id>` has a dot, so the same grant excludes it — which is also why `perspective: "published"` is belt and braces rather than the only guard.
- **In development, a stale `unstable_cache` entry survives a server restart.** Hit for real: the product page was queried before the token existed, cached `null` for its 300 s window, and then kept serving `null` across two full `next dev` restarts — the fix was `rm -rf .next`. `.next/cache` showed only `turbopack`, so the entry is not where you would look for it. When CMS content does not appear after an env or content change, clear `.next` before suspecting the query.
- Studio is **hosted** (`npm run studio:deploy` → `*.sanity.studio`), not embedded. That keeps `sanity` a devDependency out of the Next build and lets the "no `NEXT_PUBLIC_`" rule stand. `sanity.config.ts` sits at the repo root because the CLI resolves it from the working directory; the schemas are in `sanity/schemas/`.
- One `productContent` document per product, enforced at edit time by an async uniqueness check on `sapoProductId` (a draft and its published version are not duplicates of each other). Two documents would make which one renders arbitrary.

## Storefront UI (T3)

Rebuilt from `design/reference/` — the owner's own site, saved by `npm run fetch:reference`. Plan and per-step notes: `docs/plan/T3-ui-redesign.md`.

- **The token layer now comes from the Figma design, not from measuring the live site (T6).** `design/the-hour-tea-nextjs-design.md` inspects the Figma source and gives named variables: page `#f3f0ec` (`sp-cream`), ink `#0b1012` (`sp-ink`), action `#f1a400` (`sp-light`), divider ink at 22%, white `#ffffff`. Type is **Manrope** throughout — the serif in the live site's headings is lettering printed on the packaging, which is photography, not an interface font. Radii collapse to 0/4/6. The measured values below are what shipped before and are kept because they explain how the earlier layer was derived; where the two disagree, the design document wins.
  - **Amber is an action colour, never a text colour.** On the paper background it reads 1.84:1, so the three places that used `text-primary` for text — in-stock count, the success state, the step number — moved to `--ok` and `--ink-soft`. `--color-primary-fg` is **ink, not white**: white on amber is 2.09:1 and every button in the project pairs `bg-primary` with `text-primary-fg`, so leaving it white would have broken the label on all of them at once. Ink on amber is 9.16:1.
  - The design document has no token for the top announcement strip. It is ink with page-coloured text, following the document's "dark editorial strip"; white on a near-white page would have made the strip vanish.
- **Colours and geometry were measured, not eyeballed (T3, superseded for colour).** `scratchpad` scripts decoded the screenshots and took the most common colour per region, and found the grid by scanning for tile edges: page `#e7dacc`, banner `#edd2b9`, cream band `#f4ebe1`, primary `#357a38`; three 328px columns with a 16px gap. They live in `@theme` in `app/globals.css`; `design/TOKENS.md` records each one with the confidence it was measured at.
- **T0's colour layer was wrong and is superseded.** It read the reference's `:root` declarations, which gave a white page and an orange `#BF4800` button; the rendered site is a warm beige page with a green button, and `#BF4800` is not used as a button anywhere on the eight pages saved.
- **`formatVnd` follows the reference** (`₫248,000`, symbol first, comma groups) rather than the usual Vietnamese convention. One function, used everywhere — pricing a tile one way and the checkout another would be a bug, not fidelity. Reverting is a one-line edit in `lib/product.ts`.
- **Nav keeps the reference's links; the unbuilt ones 404** (`/wholesale`, `/ve-chung-toi`, `/lien-he`). A link to something that does not exist should say so rather than be quietly dropped.

**In the reference, deliberately not built — all for want of data, not CSS:**

| | Why |
|---|---|
| Variant picker (95G / 200G / …) | This project takes one variant per product, the first by `position` |
| Customer reviews | No source — Sapo does not provide them and no schema exists |
| Multi-image product gallery | Sapo returns one image per product; the grid holds a single cell. A Sanity `imageSlider` block can carry more |
| Filter sidebar | The reference reserves a wide left column for facets, which is why its grid sits off-centre. Sapo gives us none, so the grid is centred instead of leaving a 404px gap |
| Payment brand marks | Third-party assets, and this project only takes VNPAY — it says so in words |
| Logo artwork | A text wordmark is used; this is a different project |

## Staying on Sanity's free plan

The binding limit is **API requests**, so the architecture aims at one thing: **traffic to Sanity should scale with how often content is edited, not with how many people read it.** Four rules hold that line, and breaking any one of them quietly reintroduces per-visitor requests.

| # | Rule | Where |
|---|---|---|
| 1 | Every CMS query is cached — blog for an hour, product content for five minutes | `unstable_cache` in the page modules |
| 2 | A webhook clears the cache on publish, so long windows cost no freshness | `app/api/revalidate/route.ts` |
| 3 | Posts are prerendered | `generateStaticParams` in `app/blog/[slug]/page.tsx` |
| 4 | Sanity images go through `next/image`, which resizes once and caches | `next.config.ts` `remotePatterns` |

- **No read token.** A token forces reads past Sanity's CDN to the origin — slower, and against the costlier quota. See "Document ids must not contain a dot" for why one briefly seemed necessary.
- **Changing `BLOCKS_PROJECTION` requires a revalidate right after the deploy, or pages keep serving data shaped by the *old* query.** The `unstable_cache` key is built from the function's arguments, not from the query text, so a cached entry written before the deploy survives it and is handed to components that now expect a different shape. Hit for real on 2026-10-02: minutes after shipping T4, `/products/test-product-1` rendered the `featureGrid` headings with **no images**, while the three products whose cache was populated after the deploy were fine. The old projection returns `image` as the raw object — it has `alt` and `asset._ref` but no `url` — so the component's truthiness check passes and `src` is `undefined`. **Nothing errors**: the page does not 500, no warning is logged, the images simply are not there. One signed request to `/api/revalidate` fixed it. Treat a projection change as needing that request, the same way a content change needs the webhook.
- **After a tag is invalidated, the *next* request still serves the stale page.** `unstable_cache` is stale-while-revalidate: the first request after `revalidateTag` returns the old content and kicks off the refresh, the second returns the new. Verified on 2026-10-02 — a product page looked unchanged right after a publish and was correct one request later. Do not conclude from a single reload that the webhook is broken.
- **Publishing a block type the deployment does not know yet is safe, and was demonstrated in production.** On 2026-10-02 the T4 content was published while production still ran pre-T4 code: the two `faq` blocks rendered and `steps`, `featureGrid` and `comparisonTable` silently rendered nothing, exactly as `BlockRenderer`'s unknown-`_type` branch intends. Content can therefore be entered before the code that draws it ships.
- **The webhook is configured and live.** `sanity hook list` shows it as `SAPO VNPAY POC` on `production` → `POST https://vnpay-sapo-poc.vercel.app/api/revalidate`. That command is also the only record of the production URL — nothing else in the repo had it. Verified 2026-10-02 by running `npm run check:revalidate` against the deployment: all four cases passed, which also proves `SANITY_WEBHOOK_SECRET` is set there and matches the local one (an unset secret answers `503`, a mismatched one `401`).
  - **`sanity hook list` does not print the hook's filter or projection**, so those cannot be checked from here. The route reads `_type` out of the body to narrow the tag, so the projection should include it (`{_type, _id}`); without it the route still works but falls back to clearing *both* tags on every publish. To tell which is happening, look for `"event":"revalidate.done"` in the deployment logs — `documentType: "unknown"` means the projection is not sending `_type`.
- **`/api/revalidate` refuses everything when `SANITY_WEBHOOK_SECRET` is unset**, and signature-checks every request with Sanity's own `@sanity/webhook`. An open revalidate endpoint is both a way in and a way to empty the cache in a loop, which would turn rule 2 into a way to *burn* quota. (The VNPAY HMAC is hand-rolled because that scheme is documented and verified here; getting Sanity's subtly wrong would leave a check that looks present and is not.)
- **The webhook needs a public HTTPS URL**, so like the VNPAY IPN it cannot be exercised against `localhost`. Signature handling is verified locally instead, by `npm run check:revalidate`: a correctly signed `productContent` clears only the `product-content` tag, a signed `post` only `blog`, a body changed after signing is refused `401`, and so is a request with no signature header. Point it at a deployment with `npm run check:revalidate -- https://host`.
- **Product images come from Sapo, not Sanity**, so Sanity asset bandwidth stays low. Post covers touch it, and from T4 so do `logoRow`/`steps`/`featureGrid` images on a product page — which is why those three blocks render through `next/image` rather than the `imageUrl.ts` helpers the older blocks use: Next resizes once and caches, so repeat views cost no Sanity bandwidth. They pass the **bare** asset URL, because `next.config.ts` pins `search: ""` on `cdn.sanity.io` and a URL carrying `?w=…` would be refused.

To check the rules still hold: note the request count on the project's Usage page, load `/blog` and a few posts twenty times, and look again. It should barely move. If it tracks page loads, one of the four has been lost.

## Important implementation decisions

- **The blog reports CMS outages; a product page hides them.** `lib/content.ts` swallows every failure into `undefined` because the product page has Sapo's own description to fall back on. `lib/blog.ts` uses `groqQueryOrThrow` instead, because a blog has no fallback and an empty listing would be a lie. Both call the same client; the difference is only which helper they use.
- **`sanity documents create` silently ignores NDJSON.** It takes a single document or a **JSON array**; given newline-delimited JSON it exits cleanly, prints nothing and writes nothing. Seed scripts must pass an array.
- **A Sanity failure degrades; a Sapo failure blocks.** `getSapoConfig()` throws because Sapo holds price and stock, and charging against data we could not read is a money problem. `getSanityConfig()` returns `undefined`, and the product page renders without blocks rather than failing, because a product that cannot be bought because the copy did not load is strictly worse than one with terse copy.
  - **But `getProductContent()` distinguishes "nothing to show" from "could not ask", and that distinction is load-bearing.** An invalid id, a CMS that is switched off, no document, or an empty block list all return `undefined`: stable facts, safe for the caller to cache. A query that *failed* throws `SanityUnavailableError`, and `app/products/[handle]/page.tsx` catches it **outside** `unstable_cache`, so the failure is never written down as an answer and the next request asks again. It used to swallow both into `undefined`; combined with the five-minute cache, one timed-out query was recorded as "this product has no description" and served for five minutes — and because the refresh runs in the background just after a publish, it struck exactly when an editor was looking at their new page. Hit for real on 2026-10-02, on a product the shop owner had just created.
  - Verified by running the page three ways with `.next/cache/fetch-cache` cleared between them: CMS healthy → 9 `<details>`; **CMS broken** → HTTP 200, no blocks, price and add-to-cart intact, and `product_content.unavailable` logged **once per request** (two requests, two warnings — proving the failure was not cached); CMS switched off → HTTP 200, no blocks, no warning, because that path never queries.
- **CMS content is cached even though the product page is `force-dynamic`**, and the two do not conflict: `force-dynamic` is about price and stock. `unstable_cache(…, { revalidate: 300 })` at module scope in `app/products/[handle]/page.tsx`, not `use cache` — the latter needs the project-wide `cacheComponents` flag, which is a migration of every route (`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`). It caches `null` rather than `undefined` because the cache serialises its value and "absent" has to survive the round trip. Cost: new content takes up to 5 minutes to appear — a Sanity webhook hitting a revalidate route would make it immediate, and that is the next step.
- **Blocks render full width below the product card, not inside `.detail-body`.** A slider or a video has nowhere to go in a half-width column. The short Sapo description still sits in the column, but only when there are no blocks — blocks supersede it.

- **State machine** (`lib/order.ts`): `pending → processing → completed | sapo_error`, or `pending → cancelled | failed`.
- **Only one IPN may process a txnRef**, and that has to hold across instances, not just within one process. `lib/store.ts` `claim()` is the primitive: Redis `SET NX EX`, so exactly one concurrent caller wins and the others get `99` and are retried by VNPAY. The claim carries a 120 s TTL — longer than the slowest `createOrderOnce` (two Sapo calls, 15 s each), shorter than VNPAY's 5-minute retry interval — so a crash between claiming and finishing frees the order instead of wedging it. The IPN re-reads the order **under** the claim, because another instance may have completed it in between; that read turns a would-be retry into a `02`.
- A stale `processing` is therefore retryable rather than terminal. `createOrderOnce`'s Sapo lookup stays the backstop, so even a claim lost to an expiry cannot produce two Sapo orders.

  Verified on the live Vercel deployment with Redis attached: one checkout then 6 consecutive reads of `/success` all found the order (before Redis, 5 of 5 missed); a wrong amount answered `04`, proving the cross-instance read; three concurrent IPNs for one txnRef answered exactly one `00` and two `99`, and a fourth after completion answered `02`. Run with `vnp_ResponseCode=24` so none of it creates a Sapo order.
- **Sapo failure after verified payment** → status `sapo_error`, IPN returns `99` so VNPAY retries the IPN, which retries Sapo.
- **One Redis database is attached to every Vercel environment at once**, so keys carry a namespace (`lib/store.ts` `keyNamespace()`): production keeps the unprefixed keys it has always used — shipping the namespacing could not orphan an order mid-payment — while a preview gets `preview-<branch>` (keyed by `VERCEL_GIT_COMMIT_REF`, so redeploying a branch keeps its orders) and a local server gets `local`. Without this, a preview of a branch that changed `PendingOrder` would write records straight into the set production reads, and production, on older code, would mis-read them for a real customer. `store.redis` logs the namespace so a mix-up is visible without guessing. Sharing a namespace on purpose (`ORDER_STORE_NAMESPACE=`) is what lets a local server finish an order whose IPN VNPAY delivered to the production deployment, since the portal holds only one IPN URL; it is only safe while both sides agree on the record shape.
- **The cart lives in the browser and carries no prices.** `localStorage` holds only `{variantId, quantity}`; `/api/checkout` resolves each variant against the live Sapo catalog and recomputes every amount, so a tampered cart can change *what* is ordered but never *what it costs*. A line is keyed by `variantId` because that is where Sapo keeps price and stock. Duplicate variants in one request are folded into a single line rather than refused, and the per-line and per-cart ceilings (`MAX_QUANTITY`, `MAX_CART_LINES`) bound how much work a request can ask for.
- **The cart is cleared on the result page, not at checkout**, so a cancelled payment leaves the basket intact.
- **A product page's handle is Sapo's `alias`, and the route also accepts a `variantId`** (`getProductByHandle`). Links are built from the alias because they are readable and Sapo generates them already; the numeric form is the fallback for a product Sapo gave no alias, and stays valid when renaming a product changes its alias. The lookup filters the catalog list rather than calling a per-product endpoint, which keeps this code on the one Sapo products endpoint that has been verified against a live store.
- **A product's description is stripped to text, never rendered as HTML.** Sapo returns `content` as HTML, so rendering it would let whatever is typed into a product's description execute on the storefront.
- **A stored order without `lines` is read as one line** from the old top-level `sku`/`quantity` (`normaliseLines`). Production shares one key namespace across deploys of `main`, so the first deploy that understands carts will read records the previous deploy wrote for orders that were mid-payment; without the fallback those would be dropped exactly when their IPN arrived. A record that is neither shape is reported absent, which answers `01` and lets VNPAY retry rather than inventing an order.
- **Double idempotency**: the stored status (Redis or Map), plus a Sapo lookup before every create. The lookup filters server-side with `?tag=vnpay-<txnRef>` and re-checks the tag (or `note_attributes.vnp_TxnRef`) on the returned rows, so a store that ignored `tag` still matches correctly from the recent-orders list. Survives restarts/other instances as long as the pending order is known. It sends no `status` filter, so it sees open orders only — enough for a VNPAY IPN retry (within ~50 min), but an order closed in Sapo before the retry would not be found (not verified against a live store: closing an order needs a write we did not make).
- **Name split**: last word → `first_name`, rest → `last_name` (Vietnamese order).
- Result page reads server state and auto-refreshes every 3 s while waiting for the IPN.
- `<body>` in `app/layout.tsx` carries `suppressHydrationWarning` because browser extensions (ruttl, Grammarly, …) add attributes to it before React hydrates. It covers that element's attributes only, so real mismatches inside components still surface.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
```

VNPAY must reach the IPN URL over public HTTPS, so for the real sandbox round trip expose the app (e.g. a tunnel to `next start`, or deploy) and set `APP_BASE_URL` + the portal IPN URL accordingly.

Deploying to Vercel from GitHub is documented in README "Deploy to Vercel". The build needs no env
vars (every route is `force-dynamic`). Redis **is** required there: without it each lambda keeps its
own Map and a paid order is lost (`01`). Verified on a live deployment before Redis was added — the
checkout, the result page and the IPN each saw a different empty store.

Without that — plain `localhost`, no tunnel, no portal IPN URL — a full payment still works end to end
with the watcher in a second terminal, which replays the genuine callback from the dev log:

```bash
npm run dev        # terminal 1
npm run watch:ipn  # terminal 2, started after the server so it reads from the end of the log
```

Nothing else is needed on a later day: the VNPAY and Sapo credentials in `.env.local` do not expire.
Only the in-memory pending orders are lost on restart, so finish a checkout in the session that began it.

## Test

- `npm run typecheck`, `npm run lint`, `npm run build`.
- CMS: `npm run studio:dev` for a local Studio, `npm run studio:deploy` to publish the hosted one. The **mandatory** CMS test is the degradation one — unset `SANITY_PROJECT_ID`, restart, and confirm a product page still serves price, stock and the add-to-cart form. A CMS that can take the storefront down is a bug, not a feature.
- `npm run fetch:reference` re-downloads the UI reference. It reads the stylesheet hashes out of the fetched markup rather than hardcoding them, because they change on every deploy of the reference site and a hardcoded 404 would overwrite the CSS with an error page.
- Revalidate webhook: `npm run check:revalidate` with the dev server running, or `npm run check:revalidate -- https://vnpay-sapo-poc.vercel.app` against production. All four cases must pass — two accepted with the right tag, two refused.
- Env problems: see README "Troubleshooting". `.env.local` is gitignored, so it never exists in a fresh copy of the repo — `cp .env.example .env.local` and fill it in, then restart the server.
- IPN → Sapo without VNPAY reaching you: start checkout, copy the reference from the VNPAY URL / result page, then `npm run simulate:ipn -- <txnRef> <amountVnd>`. Expect `{"RspCode":"00"}` and a new Sapo order; re-run to see `02`.
- Full sandbox: see README "Test VNPAY Sandbox → Sapo".
- Every successful simulated IPN creates a **real** Sapo order. `npm run clean:orders` lists them (tag `headless-poc`), `-- --yes` deletes them via `DELETE /admin/orders/{id}.json`. **It deletes every order with that tag, not just the newest** — to drop one test order, delete that id alone. And deleting does not restock or un-count a discount code (see the Sapo section).
- **Delivery and discount, without touching the store:** `/api/quote` is read-only, so the arithmetic can be exercised directly. With `npm run dev`:
  ```bash
  curl -s -X POST localhost:3000/api/quote -H 'Content-Type: application/json'     -d '{"lines":[{"variantId":<id>,"quantity":1}],"provinceId":2,"discountCode":"TEST10"}'
  ```
  The cases that matter: a province in each zone; a basket above the free-shipping threshold; a code
  in the wrong case (must be accepted and echo Sapo's own spelling); and **a one-letter code**, which
  must be refused — `?query=T` matches `TEST10` server-side, so accepting it would be the fuzzy-search
  trap reopening. Verified 2026-10-05: `T` → refused, `test10` → `TEST10` −26,800.
- **COD end to end, locally:** POST the full checkout body with `"paymentMethod":"cod"`. It needs no VNPAY config and no tunnel, and it creates a **real** Sapo order immediately — the fastest way to check a payload change, and the way #1025 was verified. Delete that one order afterwards by its id.
- **Order lookup:** `/tra-cuu-don` with the reference and the phone number on the order. A wrong phone must answer exactly like an unknown reference; if it ever differs, the page has become an oracle.
- **Stuck order:** `npm run querydr -- <txnRef>` asks VNPAY what really happened. Read-only. Verified live 2026-10-05 against a real past transaction (`00`/`00`, NCB, 1,340,000đ, matching order #1024). Its checksum is **nine values joined with `|`** in a fixed order, not the sorted `key=value` of the payment URL — signing it the payment way gives a well-formed request that answers `97`.

### Recovering a paid order VNPAY never announced

VNPAY only calls the IPN URL registered in its merchant portal. Until that is set (or when the
tunnel was down), a paid order stays `pending` — but the signed callback *did* reach us, on the
Return URL, where `app/api/vnpay/return/route.ts` logs the raw query string with the signature.
Replaying it is not forgery: the checksum is VNPAY's own and `/api/vnpay/ipn` verifies it exactly
as it would a real IPN. The return route still never mutates state.

- `npm run replay:last` — replay the most recent logged callback.
- `npm run watch:ipn` — follow the log and replay each new callback as it lands, so a paid order
  becomes a Sapo order the moment the browser returns. **Not a substitute for the portal IPN URL
  in production:** the trigger is the customer's browser, so a closed tab leaves the order pending.
- `npm run replay-ipn -- "<query string>"` — same thing from a query string pasted by hand.

**On a deployment the callback is in the platform's runtime logs, not `.next/dev/logs/`.** The
watcher scripts only read the local dev log, so recovery on Vercel is by hand: open the project's
Logs, search the txnRef, find `"event":"return.received"` and copy its `query` value, then

```bash
npm run replay-ipn -- "<query>" https://<deployment>
```

**The browser's history never has that URL**, so do not go looking there: the return route answers
`303`, which the browser follows without recording an entry — only `/success` shows up. The log
line is the single copy.

Verified end to end on the live deployment: a real sandbox payment whose IPN VNPAY never sent was
recovered this way. Replaying the logged `query` answered `00` and produced Sapo order `#1014`
(`financial_status: paid`, `gateway: VNPAY`, stock 94 → 92) with the **genuine**
`vnp_TransactionNo` and `vnp_PayDate` in `note_attributes`; a second replay answered `02`. Note
the platform's log retention is the real deadline for this, not the order's 24 h Redis TTL.

The dev log is `.next/dev/logs/next-development.log`. Next 16 wraps our JSON inside its own
`message` field, so the escaping means the query must be recovered by parsing JSON twice
(`scripts/auto-ipn.mjs` `parseLine`); a regex over the raw line silently drops `vnp_Amount`
— the alphabetically first param — and the replay then fails the checksum with `97`.

## Known MVP limitations

- **The in-memory fallback is still in-memory**: with no Redis env vars, `lib/store.ts` uses a Map, so pending orders are lost on restart and never shared between instances. That is fine for `next dev`/`next start` on one machine and wrong on Vercel, where the IPN may land on an instance that never saw the checkout and answer `01`. Configure Redis for any serverless deployment; the result page names which backend is in use when it cannot find an order.
- If an order is lost from memory, a paid VNPAY transaction cannot be turned into a Sapo order automatically; reconcile manually via VNPAY merchant portal.
- No refund API, no inventory reservation, no CSRF token on `/api/checkout` (JSON-only POST). `querydr` exists as a **read-only script**, not an automatic job: it tells a person what VNPAY thinks and prints the command that would finish the order.
- **Email confirmation is a switch, not a feature.** `SAPO_SEND_RECEIPT=true` asks Sapo to send its own confirmation; whether Sapo actually delivers it for an API-created order is **unverified**, because finding out means sending a real email. If it does not, a mail provider of our own is needed, which is outside this project (credentials, a verified sending domain, a choice of service).
- **`once_per_customer` on a discount rule cannot be enforced.** There are no customer accounts, so a code marked once-per-customer is accepted and logged (`discount.once_per_customer_unenforced`) rather than refused. The exposure is one extra discount per reuse and it is visible in Sapo; refusing every such code would be worse.
- **A discount rule whose conditions we cannot evaluate is refused outright** — entitled products/variants/collections/provinces, customer groups, saved searches, locations, buy-X-get-Y ratios, a non-`all` customer selection, or a shipping-target rule. The customer is told the code has a condition the site cannot apply. Honouring the parts we understand would charge a discount the shop never offered.
- **The delivery fee is a flat table, not a carrier quote.** `GET /admin/shipping_zones.json` answers `access_denied` even with the order + shipping scope on, so Sapo's own zones are unreachable by a private app. The three zones and the free-shipping threshold in `lib/shipping.ts` are placeholders with a defensible shape; **they are the shop's numbers to set.**
- **The province list is Sapo's 63-province set**, which predates Vietnam's 2025 mergers. That is deliberate: an order is only useful if Sapo accepts the address on it, so the lists the customer picks from have to be the lists Sapo knows.
- **A double-submitted COD checkout makes two orders**, because each submit draws its own reference. The button disables on submit and the rate limit bounds the damage, but there is no idempotency key from the browser.
- Rate limiting is per IP in the shared store and **fails open**: a store outage lets requests through rather than stopping the shop from selling.
- One entry per Sapo product (the first variant by `position`): a product with real options would need a variant picker. Max 10 per line, max 20 lines.

## Next steps (not in MVP)

1. ~~Persistent store replacing the Map~~ — done, see `lib/store.ts`. Remaining: reconcile orders whose Redis record expired (24 h TTL).
2. ~~VNPAY `querydr` reconciliation~~ — done as a read-only script (`npm run querydr`). Remaining: an automatic job, which needs an index of pending references (the store has no key scan) and a decision about who may trigger a write.
3. ~~Read real products from Sapo~~ — done (`fetchCatalogEntries`). Remaining: a variant picker. (Product images **are** present on the live store — all four products return one each; an earlier note here claiming otherwise was stale.)
4. ~~Composable product descriptions from a CMS~~ — done (T1, `docs/plan/T1-product-content.md`), and so is the Sanity webhook → `/api/revalidate` (see "Staying on Sanity's free plan").
5. Blog on Sanity — planned in `docs/plan/T2-blog.md`, reuses the same block array and `BlockRenderer`.
6. T7 remainders, in the order they bite: a **refund path** (there is none, not even a documented manual one); a **variant picker**, still the one thing the catalog cannot express; **combo** as cách A (create the combo as its own Sapo product — no code at all, it flows through the existing path); an **email of our own** if Sapo's receipt turns out not to send; and **restocking a cancelled COD order**, which today is a human in the Sapo admin.
7. Re-skin the whole project to the reference design — planned in `docs/plan/T3-ui-redesign.md`. The token layer (T0) is already in. Open question recorded in `design/TOKENS.md`: the reference's cart is an in-page popup while this project has a `/checkout` route.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
