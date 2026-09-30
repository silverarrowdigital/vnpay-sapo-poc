# CLAUDE.md — VNPAY → Sapo headless checkout PoC

Source of truth for future work on this repo. Read it before changing anything.

## Purpose

Prove one flow end to end, with the smallest possible system:

**Product → Checkout → VNPAY Sandbox payment → server-side payment verification (IPN) → order created in Sapo.**

Not a full store: one hardcoded product, no database, no auth, no extra third-party services.

## Architecture

```
Browser                         Next.js (App Router, Node runtime)                External
───────                         ─────────────────────────────────                 ────────
/            product page
/checkout    CheckoutForm ──POST /api/checkout──► validate, price server-side,
                                                  create txnRef, store pending,
             ◄── { paymentUrl } ────────────────  sign VNPAY URL
             ── redirect ──────────────────────────────────────────────────────► VNPAY sandbox
                                                  GET /api/vnpay/ipn  ◄──────── VNPAY (server-to-server)
                                                    verify checksum → order → amount → not done
                                                    success? → Sapo POST /admin/orders.json ─► Sapo
             ◄── GET /api/vnpay/return ◄─────────────────────────────────────── VNPAY (browser)
                  verify checksum only, redirect →
/success     reads server-side order state (auto-refreshes until IPN arrives)
```

| Path | Role |
|---|---|
| `app/page.tsx` | Product page |
| `app/checkout/page.tsx`, `components/CheckoutForm.tsx` | Checkout form (client) |
| `app/success/page.tsx`, `components/AutoRefresh.tsx` | Result page; server component reading order state |
| `app/api/checkout/route.ts` | Validate input, start checkout, return VNPAY URL |
| `app/api/vnpay/return/route.ts` | Browser return: checksum check + redirect. **Never mutates state.** |
| `app/api/vnpay/ipn/route.ts` | VNPAY IPN: **the only place a Sapo order is created** |
| `lib/vnpay.ts` | VNPAY URL building, HMAC-SHA512 signing/verification, date format, codes |
| `lib/sapo.ts` | Sapo Admin API client: payload, create, idempotent lookup |
| `lib/order.ts` | Validation, in-memory pending-order store, IPN state machine, return classification |
| `lib/config.ts` | Env var reading + `MissingEnvError` |
| `lib/product.ts` | Hardcoded product (safe for client import) |
| `lib/log.ts` | JSON logger |
| `scripts/simulate-ipn.mjs` | Dev-only signed IPN simulator |
| `scripts/replay-ipn.mjs` | Dev/recovery: replay a real VNPAY callback query string at our IPN endpoint |
| `scripts/auto-ipn.mjs` | Dev/recovery: find that callback in the dev log by itself (`--watch` to follow) |

`lib/*` is framework-independent (no `next` imports) so it can be tested in isolation. Inside `lib/`, use relative imports; app code uses `@/`.

## Coding conventions

- TypeScript strict. No UI framework; plain CSS in `app/globals.css` with CSS variables (light/dark).
- Server-only modules (`config`, `vnpay`, `sapo`, `order`, `log`) must never be imported from a `"use client"` file. Only `lib/product.ts` is client-safe.
- Prices are always computed on the server from `PRODUCT`; never trust amounts from the browser.
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

Missing variables raise `MissingEnvError`; `/api/checkout` returns 500 with a generic message and logs the names. Checkout also fails fast if Sapo is not configured, so we never take a payment we cannot record.

A value copied unchanged from `.env.example` counts as **not configured**: `lib/config.ts` rejects anything starting with `YOUR_` plus the literals `your-store.mysapo.net` and `https://your-public-url.example.com`. `MissingEnvError` carries `missing` (absent/empty) and `placeholder` (still a dummy) separately. In development only (`NODE_ENV !== "production"`) `/api/checkout` echoes both lists as variable **names** in its JSON error so the checkout form can say what to fix; production keeps the generic message. Values are never returned or logged.

## Security rules

1. VNPAY and Sapo credentials live only in env vars and server code.
2. Payment success is decided **only** by a checksum-verified IPN. The return URL is display-only.
3. IPN check order (from VNPAY docs): checksum (97) → order exists (01) → amount matches (04) → not already confirmed (02) → apply result.
4. Success requires `vnp_ResponseCode === "00"` **and** `vnp_TransactionStatus === "00"`.
5. Signature comparison is constant-time.
6. No customer data in URLs; the result page URL carries only txnRef, outcome, response code.
7. Never invent API endpoints. Anything new must be checked against the official docs listed below.

