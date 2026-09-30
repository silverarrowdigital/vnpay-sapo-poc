# VNPAY Sandbox → Sapo headless checkout (PoC)

Minimal Next.js app proving: **product → checkout → VNPAY Sandbox payment → verified IPN → order created in Sapo**.
Architecture, decisions and limitations: see [`CLAUDE.md`](./CLAUDE.md).

## Requirements

- Node.js 20.9+ (22 LTS recommended)
- A VNPAY **sandbox** merchant account (TMN code + hash secret)
- A Sapo store with a **Private App** that has **Orders: read & write**
- A public HTTPS URL for the app (VNPAY must be able to call the IPN)

## 1. Install

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `APP_BASE_URL` | Your public HTTPS URL, no trailing slash (tunnel or deployment) |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | VNPAY sandbox registration email |
| `SAPO_STORE_DOMAIN` | e.g. `sa-c.mysapo.net` |
| `SAPO_API_KEY`, `SAPO_API_SECRET` | Sapo admin → Ứng dụng → Ứng dụng riêng → create app, grant Đơn hàng (Orders) read & write |
| `SAPO_VARIANT_ID` (optional) | Id of a real variant if you want the line item linked to a Sapo product |

## 1b. Where the product comes from

With `SAPO_VARIANT_ID` set, `/` and `/checkout` read the product **live from Sapo** on every
request: name, description, price, `compare_at_price` (shown struck through), stock and unit.
Sapo is then the single source of truth — change the price in Sapo admin and the site and the
amount sent to VNPAY both follow, with no redeploy.

- Out of stock (`inventory_quantity <= 0`) disables "Buy now", and `/api/checkout` answers `409`.
- The quantity input is capped at `min(MAX_QUANTITY, stock)`; the server re-checks it.
- If Sapo cannot be reached the pages show an error and checkout fails, on purpose: it will not
  fall back to a stale price and charge something the customer never saw.

Leave `SAPO_VARIANT_ID` empty to use the hardcoded `PRODUCT` in `lib/product.ts` instead, with
stock untracked.

## 2. Check & run

```bash
npm run typecheck
npm run lint
npm run build
npm start            # production server on http://localhost:3000
# or: npm run dev
```

## 3. Make the app reachable by VNPAY

The IPN is a server-to-server call, so `localhost` will not work. Two options:

- **Local + tunnel (recommended for this MVP):** keep `npm start` running and expose port 3000 with any HTTPS tunnel, e.g. `cloudflared tunnel --url http://localhost:3000`. Put the tunnel URL in `APP_BASE_URL` and restart.
- **Vercel:** deploy and set the env vars in the project. ⚠️ The pending-order store is in memory; if the IPN lands on a different instance than the checkout it gets `01`. Fine for a quick try, not reliable (see CLAUDE.md).

## 4. Configure the IPN URL in VNPAY (manual, once)

1. Log in at https://sandbox.vnpayment.vn/merchantv2/Users/Login.htm
2. Account information (Thông tin tài khoản) → your website/terminal → edit.
3. Set **IPN URL** = `<APP_BASE_URL>/api/vnpay/ipn` and save.

## 5. Test VNPAY Sandbox → Sapo

1. Open `<APP_BASE_URL>/` → **Buy now**.
2. Fill in name, phone (Vietnamese mobile, e.g. `0912345678`), email, address, quantity → **Pay with VNPAY**.
3. On VNPAY choose domestic card / NCB and enter the sandbox card:
   card `9704198526191432198`, name `NGUYEN VAN A`, issue date `07/15`, OTP `123456`.
4. You land on `/success`. It shows "Waiting for payment confirmation…" until the IPN arrives, then **"Payment confirmed — order created"** with the Sapo order number.
5. In Sapo admin → Đơn hàng, open the new order: line item *Test Product / TEST-001*, quantity, customer, address, status paid, tags `vnpay-<reference>`, and the VNPAY references in the note / additional details.
6. Server logs show `ipn.response` with `rspCode: "00"` and `sapo.order_created`.

Other cases to try:

- **Cancel** on the VNPAY page → result "Payment cancelled", no Sapo order (IPN answered `00`).
- **Duplicate IPN**: in the VNPAY merchant portal's transaction view you can resend the IPN, or use the simulator below → answered `02`, no second order.

### Testing IPN → Sapo without VNPAY reaching you

Start a checkout locally, note the **Reference** (the `vnp_TxnRef` in the VNPAY URL, or on the result page), then:

```bash
npm run simulate:ipn -- <txnRef> <amountVnd>          # e.g. 20260929170512123456 100000
npm run simulate:ipn -- <txnRef> <amountVnd> 24       # simulate a cancelled payment
```

This signs the callback with your own `VNPAY_HASH_SECRET` and creates a real Sapo order on success. Dev use only.

### Cleaning up test orders

Every successful simulated IPN creates a **real** Sapo order. To remove the ones this PoC made
(they all carry the tag `headless-poc`):

```bash
npm run clean:orders           # lists them, deletes nothing
npm run clean:orders -- --yes  # deletes them permanently
```

Uses `DELETE /admin/orders/{id}.json` (https://support.sapo.vn/phuong-thuc-delete-cua-order).
Deletion cannot be undone.

## IPN responses

| RspCode | When |
|---|---|
| `00` | Payment result recorded (success → Sapo order created; cancelled/failed → no order) |
| `01` | Unknown txnRef (not in this server's memory) |
| `02` | Already confirmed (duplicate IPN) |
| `04` | Amount mismatch |
| `97` | Invalid checksum |
| `99` | Sapo error / concurrent processing / server misconfiguration → VNPAY retries |

## Troubleshooting

### "Payment is not configured on the server."

`/api/checkout` returns this whenever `lib/config.ts` cannot read a required variable.
In **development** the response also names the offending variables (names only, never
values), so the checkout page shows e.g. `Missing: VNPAY_TMN_CODE Still a placeholder:
APP_BASE_URL`. Production keeps the generic message. The server log always has the detail:

```json
{"level":"error","event":"checkout.config_error","missing":[...],"placeholder":[...]}
```

Two causes:

- **`missing`** — the variable is absent or empty. Usually `.env.local` does not exist:
  it is gitignored, so a fresh clone/copy of the repo never has one. Run
  `cp .env.example .env.local` in the project root and fill it in.
- **`placeholder`** — the variable still holds the dummy value from `.env.example`
  (`YOUR_TMN_CODE`, `your-store.mysapo.net`, `https://your-public-url.example.com`, …).
  These are rejected on purpose: a placeholder would build a payment URL VNPAY rejects,
  or take a payment we could never record in Sapo.

### Windows: `.env.local.txt`

Windows Explorer hides known extensions, so "New → Text Document" plus a rename gives you
`.env.local.txt` while the file still *looks* like `.env.local`. Next.js ignores it.

```powershell
Get-ChildItem -Force | Where-Object Name -like ".env*" | Select-Object Name, Length
Rename-Item .env.local.txt .env.local        # if needed
```

The file must sit in the **project root** (next to `package.json`), not in a subfolder, and
must not be `env.local` (no leading dot) or `.env.local.local`. Save it as **UTF-8 without
BOM** with `LF` or `CRLF` endings — a UTF-16 file (PowerShell `>` / `Out-File` default in
some shells) makes the first variable unreadable. To rewrite one safely:

```powershell
$c = Get-Content .env.local -Raw; Set-Content .env.local $c -Encoding utf8 -NoNewline
```

Each line must be `KEY=value`: no spaces around `=`, no `export` prefix, no wrapping quotes.

### Changes to `.env.local` are not picked up

`next build` / `next start` read env files **once at startup** — stop the server (Ctrl+C)
and start it again after every edit. `next dev` reloads them automatically, but a restart
is the reliable check. On startup Next prints the files it loaded:

```
- Environments: .env.local
```

If that line is missing, the file is not where Next.js is looking. Also check that only one
dev server is running (`next dev` reports `Port 3000 is in use … using 3001 instead`, so
your requests may be hitting an older process on 3000).

### Hydration error on `<body>` from a browser extension

The dev overlay reports a mismatch on `<body>` with an attribute like
`data-ruttl-extension="…"`. This is injected by the **ruttl** browser extension (Grammarly,
LastPass, ColorZilla and others do the same) after the server HTML is sent but before React
hydrates — nothing in this repo renders it. `app/layout.tsx` therefore sets
`suppressHydrationWarning` on `<body>`, which silences the warning for that element's own
attributes only; genuine mismatches in your components are still reported. To confirm an
extension is the cause, reload the page in a private window with extensions disabled.

### IPN answers `99` and no Sapo order appears

Payment was verified but `POST /admin/orders.json` failed, so the order stays in
`sapo_error` and VNPAY retries. The reason is always in the server log:

```bash
grep sapo.order_failed .next/dev/logs/next-development.log
```

The entry carries Sapo's HTTP status and response body (never credentials). Two real cases
found against a live store:

| Sapo response | Cause |
|---|---|
| `422 {"errors":{"source_name":["cannot be set to a protected value by an untrusted API client."]}}` | A private app may not set `source_name`. Already fixed — the field is no longer sent. |
| `HTTP 200` but an **empty** order list | `status=any` is a Shopify parameter; Sapo matches nothing for it. Already fixed — the idempotency lookup sends no `status`. Valid values are `open`/`closed`/`cancelled`. |

When filtering orders by tag, use the **singular** `?tag=`: it matches the whole tag server-side.
The plural `?tags=` is silently ignored and returns every order, which would make a duplicate
check pass by accident.

A `Network error calling Sapo … fetch failed` instead means `SAPO_STORE_DOMAIN` is wrong or
unreachable. Check credentials and the Orders read permission with a read-only call:

```bash
curl -s -o /dev/null -w "%{http_code}
" -u "$SAPO_API_KEY:$SAPO_API_SECRET"   "https://$SAPO_STORE_DOMAIN/admin/orders.json?limit=1&fields=id"
```

`200` = credentials fine. `401` = wrong key/secret. `403` = the private app lacks Orders access.