## VNPAY flow (API 2.1.0) — verified docs

Docs: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html

- Payment: `GET https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` with `vnp_Version=2.1.0, vnp_Command=pay, vnp_TmnCode, vnp_Amount (VND×100), vnp_CurrCode=VND, vnp_TxnRef, vnp_OrderInfo (no diacritics/special chars), vnp_OrderType=other, vnp_Locale=vn, vnp_ReturnUrl, vnp_IpAddr, vnp_CreateDate, vnp_ExpireDate (+15 min)`; dates `yyyyMMddHHmmss` in GMT+7.
- Checksum: sort params by key ascending, `key=value` joined with `&`, URL-encoded PHP-style (space → `+`), `HMAC-SHA512(hashSecret)` hex → `vnp_SecureHash`. Verification excludes `vnp_SecureHash` and `vnp_SecureHashType`.
- IPN: GET to the IPN URL **configured in the VNPAY merchant portal** (not a request param). Must answer JSON `{"RspCode","Message"}`. VNPAY stops retrying on `00`/`02`, retries on `01/04/97/99` (up to 10×, 5-min interval).
- txnRef: `yyyyMMddHHmmss` (GMT+7) + 6 random digits.
- Sandbox test card (NCB): `9704198526191432198`, `NGUYEN VAN A`, issue `07/15`, OTP `123456`.

## Sapo flow — verified docs

- Auth (Private App): HTTP Basic with API Key : API Secret — https://support.sapo.vn/ung-dung-rieng-private-apps
- Create: `POST https://{store}/admin/orders.json` `{ "order": {...} }` — https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2
- List: `GET /admin/orders.json?status=any&created_on_min=...&fields=...` — https://support.sapo.vn/phuong-thuc-get-cua-order-phan-1
- Attributes (`financial_status`, `note_attributes`, `tags`, `source_name`) — https://support.sapo.vn/cac-thuoc-tinh-cua-order-api

Payload sent (see `buildOrderPayload`): email, phone, `line_items` (custom `{title, sku, price, quantity}` or `{variant_id, quantity, price}`), `customer {first_name, last_name, email, phone}`, billing + shipping address (`address1`, `country: Vietnam`), `financial_status: "paid"`, `transactions [{kind: sale, status: success, amount, gateway: VNPAY}]`, `note`, `note_attributes` (vnp_TxnRef, vnp_TransactionNo, vnp_BankCode, vnp_PayDate, sku, amount_vnd), `tags` (`headless-poc, vnpay, vnpay-<txnRef>`), receipts off.

**Two Sapo deviations from the Shopify-style API, both verified against a live store:**

- **No `source_name`.** Sapo reserves values like `web`/`pos` for its own channels and rejects a private app that sets one: `HTTP 422 {"errors":{"source_name":["cannot be set to a protected value by an untrusted API client."]}}`. The order is identified by `tags` and `note_attributes` instead.
- **No `status=any` on the idempotency lookup.** Shopify's `status=any` is not valid on Sapo: it returns `HTTP 200` with an **empty** list, so `findOrderByTxnRef` always returned `null` and the Sapo-side duplicate guard was silently dead. `GET /admin/orders.json` is now sent without a `status` filter (Sapo's default covers open orders, which is what an IPN retry looks for). Valid values are `open`/`closed`/`cancelled`.
- **Filter with `tag`, never `tags`.** The singular `?tag=vnpay-<txnRef>` filters server-side on the **whole** tag (a prefix of the tag matches nothing, an unknown tag returns an empty list). The plural `?tags=` is silently ignored and returns every order. Both verified against a live store.

Also observed on a live store: `transactions` is **not** persisted on an API-created order (confirming Sapo's own note), but `gateway` is — so the VNPAY trail survives in `gateway`, `note`, `note_attributes` and `tags`. `source_name` is assigned by Sapo itself to the private app's id. `GET /admin/orders/{id}.json` returns no `line_items`; read them from the list endpoint with `fields=...,line_items`.

**`SAPO_VARIANT_ID` links the line item and now also moves stock.** With it set, the payload sends `{variant_id, quantity, price}` and Sapo fills `title`/`sku` from the catalog — so the order shows the catalog's product name, not `PRODUCT.name`.

Stock deduction is explicit: without an `inventory_behaviour` field Sapo defaults to `bypass` and never touches stock (https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2). `buildOrderPayload` therefore sends `inventory_behaviour: "decrement_ignoring_policy"`, but **only when `cfg.variantId` is set** — a custom line item has no variant to deduct.

`decrement_ignoring_policy` is chosen over `decrement_obeying_policy` on purpose: this code only runs after the payment is verified, so a refusal for being out of stock would leave money taken and no order (IPN `99` → VNPAY retries → still fails). Overselling into negative stock is an ops problem; a paid transaction with no order is a money problem. Verified live: stock 10 → 8 after a paid order of 2, and an order of 10 against a stock of 8 still succeeded (`RspCode 00`, stock `-2`).

Sapo's Order API overview notes payment info/transactions may not be stored for API-created orders; the VNPAY references are therefore also in `note` and `note_attributes`.

## Important implementation decisions

- **State machine** (`lib/order.ts`): `pending → processing → completed | sapo_error`, or `pending → cancelled | failed`. `processing` is set synchronously before any `await`, so concurrent IPNs in one process cannot both create an order (the others get `99` and VNPAY retries).
- **Sapo failure after verified payment** → status `sapo_error`, IPN returns `99` so VNPAY retries the IPN, which retries Sapo.
- **Double idempotency**: in-memory status, plus a Sapo lookup before every create. The lookup filters server-side with `?tag=vnpay-<txnRef>` and re-checks the tag (or `note_attributes.vnp_TxnRef`) on the returned rows, so a store that ignored `tag` still matches correctly from the recent-orders list. Survives restarts/other instances as long as the pending order is known. It sends no `status` filter, so it sees open orders only — enough for a VNPAY IPN retry (within ~50 min), but an order closed in Sapo before the retry would not be found (not verified against a live store: closing an order needs a write we did not make).
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

Deploying to Vercel from GitHub is documented in README "Deploy to Vercel": the build needs no env
vars (every route is `force-dynamic`), but the in-memory store still makes the IPN unreliable there,
so the deployment is a public URL and a CI build, not the place to test the money path.

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
- Env problems: see README "Troubleshooting". `.env.local` is gitignored, so it never exists in a fresh copy of the repo — `cp .env.example .env.local` and fill it in, then restart the server.
- IPN → Sapo without VNPAY reaching you: start checkout, copy the reference from the VNPAY URL / result page, then `npm run simulate:ipn -- <txnRef> <amountVnd>`. Expect `{"RspCode":"00"}` and a new Sapo order; re-run to see `02`.
- Full sandbox: see README "Test VNPAY Sandbox → Sapo".
- Every successful simulated IPN creates a **real** Sapo order. `npm run clean:orders` lists them (tag `headless-poc`), `-- --yes` deletes them via `DELETE /admin/orders/{id}.json`.

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

The dev log is `.next/dev/logs/next-development.log`. Next 16 wraps our JSON inside its own
`message` field, so the escaping means the query must be recovered by parsing JSON twice
(`scripts/auto-ipn.mjs` `parseLine`); a regex over the raw line silently drops `vnp_Amount`
— the alphabetically first param — and the replay then fails the checksum with `97`.

## Known MVP limitations

- **In-memory store**: pending orders are lost on restart and not shared between serverless instances. The IPN must hit the same process that created the checkout. On Vercel this is not guaranteed → IPN may get `01` (VNPAY retries, but it will keep failing on a different instance). Use `next start` on one machine for testing, or add a KV/DB before relying on Vercel.
- If an order is lost from memory, a paid VNPAY transaction cannot be turned into a Sapo order automatically; reconcile manually via VNPAY merchant portal.
- No querydr/refund APIs, no inventory reservation, no email receipts, no rate limiting, no CSRF token on `/api/checkout` (JSON-only POST).
- Single product, max quantity 10.

## Next steps (not in MVP)

1. Persistent store (Vercel KV/Postgres) replacing the Map in `lib/order.ts`.
2. VNPAY `querydr` reconciliation job for orders stuck in `pending`/`sapo_error`.
3. Read real products from Sapo (`/admin/products.json`) instead of the hardcoded one.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
