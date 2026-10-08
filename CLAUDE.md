
## Theo dõi tiến độ
Danh sách việc nằm ở doc Claude Docs: https://claude.ai/code/artifact/410013e4-40c1-4e53-b708-f0abe046b6bb
Đọc doc này khi bắt đầu một việc mới để biết ưu tiên. Sau khi xong một việc khớp với một mục trong doc:
- Chỉ tick mục đó khi đã chạy được và có bằng chứng (test pass, đơn sandbox thật, log). Code xong mà chưa kiểm chứng thì chưa tick.
- Mỗi lần tick, để lại một comment ngắn trên mục đó: commit hash và cách đã kiểm chứng.
- Không xoá hay viết lại mục người khác đã sửa; việc mới thì thêm mục mới ở đúng phần.
- Mục trong phần "Cần xác minh trong code" phải có kết luận rõ (đúng/sai, file nào) trong comment trước khi tick.


# CLAUDE.md — VNPAY → Sapo headless checkout PoC

Source of truth for future work on this repo. Read it before changing anything.

## Purpose

Prove one flow end to end, with the smallest possible system:

**Product → Checkout → VNPAY Sandbox payment → server-side payment verification (IPN) → order created in Sapo.**

Since T7 it is also a shop that can actually take an order: a real Vietnamese address, a delivery
fee, a Sapo discount code, cash on delivery, and a way for the customer to find their order again.
**Cash on delivery is switched off since 2026-10-06** (`COD_ENABLED = false` in `lib/product.ts`, the
shop owner's decision): the shop takes VNPAY only, and the COD code is kept dormant — see security rule 2.

Not a full store: no database beyond Redis, no auth, no accounts, no extra third-party services (the one exception is the optional owner alert mail through Resend, see "Order alerts").

## How work is done here

Every feature or change follows this flow. Delegate to subagents on your own judgment; do not wait to
be asked. Subagents cannot see the conversation, so a delegation prompt carries **everything** the
subagent needs: the goal, the files, the error text, what was already tried, and the hard rules below.

The subagents live in `.claude/agents/` (`test-runner`, `debugger`, `reviewer`, `doc-writer`; `Explore`
is built in) and the commit command in `.claude/commands/commit.md`. **If one of them is not available in
the session, say so and do that step in the main session — never report a review or a test run that did
not happen.**

1. **Understand code** → delegate searching and reading to `Explore`. Do not read many files directly in
   the main session. This file already maps the repo; use `Explore` for "where is X used" and "how does Y
   work", and read directly only the few files about to be edited.
2. **Plan** → for a non-trivial feature, ask the user to switch to plan mode before coding. Save the
   approved plan to **`docs/plan/T<N>-<feature>.md`** and add its row to `docs/plan/README.md` — the
   existing numbered-plan convention, not a new `docs/plan-<feature>.md`. A plan says who does what (the
   shop owner's tasks are separate from the code), lists the decisions it needs with a recommendation for
   each, and ends on an explicit gate: **no code until the user says to start.**
3. **Implement** → in the main session, following the plan file.
4. **Test** → "tests" means `npm test` (Vitest, since 2026-10-06), `npm run typecheck`, `npm run lint`,
   `npm run build` and the `curl` / script checks listed under "Test". Run them through `test-runner` so
   long logs stay out of the main context. **New code on the money path (the list in step 6) comes with a
   unit test in `lib/*.test.ts`**, written in the main session; the tests need no network and no
   credentials, so running them is always safe. Do not add a second framework as a side effect of another task.
   - **`test-runner` makes read-only requests only.** Never `POST /api/checkout` with a real variant (a COD
     checkout creates a real Sapo order and deducts real stock, and even a refused attempt spends
     rate-limit hits), never `npm run clean:orders -- --yes`, `npm run refund -- … --confirm`,
     `npm run simulate:ipn`, `npm run replay-ipn`, `git push`. Creating a real order is a deliberate act
     done in the main session, on a test product, after the user agrees, and deleted afterwards.
5. **Debug** → fix simple failures yourself. If the same failure persists after **2 attempts**, delegate to
   `debugger` with the error, what you tried, and the relevant files. Before that, rule out the stale-state
   traps this repo has already hit: a stale `.next` or `globalThis` cache surviving a reload, a Sapo
   query parameter that is silently ignored, an in-memory order store lost on a dev-server restart.
6. **Review** → after implementation and passing tests, always run `reviewer` before committing. Fix
   critical issues, then re-run the tests.
   - **The small-change skip below does not apply to anything that moves money or decides whether an order
     exists:** `lib/order.ts`, `lib/discount.ts`, `lib/shipping.ts`, `lib/sapo.ts`, `lib/vnpay.ts`,
     `lib/store.ts`, `app/api/checkout/`, `app/api/quote/`, `app/api/vnpay/`. The failures that matter there
     — a total one đồng off from what VNPAY charged, a discount code that matches by prefix — pass
     typecheck, lint and build.
7. **Docs** → if public behaviour, env vars or setup changed, delegate to `doc-writer`. Its conventions:
   this file is written in English, while `docs/plan/` and the shop-owner guides are written in
   Vietnamese; anything verified against live Sapo or VNPAY is recorded **with its date and what was
   measured**; nothing unverified is stated as fact; a new env var goes in `.env.example` and the env
   table, a new script in `package.json` and the paths table.
8. **Commit & push** → use `/commit`. Always show the commit message. Commit after review; **never push
   without being asked, and ask first.** Stage by explicit path — `git add -A` once swept an unrelated
   edit into a commit. **In this repo `git push origin main` is a production deploy**: Vercel builds `main`
   and is live within about 40 seconds, so the confirmation to push is the confirmation to deploy.
9. **Deploy** → never deploy to production without explicit confirmation. Verify a deploy with
   **read-only requests only** (a `GET` on a route the change touched, e.g. `/api/catalog`). Never poll a
   deploy with an endpoint that writes: on 2026-10-05 `/api/checkout` used as a readiness probe created
   four real 4,000,000₫ COD orders during the 40 seconds the old code was still serving. If a build or
   deploy fails, delegate log analysis to `debugger`.

Skip steps 1–2 and 6 for small, obvious changes (a few lines, one file) — **except step 6 on the money
path listed above.**

## Architecture

```
Browser                         Next.js (App Router, Node runtime)                External
───────                         ─────────────────────────────────                 ────────
/            landing page (T12; no longer the catalog)     /shop = the catalog     /products/[handle] = product page
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
                                                  no IPN after 60 s? /success asks VNPAY (querydr,
                                                    signed answer) → the same settlePayment as the IPN
             ◄── GET /api/vnpay/return ◄─────────────────────────────────────── VNPAY (browser)
                  verify checksum only, redirect →
                              └── paymentMethod = cod (CLOSED: COD_ENABLED=false → 400) ┘
             ◄── { successUrl } ──────────────── Sapo POST /admin/orders.json ──► Sapo
                                                  financial_status: pending, no transaction
/success     reads server-side order state (auto-refreshes until the IPN arrives)
/tra-cuu-don OrderLookup ──POST /api/order-lookup► ref + phone → GET /admin/orders.json ─► Sapo
                                                  rate-limited; wrong phone == no order
                                                  same markup prints as the order slip
```

| Path | Role |
|---|---|
| `app/page.tsx` | **Landing page since T12** (hero, marquee, new season, best sellers, promo, artisans, benefits, partners, testimonial, two newest posts). It is no longer the catalog. Copy and switches live in `lib/home.ts` |
| `app/shop/page.tsx`, `components/ProductTile.tsx` | The catalog grid (moved here from `/`), one tile per **product** (not per variant); "Từ ₫…" when its sizes differ in price. Every link that used to mean "the catalog" points here |
| `lib/home.ts` | **Client-safe.** Landing-page copy plus three switches: `SHOW_HEALTH_CLAIMS` (false hides the "Lợi ích" section and the health / FDA / certification sentences on `/ve-chung-toi`), `PARTNER_LOGOS` (empty hides the partners strip), `BEST_SELLER_PRODUCT_IDS` (empty ⇒ the first in-stock listed products; Sapo gives no sales ranking) |
| `components/SiteHeader.tsx`, `components/SiteFooter.tsx` | The shell (T12), replacing the inline header/footer in `app/layout.tsx`. Header is client: two capsules, a `<details>` menu closed by navigation / Escape / a link click, floating over the hero only on `/`. Footer is a server component reading `lib/business.ts` + `lib/policies.ts`; **no newsletter form and no Bộ Công Thương link** (no service chosen; the registration is per domain and unconfirmed). The banner still reads `FREE_SHIPPING_THRESHOLD_VND`. The menu has no "Chuyện của Trà" item (removed 2026-10-07 at the owner's request; `/ve-chung-toi#san-pham` still anchors the product section); no Search link because there is no search page |
| `components/ContactForm.tsx`, `app/api/contact/route.ts`, `lib/contact.ts` | Contact form, off unless `CONTACT_EMAIL` (older name `CONTACT_EMAIL_TO` still read) and `RESEND_API_KEY` are set (then the route answers 404 and `/lien-he` draws no form). Mail through Resend, sender `ALERT_EMAIL_FROM` (default `Website <onboarding@resend.dev>`). Rate limit `contact` 5 per hour per IP (`RATE_POLICIES`, `lib/order.ts`), counted only after validation. Subject is header-injection safe and no personal data is logged (both unit-tested). `lib/contact.ts` is server-only. See "Contact form" under Known MVP limitations |
| `app/products/[handle]/page.tsx` | Product page: details, size picker (when the product has sizes), quantity, add to cart |
| `app/checkout/page.tsx`, `components/CheckoutForm.tsx` | Cart editor + delivery form (client) |
| `components/useCart.ts` | Cart state in `localStorage`, read through `useSyncExternalStore` |
| `components/AddToCartForm.tsx`, `components/CartMenu.tsx`, `components/ClearCartOnSuccess.tsx` | Cart controls. `CartMenu` is the header button **and** the drawer in one component, so they share open state without a context |
| `app/api/catalog/route.ts` | Public product data for the cart drawer. Changes nothing about pricing — `/api/checkout` re-prices every line from Sapo |
| `app/blog/page.tsx`, `app/blog/[slug]/page.tsx` | Blog, restyled in T12 from `design/site-v3/`, reading Sanity. The post page adds "Các bài viết liên quan" (newest other posts, cached 1 h under tag `blog`); `/blog?page=N` has a canonical per page |
| `lib/blog.ts` | Post queries. Throws on failure, unlike `lib/content.ts` — see below |
| `app/api/revalidate/route.ts` | Sanity content webhook → `revalidateTag`. Signature-checked |
| `app/sitemap.ts` | `/`, `/shop`, products (test products excluded from the sitemap only, see `getIndexableProducts`), posts, `/ve-chung-toi`, `/lien-he` and the four `/chinh-sach/*` pages |
| `app/robots.ts` | Production: allow all except `/api/`, `/checkout`, `/success`, `/tra-cuu-don`, plus the sitemap URL. Any other deployment: `Disallow: /`. See "Staying out of search results on non-production deployments" |
| `app/icon.svg` | Favicon |
| `lib/business.ts` | **Client-safe.** The shop's business facts as constants — brand "The Hour Tea", legal name, registration (MST), registered address, hotline and hours, email, social links — plus the `OPEN_GRAPH` defaults. Taken from the owner's published footer and policies on thehourtea.com on 2026-10-06. Footer, `/lien-he`, the policies and page metadata read it, so a fact is edited once. A page's own `openGraph` **replaces** the layout's rather than merging, so pages spread `OPEN_GRAPH` into theirs |
| `lib/policies.ts`, `components/PolicyBody.tsx` | **Client-safe** text of the four policies (`bao-mat`, `doi-tra`, `van-chuyen`, `thanh-toan`), and the component that draws it as **plain text only** (no HTML, security rule 8). Where the text states a fact the code decides — payment methods, delivery fee and free-delivery line, the COD sentence — it is computed from `lib/shipping.ts` / `lib/product.ts`, not typed. See "Policy text" under Known MVP limitations |
| `app/chinh-sach/[slug]/page.tsx` | The four policy pages, prerendered (`dynamicParams = false`, so any other slug is a 404) |
| `app/ve-chung-toi/page.tsx` | Brand story, founder, timeline. Deliberately **omits** the old site's product/factory section, its health claims and its FDA "safe brand" line |
| `app/lien-he/page.tsx` | Contact details, plus the form only when `CONTACT_EMAIL` is set (T12) |
| `sanity/schemas/post.ts`, `sanity/schemas/author.ts` | Blog schemas. `post.body` uses the same `blocksField` as `productContent` |
| `app/success/page.tsx`, `components/AutoRefresh.tsx` | Result page; server component reading order state. Shows **no delivery address** (the page opens with only a reference — security rule 6) and no developer wording |
| `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` | Customer-facing 404 / error / root-error pages in Vietnamese (T10). Not exercised in a browser yet |
| `app/api/checkout/route.ts` | Validate input, start checkout, return a VNPAY URL **or** create the COD order |
| `app/api/quote/route.ts` | Price a cart for display: goods, discount, delivery, total. Calls the same `quoteTotals` the real checkout uses, so the summary cannot drift from the charge |
| `app/api/locations/route.ts` | Provinces / districts / wards, one level at a time. Refuses to serve a whole table |
| `app/api/order-lookup/route.ts` | Reference + phone → one order. A wrong phone and a missing order answer identically |
| `app/tra-cuu-don/page.tsx`, `components/OrderLookup.tsx` | Customer order lookup, and the printable slip (same markup, `@media print`) |
| `components/AddressSelects.tsx` | Tỉnh/thành → quận/huyện → phường/xã, cascading |
| `components/formField.ts` | The one input style, shared by the form's two components |
| `app/api/vnpay/return/route.ts` | Browser return: checksum check + redirect. **Changes no order.** After the checksum verifies a "paid" return it calls `markPaidReturn`, which only sets a hint counter (`paid-return:<ref>`) so the scarce `querydr` slot goes to that order first |
| `app/api/vnpay/ipn/route.ts` | VNPAY IPN: one of **two** doors for a *paid* Sapo order; the other is `reconcilePendingPayment` (`lib/order.ts`, via `lib/querydr.ts`), called from `/success` and from the sweep. Both end in the same `settlePayment` (COD creates an unpaid order — security rule 2). Working tree, not deployed (PR 6c): `maxDuration = 120` and it passes Next's `after` to `handleIpn` so the Sapo order is created after the answer |
| `lib/querydr.ts` | Server-side `querydr` call for the result page and the sweep (T13.0): builds the request checksum (9 values joined with `\|`), verifies VNPAY's answer (15 values joined with `\|`), 6 s timeout. Answers `ok: false, reason: "rate_limited"` for VNPAY's code `94` (see "Transaction ledger"). Same scheme as `scripts/querydr.mjs`, written separately on purpose (see "Refunding a payment", trap 2) |
| `lib/db/schema.ts`, `lib/db/client.ts`, `drizzle/0000_ledger.sql` | The Postgres ledger's five tables (`orders`, `payment_attempts`, `webhook_inbox`, `outbox_jobs` — used since PR 6b (deployed): the `create_sapo_order` job queue — and `sapo_mappings`), the Neon pool (`getDb()` is `undefined` without `DATABASE_URL`; pool max 3, 2 s connect) and the migrations (`0000_ledger.sql`; `0001_outbox_dedupe.sql` adds `outbox_jobs.dedupe_key` + a unique index, additive). Server-only |
| `lib/ledger.ts` | Records checkout, payment, Sapo result and webhook evidence in Postgres beside Redis, and lists sweep candidates / purges old customer data. Since PR 6b (deployed) also `ledgerCommitPaid` (one Postgres transaction: payment marked paid + a `create_sapo_order` job, unique per reference), `ledgerFinishSapoJob` / `ledgerFailSapoJob` (back-off 1, 2, 5, 10, 15, 20, 30 min; `failed` at 8 tries) and `ledgerDueSapoJobs` (only this deployment's Redis namespace). Never throws and, except for the 4 s cap on `ledgerCommitPaid`, never blocks the money path — see "Transaction ledger" |
| `lib/sweep.ts`, `app/api/jobs/sweep/route.ts` | The sweep (T14 PR 6): finds VNPAY payments nobody is looking at and hands each to `reconcilePendingPayment`. Route accepts a QStash signature or `Bearer CRON_SECRET`, else 401. Since 6b (deployed) it first runs due Sapo jobs (`runSapoJob`, max 10 per run), then asks VNPAY; the result carries `jobs` / `jobsDone`; the daily Vercel cron (Bearer secret) skips the `sweep-active` idle gate, QStash runs respect it |
| `app/api/cron/purge/route.ts`, `vercel.json` | Daily Vercel cron (20:00 UTC) emptying customer data from ledger orders past `purge_after` (90 days). Refuses without `Bearer CRON_SECRET`. `vercel.json` also holds the sweep's daily 21:00 UTC heartbeat — never add a more frequent entry (Hobby) |
| `scripts/migrate.mjs` | Runs at the start of `npm run build`: applies `drizzle/` to the production database. Never fails the build, skips preview builds (they share the production database), 10 s connect / 60 s overall |
| `scripts/qstash-schedule.mjs` | Creates, confirms or `--delete`s the QStash schedule `vnpay-sapo-sweep-production` (every 5 minutes). Idempotent; refuses any host but production unless `--allow-other-host` |
| `app/listing-cache.ts` | `getCachedStorefrontProducts`: the product list for `/` and `/shop` cached 30 s (`unstable_cache`). Never used by the product page, cart drawer, quote or checkout, which read Sapo live |
| `lib/jsonld.ts`, `components/JsonLd.tsx` | Product structured data (T13.9). `productJsonLd` builds it from Sapo data only; `serializeJsonLd` escapes `<`, `>`, `&`, U+2028/2029. `JsonLd` is the **single** `dangerouslySetInnerHTML` in the project (security rule 8) |
| `lib/vnpay.ts` | VNPAY URL building, HMAC-SHA512 signing/verification, date format, codes |
| `lib/sapo.ts` | Sapo Admin API client: payload, create, idempotent lookup |
| `lib/order.ts` | Validation, totals, IPN state machine, COD order creation, rate-limit policies, order lookup |
| `lib/shipping.ts` | Delivery fees — **client-safe**, and the only place a fee is computed |
| `lib/discount.ts` | Sapo `price_rules` → a verified, server-computed discount |
| `lib/locations.ts` | Vietnam's administrative divisions, read from Sapo and memoised per process |
| `lib/store.ts` | Pending-order storage + the cross-instance processing claim: Redis when configured, in-memory Map otherwise. Also the rate-limit counters: `hit` increments, `count(key)` reads without incrementing (used by the alert dedupe) |
| `lib/alert.ts` | `sendAlert(kind, txnRef, details)` — emails the shop owner through Resend when a customer has paid and no order can be recorded (`paid_no_order`, `amount_mismatch`, `sapo_failed`, and since 6b `sapo_gave_up`). Never throws, no customer data in the mail, one mail per reference + kind per hour. Off unless `RESEND_API_KEY` and `ALERT_EMAIL` (older `ALERT_EMAIL_TO` still read) are set. See "Order alerts" |
| `lib/config.ts` | Env var reading + `MissingEnvError` |
| `lib/catalog.ts` | Sapo catalog as the app sees it: `getVariantCatalog` (flat, per variant, combo and no-price filter `isSellable`), `getVariantIndex` (the one index checkout and quote both price against), `getStorefrontProducts` (grouped, for home/sitemap), `getProductByHandle` → `ProductGroup`. Server-only. See "Variants (T9)" |
| `lib/product.ts` | Hardcoded product, plus the client-safe variant helpers (`ProductGroup`, `hasChoice`, `selectVariant`, `productHref`, …) |
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
| `scripts/check-locations.mjs` | Watch Sapo's province/district/ward tables for Vietnam's 2025 reorganisation. Read-only; exits non-zero when the shape changes |
| `scripts/refund.mjs` | Refund a VNPAY transaction. **Dry run unless `--confirm`**; reads the genuine references out of the Sapo order and never writes to Sapo |
| `scripts/querydr.mjs` | Ask VNPAY what really happened to a transaction (API 2.1.0 `querydr`). Read-only; prints the one command that would finish the order |
| `vitest.config.mts`, `vitest.setup.ts` | Vitest config: runs `lib/**/*.test.ts` in Node (`npm test`), resets mocks between tests; the setup file makes `fetch` throw so no test can reach the network |
| `lib/vnpay.test.ts`, `lib/shipping.test.ts`, `lib/discount.test.ts`, `lib/sapo.test.ts`, `lib/order.test.ts`, `lib/alert.test.ts`, `lib/contact.test.ts`, `lib/product.test.ts`, `lib/querydr.test.ts`, `lib/jsonld.test.ts`, `lib/ledger.test.ts`, `lib/sweep.test.ts`, `lib/db/schema.test.ts` | Unit tests for the money path (and, since T12, the contact form and `isTestProduct`; since T14 the ledger and sweep, which run on PGlite, an in-process Postgres, because the Neon credentials are Vercel-sensitive and cannot be pulled to a laptop) — see "Test". Mocks sit at the module edges (`./catalog`, `./locations`, `./discount` quote, `./sapo`, `./log`); signing is real, and the order store is the real in-memory one wrapped in a JSON round-trip so it behaves like Redis |
| `.github/workflows/ci.yml` | CI on every pull request and push to `main`: `npm ci`, typecheck, lint, test, build, Node 24, no secrets |
| `.agents/`, `.claude/skills/`, `skills-lock.json` | Not ours: third-party agent skills a Marketplace install drops in (with absolute symlinks). Gitignored and ignored by eslint since 2026-10-06; the repo's own agents are in `.claude/agents/`, which that does not cover |
| `design/TOKENS.md` | Where every design token came from, with its source |
| `docs/huong-dan-them-san-pham.md` | Shop-owner guide (Vietnamese, no CLI): add a Sapo product, then its Sanity content. Written for someone who is not a developer |

`lib/*` is framework-independent (no `next` imports) so it can be tested in isolation. Inside `lib/`, use relative imports; app code uses `@/`.

## Coding conventions

- TypeScript strict. **Tailwind CSS v4** (`@import "tailwindcss"` in `app/globals.css`, `postcss.config.mjs`), plus project CSS in the same file. No `tailwind.config.js` — v4 scans the project itself and declares tokens with `@theme`.
  - Chosen so the storefront can be rebuilt faithfully from `design/reference/`, which is a Tailwind site: sharing the utility vocabulary makes the reference markup comparable class by class. An earlier decision said "plain CSS, no framework"; it was made partly on a Tailwind detection I mis-read, and is reversed. See `docs/plan/T3-ui-redesign.md`.
  - Preflight (Tailwind's reset) removes browser defaults. Anything relying on them must be declared — e.g. `ul`/`ol` bullets in CMS rich text (`.rt-list`).
- Server-only modules (`config`, `vnpay`, `sapo`, `order`, `log`, `sanity`, `content`, `discount`, `locations`, `contact`) must never be imported from a `"use client"` file. **Six** modules in `lib/` are client-safe: `lib/product.ts`, `lib/blocks.ts` — which holds types only and whose single import is type-only (erased at compile time), what `ImageSlider`/`VideoEmbed` need — `lib/shipping.ts`, and, since the brand pages, `lib/business.ts` and `lib/policies.ts` (the footer and the checkout's consent checkbox are drawn from them; they import only each other, `./shipping` and `./product`), and, since T12, `lib/home.ts` (landing copy and switches; it has no imports). Keep them that way: no config, no client, no logger.
  - `lib/shipping.ts` is client-safe **so that there is exactly one fee calculation**. The fee has to show in the checkout summary, be added to the amount the VNPAY URL is signed with, and be sent to Sapo as a `shipping_line`; the plan's third big risk is those three disagreeing. One pure function used by all three makes them agree by construction, and the browser only ever displays what it returns.
- The UI is built from the token layer at the top of `app/globals.css` (`--ink`, `--accent`, `--step-*`, `--space-*`, `--radius-*`, `--font-*`), extracted from `design/reference/` with every value's source recorded in `design/TOKENS.md`. New components use the variables; no hardcoded colours or pixel values. There is **no dark mode** — the reference design has one theme, so inventing a second with nothing to check it against was not worth the contrast work.
- Prices are always computed on the server from the live Sapo catalog; never trust amounts from the browser. That now covers three numbers, not one: the goods subtotal, the **delivery fee** (from the resolved province) and the **discount** (from a Sapo price rule). The browser sends quantities, three address ids and a discount *code* — nothing else about money.
- **Error boundaries in this Next (16.3) receive `retry`, not `reset`** (`app/error.tsx`, `app/global-error.tsx`). Code written from memory of older Next uses `reset` and fails. Verified in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`.
- Log with `log.info/warn/error(event, data)`. Never log secrets or full customer records (txnRef, amounts, codes, Sapo ids are fine).
  - **Logging and personal data (full audit of every log call, 2026-10-08).** Two helpers keep customer data out of the logs. `errorMessage` (`lib/log.ts`) cuts the `, command was: …` part that `@upstash/redis` 1.39 appends to every error: it is the whole Redis command as JSON, which can be `SET order:<ref>` with name, phone, email and address, rate-limit keys with an IP or phone digits, and, with auto-pipelining, other requests' commands. `sapo.order_failed` / `cod.order_failed` log `errorFields` (only the names of the fields Sapo rejected, from its `{"errors":{…}}` shape, or `{bodyLength}`) instead of the response body; the body kept in `lib/sapo.ts` for the error is cut at 4000 characters and is never logged. `checkout.created` no longer logs the province. Left on purpose: the IPN log's `remoteIp` / `userAgent` (VNPAY's server, T13.7) and `return.received`, which logs the raw return query (only `vnp_*` for real traffic; the signature stays so `replay-ipn` works). Unit-tested in `lib/log.test.ts`.
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
| `DISCOUNTS_ENABLED` | no | `false` stops every discount code being honoured, within one request and with no deploy. An operational kill switch: the codes live in Sapo and this app has read-only access to them on purpose, so there is otherwise no way from here to retire one. Default on |
| `SAPO_SEND_RECEIPT` | no | `true` asks Sapo to email the customer its own order confirmation. Off by default on purpose — see below |
| `VNPAY_QUERYDR_URL` | no | Override for the `querydr` endpoint used by `npm run querydr` and `npm run refund` (same endpoint). Defaults to the sandbox one. The server (`getQueryDrUrl()` in `lib/config.ts`, T13.0) uses this value, else the sandbox URL **only while `VNPAY_PAYMENT_URL` is sandbox**. Both scripts now **refuse to run** when `VNPAY_PAYMENT_URL` is a non-sandbox host and this is unset (checked 2026-10-08: both were run with a production `VNPAY_PAYMENT_URL` and no `VNPAY_QUERYDR_URL` and refused before any network call). **Known gap:** the guard reads only `.env.local`, so production credentials copied there without the production `VNPAY_PAYMENT_URL` would not trigger it (T10.5) |
| `VNPAY_REFUND_CREATE_BY` | no | Who a refund is recorded as being requested by (`vnp_CreateBy`). Defaults to `shop-admin` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | no locally, **yes on serverless** | Redis (Upstash) for the shared pending-order store. Injected by Vercel's Marketplace Redis integration |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | no | Same thing under Upstash's own names, for a database created outside Vercel. Takes precedence over the `KV_*` pair |
| `ORDER_STORE_NAMESPACE` | no | Overrides the Redis key namespace (see below). Empty string selects production's |
| `DATABASE_URL` (and the other Neon variables) | no locally; the ledger is a quiet no-op without it | Postgres (Neon) for the ledger (`lib/db/client.ts`). Injected by Vercel's Neon integration, enabled by the owner 2026-10-07 for Production **and** Preview — the **same** database for both. Vercel marks them sensitive, so they cannot be pulled to a laptop. `scripts/migrate.mjs` prefers `DATABASE_URL_UNPOOLED` when present |
| `RESEND_API_KEY` | no — alerts and the contact form are off without it | Resend API key (`lib/alert.ts`, `lib/contact.ts`). Set by the owner's Resend integration for Production and Preview on 2026-10-07 (sender `onboarding@resend.dev`, no domain of the shop's own yet) |
| `ALERT_EMAIL` | no — alerts are off without it | Where the alert goes. The owner chose this name on 2026-10-07; the older `ALERT_EMAIL_TO` is still read when it is unset. **Set on Vercel by the owner on 2026-10-08**, so alerts are on, but no alert mail has ever been sent (see "Order alerts"). Until a sending domain of the shop's own is verified, use the address the Resend account was opened with (Resend's shared sender is believed to deliver only there — **unverified**) |
| `CRON_SECRET` | yes for the two cron routes | Production, sensitive. Vercel Cron sends it as `Authorization: Bearer`; `/api/cron/purge` refuses without it and `/api/jobs/sweep` accepts it as one of its two credentials. Verified 2026-10-07: an unauthenticated call answers 401 |
| `QSTASH_URL` / `QSTASH_TOKEN` / `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | for the sweep schedule | Exist for Production and Preview since 2026-10-06, **used since 2026-10-07**: the token only by `scripts/qstash-schedule.mjs`, the two signing keys by `/api/jobs/sweep` to verify QStash's signature (together with `APP_BASE_URL`, the address the signature was issued for) |
| `ALERT_EMAIL_FROM` | no | Sender. Defaults to `Order alerts <onboarding@resend.dev>` for alerts and `Website <onboarding@resend.dev>` for the contact form |
| `CONTACT_EMAIL` | no — the contact form is off without it | Inbox that receives `/lien-he` form messages, sent through Resend with `RESEND_API_KEY`. Renamed from `CONTACT_EMAIL_TO` on 2026-10-07 (the old name is still read); **set on Vercel by the owner on 2026-10-08**. Unset ⇒ `/api/contact` answers 404 and `/lien-he` draws no form (both verified 2026-10-07). Measured 2026-10-08 on production: `POST /api/contact` at 05:03:33Z answered 200 `{ok:true}` and the log shows `contact.sent` at 05:03:34Z, so Resend accepted the payload including `reply_to`. **Unverified:** that the message reached the inbox (the owner has not confirmed; the code does not log Resend's message id) |
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
2. **"Paid" is decided only by a signed server-to-server answer from VNPAY — the IPN or `querydr` —
   checked for signature, our terminal (`vnp_TmnCode`: `querydr` and, since 2026-10-08, the IPN too), the reference, the amount and
   `vnp_TransactionType` "01"; never by the browser return URL.** (Widened 2026-10-07, T13.0, after
   order #1039: VNPAY took the money and sent no IPN. Reason it is safe: our server calls VNPAY, so
   nobody can forge the answer, and it carries its own checksum.) **Plus one more case (T14, 2026-10-07):**
   an order already confirmed paid by such an answer, whose Sapo order failed, may be retried from the
   payment the ledger recorded (`ledgerPaidParams`) with no VNPAY call; it decides nothing new about
   whether money was taken. (PR 6b's `create_sapo_order` job, deployed in c8b5abb, is exactly this case: `runSapoJob` goes through `settlePayment(ledgerPaidParams(ref))`, the same door as the IPN, and the job is inserted only after the IPN or `querydr` verified the payment.) The return route changes no order: it logs, redirects and, after verifying
   VNPAY's checksum on a "paid" return, leaves only a **hint** (`markPaidReturn`, counter `paid-return:<ref>`)
   that makes `/success` and the sweep ask VNPAY about that reference first. `/success?outcome=success` is an
   unsigned URL and is only a reason to *ask*, never proof; the result page asks only for a reference that
   carries the hint.
   COD (T7.5) opens another door into Sapo, so the rule is stated as halves that must all hold:
   - A **VNPAY** order is created only through `settlePayment` (`lib/order.ts`), reached from
     `app/api/vnpay/ipn/route.ts` or from `reconcilePendingPayment` (the `querydr` path, called by `/success`
     and by the sweep), and only ever as `financial_status: "paid"`.
   - A **COD** order is created only by `placeCodOrder` in `lib/order.ts`, and only ever as
     `financial_status: "pending"`, with **no `transactions` array**. Nothing on that path can
     mark an order paid, so no amount of calling it can fabricate a payment record — only an
     unpaid order a human confirms by phone. What it *can* produce is junk orders, which is what
     the rate limit on `/api/checkout` is for.
   - **Since 2026-10-06 the COD door is closed by `COD_ENABLED = false`** (client-safe, `lib/product.ts`).
     `validateCheckout` refuses `paymentMethod: "cod"` with a field error before the rate limiter and
     before any Sapo call, and `CheckoutForm` does not draw the option. `placeCodOrder`, the `cod` /
     `codPhone` limits and `MAX_COD_TOTAL_VND` are left in place on purpose; the rules above are
     unchanged if it is switched back on.
3. IPN check order (from VNPAY docs, plus our terminal): checksum (97) → our terminal (01) → order exists (01) → amount matches (04) → not already confirmed (02) → apply result. **The terminal check was added 2026-10-08 (uncommitted at the time of writing):** a notification whose `vnp_TmnCode` is missing or differs from `VNPAY_TMN_CODE` is answered `01` "Order not found", logged as error `ipn.wrong_terminal`, recorded in `webhook_inbox`, and, if it reports a successful payment, mailed as `paid_no_order` (the reason names both terminals); it touches no store, ledger or Sapo. Reason: a correctly signed notification meant for another terminal must never be applied to one of our references. Unit-tested; **not exercised against live VNPAY**. A **successful** payment that ends in `01` (no stored order), `04` (wrong amount) or `99` (Sapo failed) now also emails the owner (`lib/alert.ts`, "Order alerts"); the mail is awaited before the answer but can never change it. A failed or unconfigured send leaves only a log line. **PR 6b (c8b5abb, deployed 2026-10-08) adds a step before the Sapo call:** `ledgerCommitPaid`. If it commits (or the ledger already said paid), the answer is `00` (`02` for already) even when Sapo then fails, because the payment and a retry job are durable; the failure is mailed as `sapo_failed` and the job retries. `99` stays only when the ledger could not confirm the commit (no DB, breaker open, error, over 4 s, refunded attempt) and Sapo failed, exactly as before 6b. **PR 6c (working tree, NOT deployed, 2026-10-08) moves the Sapo call after the answer** when the commit is durable and the route supplied `defer`: `00` / `02` is then returned before Sapo is called, and a failure there is handled by the job and the alert, never by the answer. With the ledger `unavailable` or no `defer`, `00` still means Sapo has the order. A replay meeting the held claim gets `99`.
4. Success requires `vnp_ResponseCode === "00"` **and** `vnp_TransactionStatus === "00"`.
5. Signature comparison is constant-time.
6. No customer data in URLs; the result page URL carries only txnRef, outcome, response code. The
   order-lookup page accepts a prefilled reference in its query string but **never** the phone
   number, so a shared link is not a shared address book. **The result page (`/success`) shows no
   delivery address either** (changed 2026-10-06, T10): it opens with only a reference, and it has **no rate limit**. Since T11
   (2026-10-07) a new reference is a GMT+7 timestamp plus 16 random symbols (80 bits), so it is no longer
   guessable; references issued before that (timestamp + six digits, ~10^6 guesses per second of
   timestamp) still exist and are still accepted. The address appears only on the phone-gated
   order lookup. Do not add it back to `/success`.
7. Never invent API endpoints. Anything new must be checked against the official docs listed below.
8. **No CMS content is ever rendered as HTML.** `htmlToText` already strips Sapo's description; Sanity rich text goes through Portable Text into our own React elements (`components/blocks/RichText.tsx`). No `dangerouslySetInnerHTML` anywhere **except one, added 2026-10-07 (T13.9, the owner approved it):** `components/JsonLd.tsx`, the only way to emit a JSON-LD `<script>`. Its data is Sapo-only (name, price, stock, image, plain-text description) and is serialized by `serializeJsonLd` (`lib/jsonld.ts`), which escapes `<`, `>`, `&`, U+2028 and U+2029. Never feed it CMS content.
9. **A video block stores `provider` (enum) + `videoId` (regex-validated), never a URL and never an iframe.** The player address is assembled in `components/blocks/VideoEmbed.tsx`, so nothing typed into the CMS can retarget the frame. The iframe is also not created until the reader presses play, so a reader who never watches sends no request to the video host.
10. Links in CMS rich text are restricted by schema to `http`, `https`, `mailto`.
11. **A discount is a code from the browser and an amount from the server.** `/api/quote` exists to
    display a total and is otherwise worthless: `/api/checkout` re-verifies the code against Sapo
    and recomputes the money before signing anything. Accepting an amount from the browser would be
    a gift to anyone who can open DevTools.
12. **The order lookup is rate-limited and answers failures identically.** A reference is a
    timestamp plus 16 random symbols (80 bits, T11); old ones were timestamp plus six digits, which
    is guessable with enough tries and is why the phone check is backed by two counters in the shared
    store (`lookup` 10 per 15 min per IP, `lookupPhone` 5 per hour per phone). "Wrong phone" is
    indistinguishable from "no such order", and a malformed reference is refused before it costs a try.

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
- txnRef (`createTxnRef`, `lib/vnpay.ts`): `yyyyMMddHHmmss` (GMT+7) + 16 random symbols from a 32-symbol alphabet (digits and capitals without I, L, O, U) = 30 chars, 80 bits (T11, 2026-10-07). It was + 6 random digits (20 chars). `TXN_REF_PATTERN` accepts exactly the old 20 digits or the new shape; `normaliseTxnRef` trims and upper-cases what a customer typed. VNPAY's payment page rendered for a 30-char reference (checked 2026-10-07; that reference was not paid through the card page).
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
**A combo product's stock is derived, and selling one through this API moves no stock at all.**
Verified 2026-10-05; full write-up and plan in `docs/plan/T8-combo-ton-kho.md`.

- A combo variant carries `type: "combo"` and `requires_components: true`. Its components are **not**
  in `/admin/products.json`; they are in **`GET /admin/combos.json`** →
  `{combos: [{variant_id, product_id, price, total_available, inventories, combo_items}]}`. That
  endpoint is **not in any Sapo doc page read so far** but returns 200 with data on the live store;
  `/admin/products/{id}/components.json` and `/admin/variants/{id}/components.json` are 404, and
  `product_components` / `variant_components` / `combo_products` are not routes either.
- **`total_available` is `min(component stock / quantity needed)`**, confirmed arithmetically:
  components at 114 / 37 / 61, each needed once, and `total_available` = 37. `/admin/products.json`
  reports the same 37 as the variant's `inventory_quantity`, so **the storefront already shows and
  enforces the right number** — the read path needs no change.
- **But a combo sold through `POST /admin/orders.json` deducts nothing.** Four orders of ten combos
  each (40 units, `inventory_behaviour: "decrement_ignoring_policy"`, the combo's `variant_id`) left
  all three components unchanged; every movement measured was explained by other orders. Combined
  with the derived availability this means **selling combos never reduces the combo's availability** —
  sell 37, it still says 37, forever. No error, no warning, no log line: the shop's books drift by
  one combo per combo sold. Until `docs/plan/T8-combo-ton-kho.md` § T8.3 ships, the safe move is to
  withhold combos from the catalog, which is what `lib/catalog.ts` `isSellable` now does: a combo
  variant never reaches the storefront, its product page 404s, and a cart that already held one (it
  lives in `localStorage`) is refused at checkout. Setting the product to `draft` in Sapo would do
  the same and was the first choice, but that store does not offer it. Verified 2026-10-05 on a
  single unit too: order #1034 paid 385,000₫ for one combo and all three components stayed at
  114 / 38 / 61, with `combination_lines: []` — Sapo never expanded it.

**Sapo's administrative divisions are the pre-2025 map, and the table is an accretion rather than a
snapshot.** Verified 2026-10-05, and it decides how addresses work:

- **63 provinces, 723 districts, 11,665 wards.** Vietnam's 2025 reorganisation cut the country to 34
  provinces and **abolished the district level**; Sapo has not followed. Every province the reform
  merged away is still selectable — Bình Dương(10), Bà Rịa-Vũng Tàu(4), Hà Nam(25), Nam Định(40),
  Ninh Bình(42), Bắc Kạn(6), Hậu Giang(29), Vĩnh Phúc(62) — and so are `Quận 1`(30) and
  `Phường Đa Kao`(9218), both of which no longer exist in law.
- **Sapo does add new units; it just never removes the old ones.** `Thành phố Hoa Lư`(10928),
  `Quận Thuận Hoá`(10930), `Quận Phú Xuân`(10933), `Thị xã Phong Điền`(10934) are 2025 creations
  and are all present, as is `Huyện Long Đất`(10929) — the merger of Long Điền and Đất Đỏ — **beside
  `Huyện Long Điền`(67) and `Huyện Đất Đỏ`(68), which it replaced.** `Huyện Tân Thành`(69) still
  sits next to `Thị xã Phú Mỹ`(716), carved out of it in 2018. So in this table a *rising* count is
  a normal update and a *falling* one is the alarm.
- **Mirroring Sapo stays the right call**, however out of date it looks: an order is only useful if
  Sapo accepts the address on it, and a more correct dataset would produce addresses Sapo does not
  know. A stored order also keeps the names it was placed with — the record has to say where it was
  actually sent, not where that place is called today.
- **Every ward carries `province_id` as well as `district_id`** (11,665 of 11,665, 63 distinct
  provinces). That is what makes the two-tier fallback possible with no second data source.
- **`npm run check:locations`** prints the three counts against a recorded baseline and shouts when
  the shape changes — a province with no districts, a ward with no district, a *shrinking* table.
  Run it when an address looks wrong, and after any Sapo announcement about the reform.

**The two-tier fallback, and the gate on it.** `listWardsByProvince` and
`/api/locations?level=province-wards` serve a province's wards without going through a district, and
`AddressSelects` hides the district select for a province that has none. Without that branch, the
day Sapo drops the level is the day checkout dead-ends on an empty dropdown with a disabled button —
no error, no log, no sales. **`resolveAddress` accepts a missing district only when Sapo genuinely
has no districts for that province**, never merely because the request left the field out; otherwise
dropping `districtId` would be a way to skip the containment check. Verified: province 2 + ward
9219 with no district → 400, while province 4 returns its 104 wards through the province path.

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
  **Updated 2026-10-07 (T13.2):** `findOrderByTxnRef` and `fetchOrderDetailByRef` now query `open`, `closed` and `cancelled` in parallel (`fetchOrdersByTag`, `lib/sapo.ts`) and **fail closed**: if a status request failed and nothing matched, they throw rather than answer "no order". Measured read-only: `status=closed` and `status=cancelled` answer 200 with 0 orders on this store (22 open orders, no closed or cancelled one exists), so the parameter is accepted, not ignored; `status=any` still returns 0. **NOT verified:** that an actually closed or cancelled order is found — none exists, and closing one needs an endpoint not in any Sapo doc read, so do it by hand in the admin. Cost: 3 Sapo calls per find and 6 per order lookup; Sapo's bucket is 40 (`x-sapo-api-call-limit: 1/40`, `x-bizweb-api-call-limit` the same).
- **Filter with `tag`, never `tags`.** The singular `?tag=vnpay-<txnRef>` filters server-side on the **whole** tag (a prefix of the tag matches nothing, an unknown tag returns an empty list). The plural `?tags=` is silently ignored and returns every order. Both verified against a live store.

**Correction (2026-10-05): `transactions` IS persisted. The earlier note here said it was not, and
that was wrong** — it had been concluded from the order object, which does not show them. The
transaction we send is stored verbatim on its own nested resource:
`GET /admin/orders/{id}/transactions.json` on order #1028 returns
`{id, kind: "sale", status: "success", gateway: "VNPAY", amount: 500000, refund_id: null}`, while
`transactions` on the same order from the **list** endpoint is `undefined`. That also explains the
order's top-level `gateway` — Sapo derives it from the stored transaction, which is why a COD order
(we deliberately send none) comes back `gateway: null` and with **0** transactions. The VNPAY trail
therefore lives in four places: the stored transaction, `gateway`, `note`/`note_attributes`, and
`tags`. `GET /admin/orders/{id}/refunds.json` also reads (`{"refunds":[]}`), while a top-level
`/admin/refunds.json` is not a route. `source_name` is assigned by Sapo itself to the private app's id. `GET /admin/orders/{id}.json` returns no `line_items`; read them from the list endpoint with `fields=...,line_items`.

**`SAPO_VARIANT_ID` links the line item and now also moves stock.** With it set, the payload sends `{variant_id, quantity, price}` and Sapo fills `title`/`sku` from the catalog — so the order shows the catalog's product name, not `PRODUCT.name`.

Stock deduction is explicit: without an `inventory_behaviour` field Sapo defaults to `bypass` and never touches stock (https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2). `buildOrderPayload` therefore sends `inventory_behaviour: "decrement_ignoring_policy"`, but **only when `cfg.variantId` is set** — a custom line item has no variant to deduct.

`decrement_ignoring_policy` is chosen over `decrement_obeying_policy` on purpose: this code only runs after the payment is verified, so a refusal for being out of stock would leave money taken and no order (IPN `99` → VNPAY retries → still fails). Overselling into negative stock is an ops problem; a paid transaction with no order is a money problem. Verified live: stock 10 → 8 after a paid order of 2, and an order of 10 against a stock of 8 still succeeded (`RspCode 00`, stock `-2`).

Sapo's Order API overview notes payment info/transactions may not be stored for API-created orders; the VNPAY references are therefore also in `note` and `note_attributes`.

## Variants (T9)

A product with more than one Sapo variant shows a size picker; a product with one behaves as before. No
flag and no Sanity field: the data decides. Plan: `docs/plan/T9-bien-the-san-pham.md`. **Status:
implemented; the real-order test is done for the VNPAY path (2026-10-06) — a few cases are still open, see below.**

- **`fetchCatalogEntries` returns every variant of every active product**, flat, by `position` (it used to
  take the first only). Each entry carries `variantLabel` — `option1/2/3` joined with ` / `, Sapo's
  `"Default Title"` dropped so it is **empty** for a single-variant product and never printed to a
  customer — and `optionName`, set only when the product has exactly one option whose name matches
  `/^[A-Za-z][A-Za-z0-9_-]{0,29}$/`. That name is the query key (`?Size=`); anything else falls back to
  `?variant=<id>`.
- **`lib/catalog.ts` has two views on purpose, and `getDisplayProducts` is gone.** `getVariantIndex`
  (variantId → variant) is the **one** index `startCheckout` and `quoteTotals` both price against; before
  it, each built its own map. `getStorefrontProducts` groups by `productId` for the home page and sitemap,
  because variants share an `alias` and a flat loop would list a product once per size. The combo filter
  `isSellable` now runs **per variant**: a product with one combo size loses that size, not the product.
  It also withholds a variant with **no price** (price not > 0), so a new size does not appear until the shop sets one.
- **`quoteTotals` throws `CheckoutError` 409 for a variant missing from the index.** It used to skip it
  silently, which could quote a cart lower than checkout would charge. Error messages name the size.
- **Order lines carry an optional `variantLabel`** (`PendingOrderLine` in `lib/store.ts`), optional so
  records already in Redis still read. It feeds `/success` only; the order lookup and its printable slip
  read Sapo's `variant_title` per line, not Redis.
- **Selection (`selectVariant`, client-safe in `lib/product.ts`)**, in order: `?variant=<id>`,
  `?<OptionName>=<label>`, a numeric path handle (`/products/<variantId>`), then the default (first by
  Sapo order, else first in stock). **Input that matches nothing falls back to the default, never a 404.**
  `hasChoice` = more than one variant **and** every one labelled. A sold-out size is drawn but is not a
  link; a product is "sold out" in lists only when all its sizes are.
- **UI side effects.** The Sanity `servings` ("Quy cách") row is hidden when the product has sizes (it
  would contradict the picker). The label shows in the cart drawer, checkout, `/success` and the order
  lookup. `CheckoutForm` no longer clears the discount code when `/api/quote` answers 409 on
  `fields.lines`.

**Verified 2026-10-06 on the live store, read-only, against `next dev`:** product 93155810 ("TEST Size
Picker", alias `test-size-picker`) has one option, `Size`, with four variants (230361050, 230451738,
230451739, 230451740; labels `95g ~ 32 Servings`, `200g ~ 66 Servings`, `5 x 95g không hộp`,
`10 x 95g không hộp`). `/api/catalog` returned all four with labels and the other five products
unlabelled. `/products/test-size-picker` selected the right size for `?Size=` (both `+` and `%20`),
`?variant=<id>` and `/products/<variantId>`, and fell back to the default for a garbage value and a
5000-character one, all 200; `/products/nope` was 404; the sitemap lists the product once. `/api/quote`
priced a known variant correctly, two sizes as two lines, and answered 409 "Một sản phẩm trong giỏ
không còn bán." for unknown variant 999. `typecheck`, `lint`, `build` pass; `reviewer` found nothing
critical.

**Real order of a non-first size, measured 2026-10-06** (real VNPAY sandbox payment, NCB test card, on a
local `next dev` with `npm run watch:ipn` replaying the callback — `APP_BASE_URL` was localhost and there
was no Redis, so the in-memory store). The shop had set prices, SKUs and stock on the test product first:
230361050 `TEST-0070` 248,000 (stock 69); 230451738 `TEST-0071` 348,000 (68); 230451739 `TEST-0072`
458,000 (67); 230451740 `TEST-0073` 848,000 (66). One unit of the **second** size (230451738):

- `/api/checkout` signed `vnp_Amount` 37,800,000 = 348,000 + 30,000 delivery = 378,000₫. Callback
  `vnp_ResponseCode` 00, IPN answered `00`, Sapo order **#1035**: `financial_status: paid`, `total_price`
  378,000, `total_shipping_price` 30,000, `gateway: VNPAY`, stored transaction sale/success 378,000, tags
  `headless-poc, vnpay, vnpay-<txnRef>`.
- **The line as Sapo stored it:** `title` "TEST Size Picker" — **without the size** — `name` "TEST Size Picker -
  200g ~ 66 Servings", `variant_id` 230451738, `variant_title` "200g ~ 66 Servings", `sku` TEST-0071, price
  348,000. So Sapo fills `variant_title` itself from the `variant_id`, and since the title lacks the size the
  order-lookup slip prints "TEST Size Picker (200g ~ 66 Servings)" with no duplication.
- **Stock fell on the right variant:** 230451738 went 68 → 67; the other three stayed 69, 67, 66.
- `/success` showed "TEST Size Picker (200g ~ 66 Servings) × 1 — ₫348,000". `POST /api/order-lookup` with
  the right phone returned the line with `variantTitle` "200g ~ 66 Servings"; a wrong phone and an unknown
  reference both answered 404 with the identical message. No "Default Title" on `/`,
  `/products/test-product-1` or `/products/test-size-picker`.
- The picker rendered with sizes in stock for the first time: the selected size carried `aria-current`, and
  the home tile read "Từ ₫248,000".
- Cleanup: order #1035 was deleted by id (DELETE 200, none left tagged). Deleting does **not** restock:
  230451738 stayed at 67 and the shop has to put its on-hand back to 68 by hand.

**Found on the way, fixed 2026-10-06 (pre-push review):** before the shop set prices, two variants sat at
price 0 and were treated as sellable. The code did not refuse a price ≤ 0. The earlier claim here that VNPAY
would reject an amount of 0 was **wrong**: the signed amount is goods + delivery, so a price-0 variant would
have been paid for with the delivery fee alone, which VNPAY accepts, and beside a basket over the
free-delivery line (`FREE_SHIPPING_THRESHOLD_VND`, `lib/shipping.ts`) it would have ridden along free, up to
10 units. **Now withheld in `isSellable` (`lib/catalog.ts`), the same place as the combo filter**, logging
`catalog.unpriced_withheld`; storefront, cart, quote and checkout share that list, so none offers it.
**Not exercised against live Sapo data** (no variant is priced 0 now, and the store was not written to): only
`typecheck` and `lint` pass, and `/api/catalog` still returned the same 9 priced variants on 2026-10-06
(248000, 348000, 458000, 848000, 268000, 75000, 250000, 50000, 100000).

**Open items — NOT verified, do not treat as fact:**

- **Two sizes of one product in a single cart, end to end.** Quote prices them as two lines (above), but no
  real order has carried two lines.
- **A sold-out size on a page where other sizes are in stock.** Earlier, all four were sold out; today all
  four were in stock, so the mixed case has not been rendered.
- **A variant with no SKU** falls back to `PRODUCT.sku` (`TEST-001`). Pre-existing fallback; all four test
  variants have SKUs now, so it was not exercised on 2026-10-06. Give every size its own SKU in Sapo.
- **Multi-pack sizes (`5 x 95g`) keep independent stock** from the single pack, so the two counters drift
  unless the shop balances them by hand. Same family as T8, milder; not solved here.
- Reviewer nits left unfixed: the checkout page serialises each variant's copy of the description to the
  client (N sizes → N copies); the home tile hides compare-at price when sizes differ in price; the labels
  "A+B" and "A B" match each other in `?Size=`.

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
- **A `globalThis` cache survives a module reload, so it outlives the shape it was built for.**
  `lib/locations.ts` memoises the three tables on `globalThis` (1 hour) so a save does not
  re-download 1.2 MB of wards. The key carries a **shape version** (`__vnpaySapoLocations_v2`) and it
  has to be bumped whenever a mapped row changes. Hit for real while building the two-tier fallback:
  `Ward` gained `provinceId`, the cached rows had been built without it, and
  `listWardsByProvince` returned **zero** wards for every province — no error, no warning, just an
  empty dropdown. Production never sees it (a new deployment is a new process), which is precisely
  why only someone mid-edit would ever find it. Same class as the stale `unstable_cache` entry below.
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
- **Nav keeps the reference's links, except ones that lead nowhere.** `/ve-chung-toi` and `/lien-he` are built now (brand pages); `/wholesale` is **not in the nav any more** — it 404s on the reference site too (checked 2026-10-06), so linking it would ship a dead link. A wholesale page can return when there is something to put on it.
- **The shop is called "The Hour Tea" everywhere a customer reads it** (wordmark, footer, blog/product metadata). The root layout sets `title.template` to `'%s | The Hour Tea'`, so **a child page returns a bare title** — writing the brand into it too prints it twice. "VNPAY → Sapo PoC" / "Hour PoC" are gone from customer-facing text.
- **The footer carries the business identity**: legal name, registration (MST), registered address, hotline and hours, email, social links, the four policy links and a link to `/tra-cuu-don`. All of it comes from `lib/business.ts`.

### T12 — the site-v3 shell and pages (implemented 2026-10-07, uncommitted and not deployed)

Plan and decisions: `docs/plan/T12-giao-dien-site-v3.md`, from `design/site-v3/`. T12.1–T12.5 are built; T12.6 (collections) is blocked, see Known MVP limitations. Verified 2026-10-07 on `next start` of a production build with read-only GETs, plus unit tests, typecheck, lint and build.

- **The shell** is `components/SiteHeader.tsx` + `components/SiteFooter.tsx` (see the paths table). `/` is the landing page and the catalog is `/shop`; `/products/*` URLs did not change.
- **The storefront mirrors Sapo (owner's decision, 2026-10-07).** `/` and `/shop` list `getStorefrontProducts()` — every active product with a price, combos withheld (`isSellable`) — read live on every request, so a product created in Sapo is listed and buyable on the next page load. The shop's own test products (`isTestProduct`, name starting with the word "test") are listed and sold like the rest; they are only kept out of search engines: `getIndexableProducts()` leaves them out of the sitemap and their page is `noindex`. T12 had hidden them from the listings, and a `SHOW_TEST_PRODUCTS` switch let a dev machine show them; both were removed the same day. `products.json?limit=250` is read in one page, so a store with more than 250 products would not list them all.
- **`/ve-chung-toi`** gained the "Sản phẩm The Hour" section (anchor `#san-pham`) without health claims or certifications, and two founder paragraphs ("an toàn tuyệt đối" left out). With `SHOW_HEALTH_CLAIMS` false it still omits the FDA line.
- **Trap: `a { color: var(--accent) }` now sits in `@layer base`** in `app/globals.css`. Unlayered, it beat every Tailwind utility on a link and painted all links amber, including the text on amber buttons. In the layer a utility class on a link wins. Anything that relied on links being amber by default must say so.
- **New `@theme` tokens:** `--color-placeholder`, `-2`, `-3`, `-dark` and `--color-hero-a`, `-b` — grey boxes standing in for photographs, since the design file has no photograph at all. Replace them when real images arrive. The marquee uses CSS keyframes, pauses on hover and focus, and has a reduced-motion fallback.
- **Not built, by decision:** dark mode (the T6 decision stands), the footer newsletter form, the Bộ Công Thương link, a search page.
- **Reviewer nits left open:** heading-level skip on `/shop` (h3 under h1), hardcoded px sizes, hero colour tokens.

**In the reference, deliberately not built — all for want of data, not CSS:**

| | Why |
|---|---|
| Customer reviews | No source — Sapo does not provide them and no schema exists. (T12's landing page does carry **one static, named testimonial**; that is a quote, not a review system, and is unconfirmed by the owner) |
| Multi-image product gallery | Sapo returns one image per product; the grid holds a single cell. A Sanity `imageSlider` block can carry more |
| Filter sidebar | The reference reserves a wide left column for facets, which is why its grid sits off-centre. Sapo gives us none, so the grid is centred instead of leaving a 404px gap |
| Payment brand marks | Third-party assets, and this project only takes VNPAY — it says so in words |
| Logo artwork | A text wordmark is used; this is a different project |

## Staying out of search results on non-production deployments

No new env var; the switch is Vercel's own `VERCEL_ENV` (a system variable, so it is not in `.env.example`).

- **`isIndexableDeployment()` (`lib/config.ts`)**: true only when `VERCEL_ENV` is undefined (`next dev`, `next start`) or `"production"`. Every preview or branch deployment gets `<meta name="robots" content="noindex, nofollow">` (root layout) **and** `Disallow: /` in `/robots.txt` (`app/robots.ts`). Why: a preview serves the real catalog under another address, so indexing it would split the shop's search results and publish unfinished work.
- **Measured 2026-10-06, locally, with `VERCEL_ENV=preview`:** `/robots.txt` answered `Disallow: /` and the page carried `noindex, nofollow`.
- **NOT yet measured on a real Vercel preview — unverified.** It relies on the project exposing system environment variables to the build and runtime (Vercel's default; `lib/store.ts` already depends on the same variable). If that setting were off, previews would become indexable without a warning. **To check after the first preview deploy:** a read-only `GET <preview-url>/robots.txt` must show `Disallow: /`.
- **Other SEO added with it (verified 2026-10-06 on a local dev server, Playwright + curl, except where marked):** product pages carry a canonical equal to the sitemap's default-variant address (sizes are one page to a search engine, not four) plus OpenGraph; `/success` is `noindex`; the sitemap lists the brand and policy pages. `/tra-cuu-don` also has `noindex` in its metadata (read in code, not separately measured) and is disallowed in robots.txt; a crawler that obeys the disallow never sees its meta tag, so the disallow is what keeps it out.

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
- **Sapo failure after verified payment** → status `sapo_error`. Deployed behaviour: IPN returns `99` so VNPAY retries the IPN, which retries Sapo. **From PR 6b (c8b5abb, deployed 2026-10-08):** `99` only when the ledger could not confirm the commit of payment + job; otherwise the IPN answers `00` and the `create_sapo_order` job retries through the sweep (decision D1, 2026-10-08), ending in `sapo_gave_up` after 8 tries.
- **T13 (2026-10-07), committed (0ad5ad7 and after) and deployed to production the same day; the querydr path itself has only been run end to end on a local server, not yet on production.** Plan: `docs/plan/T13-khep-muc-con-lai.md`. Why: order #1039 on production — VNPAY took 361,200₫ and sent **no IPN** (Vercel logs showed no `/api/vnpay/ipn` request for ~4 min); it reached Sapo only through a manual `npm run querydr` plus a replay of the logged return callback. Order #1040, six minutes later with the same reference format, got its IPN in 4 s, and earlier orders show 72–477 s lags, so a missing or late IPN is a VNPAY-sandbox behaviour, not our configuration. The owner approved all six plan decisions as recommended.
  - **T13.0 `reconcilePendingPayment` (`lib/order.ts`) + `lib/querydr.ts`.** The result page asks VNPAY once an order (`pending`/`processing`/`sapo_error`, not COD, younger than 2 h) has waited 60 s **since the page first asked** (store counters `querydr-seen:` / `querydr-known:`), at most once a minute per reference (`querydr:`). VNPAY's answer must verify — request checksum = 9 values joined with `|`; response checksum = 15 values joined with `|`, field order from the docs, **checked against a live sandbox answer: our HMAC-SHA512 equalled its `vnp_SecureHash`** — and be about our `vnp_TmnCode` and the reference, type `01`, `ResponseCode` 00 and `TransactionStatus` 00. Then `settlePayment` (the former body of `handleIpn`, now shared: amount check → `04` + alert, cross-instance claim, Sapo duplicate guard), so the two doors cannot disagree. 6 s timeout. `getQueryDrUrl()` is in `lib/config.ts` (see the env table). **Limitation (superseded in code 2026-10-07):** on its own it ran only when someone opened `/success`; the sweep (T14 PR 6, "Transaction ledger") now calls it for orders nobody is looking at. Since T14 the result page asks only for an order whose signed browser return said paid. **NOT yet verified end to end on production:** no real missed-IPN payment has gone through either path there.
  - **T13.4 `startCheckoutOnce`.** The checkout sends an `Idempotency-Key` header (random per page load, from `CheckoutForm`). The same key with the same form within 2 minutes, while the order is still pending, returns the same payment URL instead of a second pending order. Stored through `OrderStore` `kvGet`/`kvSet`/`kvSetIfAbsent`/`kvDelete` (Redis prefix `vnpay-sapo:kv:`, 15 min TTL, 60 s lock). A different form under the same key starts a new checkout; a failure frees the key; a second simultaneous submit answers 409.
  - **T13.5 pending-order TTL 24 h → 7 days** (`ORDER_TTL_SECONDS`, `lib/store.ts`), so a late IPN or a recovery still finds the record. Records already in Redis keep their 24 h until next written.
  - **T13.6 rate-limit policy `quote`: 120 / 10 min / IP on every `/api/quote` call**, before Sapo is called; the `discount` limit stays for code tries. **Decided, not changed: the IPN is not rate limited** — the signature protects it, and blocking a VNPAY retry would lose a paid order.
  - **T13.7 not changed, on purpose:** the IPN log's `remoteIp` / `userAgent` are VNPAY's server, not customer data, and are useful forensics.
  - **T13.8** `components/OrderLookup.tsx` shows a "Giao hàng" row for an open order: `null` → "Chưa giao hàng"; `fulfilled` / `partial` (Shopify names, **unverified for Sapo** — all 22 orders had `null`) → labels; any other value is hidden. No tracking number (none appeared in any response).
  - **T13.9 JSON-LD** (`lib/jsonld.ts`, `components/JsonLd.tsx`): one `Offer` for a single price, an `AggregateOffer` (low/high/offerCount) for sizes priced differently; `url` only when `APP_BASE_URL` is set. **Not checked with Google's Rich Results Test yet.**
  - **T13.3** `lib/sapo.test.ts` has a unit test that a POST whose answer is lost is found by tag on the retry and not created twice. Mocks only, not Sapo.
  - **T13.1 measured 2026-10-07, on a LOCAL `next dev` against the real VNPAY sandbox and real Sapo** (`APP_BASE_URL` was localhost, so no portal IPN could reach it; `watch:ipn` was not running; in-memory store).
    - **Missing IPN recovered by the `/success` path.** Ref `20261007173115WXDSJYNYZ2ZWEFEC` (Test Product 2, 80,000₫): VNPAY returned `00`, no IPN arrived. About 5 minutes later a render of `/success` (triggered by a `curl`, because the customer's tab had sent only one request) ran the querydr path: log `querydr.paid_without_ipn` (`ageSeconds` 588) → `sapo.order_created` → `querydr.settled`; Sapo order #1041, paid, 80,000. So the T13.0 path works against real VNPAY and Sapo, **locally**; it has still not run on production.
    - **Idempotency-Key (T13.4):** the same checkout request sent twice with one key returned the same `txnRef` (`checkout.replayed` in the log).
    - **Cancel:** ref `202610071741375DM4V1VF5ZTGV9AX`, VNPAY return code `24`; `/success` showed "Đã huỷ thanh toán… Không có đơn hàng nào được tạo", Sapo had 0 orders for the tag, and `querydr` answered `ResponseCode 00` with `vnp_TransactionStatus 11` (cancelled; the label was added to `scripts/querydr.mjs`). Nothing was created.
    - **Not done:** an order that is really closed or cancelled in Sapo being found by the three-status lookup. The owner's Sapo trial has expired and no verified endpoint exists to close or cancel an order from here, so it rests on unit tests plus the measurement that `status=closed` / `status=cancelled` answer 200 with 0 orders (not ignored: the unfiltered list had 22).
    - **Production, read-only (2026-10-07):** order #1040 (the owner's own payment, new reference format, IPN in 4 s) is found by `POST /api/order-lookup` with the right phone (lower-case reference and `+84` form accepted); a wrong phone answers the same 404. Its `fulfillmentStatus` is undefined, shown as "Chưa giao hàng" for an open order.
  - **T13.10 mobile layout, measured 2026-10-07:** Chrome DevTools Protocol emulation of a 390 px phone (headless Chromium, no library added) over 9 production pages (`/`, `/shop`, a product, `/ve-chung-toi`, `/lien-he`, `/blog`, a policy, `/checkout`, `/tra-cuu-don`): none scrolls sideways (`scrollWidth` = 390 on all). One real bug, fixed in commit `1a08143`: the open menu panel started mid-screen and ran about 100 px past the right edge; after the fix a local production build shows no element past the edge. 9–13 links/buttons per page measure under 24 px in a dimension — **not investigated**.
  - **T13.11 Lighthouse 13.5 (mobile, simulated throttling), production, 2 runs each, 2026-10-07:** `/` LCP 1.6–2.1 s, CLS 0, TBT 90–480 ms; `/shop` LCP 3.4–3.6 s, CLS 0–0.03; a product page LCP 3.1–3.6 s, CLS 0. Performance score 82–98. **The LCP ≤ 2.5 s target is NOT met on `/shop` and the product page.** INP cannot be measured in a lab (TBT is only a proxy). LCP breakdown: ~250 ms to first byte, ~1.4 s resource-load delay, ~0.4–0.9 s download. The image request starts only when the streamed HTML finishes (~1.67 s), because the page waits for Sapo's product list (~1.4 s) before it can emit the `<img>`; the images (~40 KB webp) are not the cause. Tried without effect: eager + `fetchpriority=high` on the top tiles / product image (`b77bdab`) and `<link rel="preconnect" href="https://bizweb.dktcdn.net">` (`4dc5561`). The remaining lever is caching Sapo's product list on listing pages for tens of seconds, which conflicts with "price and stock never stale" and "a product created in Sapo appears on the next request" — **the owner decided on 2026-10-07 to cache it for 30 s (`app/listing-cache.ts`); the LCP has not been re-measured since.**
  - **T13.12 Sapo API limit, measured 2026-10-07:** responses carry `x-sapo-api-call-limit: 1/40` and `x-bizweb-api-call-limit` (a 40-call bucket); `GET /admin/shop.json` returned no plan name, so the account's plan is **still unknown** (the owner says the trial has expired).
  - **T13.13** was written as `docs/plan/T14-so-giao-dich-postgres.md` and is now built in part — see "Transaction ledger (T14)" below. T13.7 stays unchanged by decision.
  - **T13.2 verified on a real cancelled order (2026-10-07).** Order #1039 was cancelled with `POST /admin/orders/{id}/cancel.json` and body `{"order_cancel":{"reason":"other","note":"..."}}` (the endpoint is named in Sapo's docs; the body shape was learned from its 400 error). A lookup by reference on production then found it with `status=cancelled`, while `status=open` no longer did. This closes the "Not done" item above.
- **Transaction ledger (T14, 2026-10-07).** Plan and measurements: `docs/plan/T14-so-giao-dich-postgres.md`. Neon was enabled by the owner for Production and Preview — **one database for both**. Redis stays the source of truth; Postgres is written beside it and **read only by the sweep and the purge**.
  - **PR 4 (`be7dbb9`)**: five tables, `drizzle/0000_ledger.sql`, `scripts/migrate.mjs` at the start of `npm run build`. Verified in the Vercel build log: "migrate: schema is up to date". Preview builds skip it because they share the production database.
  - **PR 5 (`511d65e`)**: `lib/ledger.ts` records checkout, payment, Sapo result and webhook evidence (signature dropped). Every call is raced against a 4 s timeout, errors are swallowed, one failure opens a 30 s breaker (reads do not open it), and states never move backwards; `ledgerCompare` logs `ledger.mismatch` against Redis. The logged error text is sanitised: a failed drizzle query's message carries SQL **and parameters, i.e. customer data**, so only the Postgres code / cause is logged. **Verified on production with a real sandbox payment (order #1042, deleted):** `ledger.ok` for checkout, payment, sapo, webhook and compare, no `ledger.mismatch` — **but the IPN answered in 5.5 s (about 2.4 s before)**, because the first Neon call after idle took about 2 s. Not yet mitigated.
  - **90-day purge**: Vercel cron `/api/cron/purge` daily, empties `orders.customer` once `purge_after` has passed. The privacy policy now says 90 days (it used to promise 2 years that nothing enforced). Redis TTL is 7 days. Verified: the route answers 401 without the secret. Unverified: an actual purge of old rows (no ledger row is 90 days old yet).
  - **PR 6 (`a41c659`), the sweep** (`lib/sweep.ts`, `/api/jobs/sweep`): lists from the ledger VNPAY orders pending between 1 minute and 2 hours, and paid orders (same window) whose Sapo order is not created. Order: a reference whose signed browser return said paid first, then least-asked, then newest. At most 10 asked per run, per-reference caps of 5 (pending) and 8 (unsynced) counted in the store (`sweep:<ref>`), a 20 s budget, `maxDuration` 120. Each goes to `reconcilePendingPayment(skipWait)`, so there is still one way to create a paid order. Triggered by QStash every 5 minutes (schedule `vnpay-sapo-sweep-production`, made with `scripts/qstash-schedule.mjs`; signature verified with `@upstash/qstash` `Receiver` against `APP_BASE_URL` + `/api/jobs/sweep`) and by a daily Vercel cron at 21:00 UTC with `Bearer CRON_SECRET` (it sees only the last 2 h: a heartbeat, not a substitute). **Verified on production:** a QStash-signed call at 12:15:01Z logged `sweep.run` with 0 candidates; an unauthenticated POST got 401 and logged `sweep.unauthorised`. **A real missed-IPN payment has NOT yet been recovered by the sweep.**
  - **VNPAY sandbox `querydr` limit, measured 2026-10-07:** after one `querydr` is accepted, further ones answer `vnp_ResponseCode` **94** for about five minutes, for the same reference or another (accepted 18:52:16; refused at +9 s, +79 s, +3 m 39 s, +4 m 40 s; accepted at +4 m 52 s; a different reference 1 s after an accepted one was refused). **Unknown for production VNPAY.** Coded: reason `rate_limited` for 94; one shared atomic cool-down key `querydr-cooldown` (`SET NX EX` 290 s, 60 s after a 94); the result page asks only for an order carrying the signed-return hint; an order in `sapo_error`/`processing` is retried from the ledger's recorded paid attempt **without** a VNPAY call; and `alertUnsettledPaidReturn` mails the owner (`paid_no_order`, or `sapo_failed` for `sapo_error`/`processing`; nothing if the order has finished since) when a hinted order has hit its ask cap or is older than 105 minutes and still unconfirmed.
  - **Honest limits.** The sweep cannot recover orders created before the ledger existed. At one `querydr` per 5 minutes per terminal, several simultaneous lost IPNs are recovered about one per 5 minutes. Neon Free allows 100 compute-hours a month with mandatory scale-to-zero after 5 idle minutes (Neon's plans page, read 2026-10-07; the owner is on Free), so a query every 5 minutes would burn about 180 CU-hours at 0.25 CU and suspend the database around the 17th: the sweep therefore opens a connection only while a Redis hint is set (30 minutes after a checkout, 2 hours after a signed "paid" return; commit 3b5f99d). The compute hours actually used per month are **not measured yet**. Reading from Postgres instead of Redis and PR 7–10 are still to do.
  - **PR 6b (built and reviewed 2026-10-08, committed c8b5abb, deployed to production 2026-10-08).** Plan: `docs/plan/T14-6b-ipn-ghi-so-truoc.md`. Goal: answer VNPAY `00` only once the order is in Sapo **or** the payment and a retry job are committed together. `ledgerCommitPaid(order, params)` (`lib/ledger.ts`) is one Postgres transaction: upsert `orders` + `payment_attempts` from the Redis record, `SELECT … FOR UPDATE` the attempt, mark it paid, `INSERT outbox_jobs` kind `create_sapo_order` with unique `dedupe_key` `create_sapo_order:<txnRef>` `ON CONFLICT DO NOTHING`, payload `{txnRef, ns}`. It returns `committed` | `already` | `unavailable` (no DB, breaker open, error and rollback, 4 s timeout, an old schema without `dedupe_key`, a refunded attempt). In `applyIpnResult` (`lib/order.ts`): committed or already ⇒ `00` / `02` **even if Sapo then fails** (decision D1; the failed try is counted on the job and the sweep hint is renewed); `unavailable` ⇒ the pre-6b behaviour (`00` only once Sapo created the order, else `99`). `runSapoJob(txnRef)` runs a waiting job through `settlePayment(ledgerPaidParams(ref))`; a job with no usable paid record counts as a failed try so it cannot starve the queue, and ends in alert `sapo_gave_up`. The sweep runs due jobs first (max 10 per run); the "unsynced" candidate list excludes paid orders that have a job. `reconcilePendingPayment` reports "settled" only if Sapo did not fail. `handleIpn` returns only `{RspCode, Message}`. Migration `drizzle/0001_outbox_dedupe.sql` is additive.
    - **Deliberate choices.** No `locked_until` job lock: the Redis claim in `settlePayment` already serialises IPN, `querydr` and the job runner, and a second lock in Postgres would only add a way to disagree. The job payload carries the Redis namespace and `ledgerDueSapoJobs` filters on it, because Production and Preview share one database but not Redis. The daily Vercel cron bypasses the `sweep-active` idle gate (one database wake-up a day) so a lost Redis hint cannot strand a job; QStash runs still respect it.
    - **Verified 2026-10-08, locally only:** `npm test` 13 files / 229 tests pass; typecheck, lint, build pass (test-runner ran before the last small fixes; typecheck, lint and tests were re-run after them). The ledger and IPN tests use PGlite. Mutation checks, each reverted: committing without a transaction fails the rollback test; answering `00` when the ledger is unavailable and Sapo failed fails 3 tests. `reviewer` found no critical issue and five should-fix items, all fixed: the give-up alert swallowed by the hourly dedupe (now its own kind), a wrong alert text, a lost sweep hint, preview jobs in the shared database, uncounted "skipped" jobs.
    - **Verified on production 2026-10-08:** the Vercel build log said "migrate: schema is up to date" (05:02:36Z). A real sandbox payment, ref `20261008120437G5B94VT5ZQQD6X6T` (Test Product 2, 80,000₫, NCB), logged `ipn.ledger_committed` (committed) → `sapo.order_created` #1043 → job done → IPN answered `00`, `durationMs` 7396. Replaying VNPAY's genuine signed callback answered `02` and made no duplicate. Sapo held exactly one order for it (paid, 80,000, transaction sale/success VNPAY); it was deleted by id (DELETE 200, none left with the tag). Stock of Test Product 2 went 34 → 33 and was **not** restocked. VNPAY delivered the IPN less than 0.6 s after the OTP was confirmed.
    - **IPN latency, measured 2026-10-08 on that order, BEFORE the one-statement change below:** 7396 ms = `commit_paid` ~3.4 s (cold Neon) + Sapo ~2.4 s + `job_done` 0.22 s + `sapo` 0.67 s + `compare` 0.22 s + `webhook` 0.45 s. Follow-up (uncommitted at the time of writing): on the success path `ledgerRecordSapo({ok:true})` is now **one SQL statement** (data-modifying CTEs: `orders` → created, insert `sapo_mappings`, outbox job → done) in place of four round trips (a separate `job_done`, then select/update/insert). **Measured after deploying it (f239256, 2026-10-08, order #1044, real sandbox payment, deleted):** IPN `durationMs` 5660 against 7396 before; the work after Sapo answered took ~0.9 s (sapo 0.22, compare 0.22, webhook 0.44) against ~1.6 s, `ledger.ok what=sapo` appeared with no `ledger.write_failed`, so the statement runs on Neon. `commit_paid` still took ~2.6 s (cold Neon) and Sapo ~2.2 s; a repeat of the genuine signed callback answered `02` and Sapo held one order. How long VNPAY waits for an IPN answer is still unknown.
    - **NOT verified:** "Sapo fails for real, then the job retries" is covered only by unit tests; no alert mail has ever been sent (see "Order alerts"). **Known nits left unfixed:** reloading `/success` for an order in `sapo_error`/`processing` spends a job attempt and ignores the back-off; jobs and VNPAY asks share the sweep's 20 s budget; if `scripts/migrate.mjs` fails the build still succeeds and 6b silently falls back to the pre-6b path, so after deploying check the Vercel build log says "migrate: schema is up to date".
  - **PR 6c (built, reviewed and deployed 2026-10-08, commit `1d7d552`).** Plan: `docs/plan/T14-6c-tra-loi-ipn-som.md` (owner approved D1–D3 on 2026-10-08, all as recommended). Goal: cut the IPN time by answering VNPAY once the payment is durable and creating the Sapo order after the answer. `app/api/vnpay/ipn/route.ts` passes Next 16's `after` as `defer` to `handleIpn(params, {defer})` (`lib/` still imports no `next`). When `ledgerCommitPaid` returns `committed` or `already` and a `defer` exists, the IPN order is: ... commit → Redis `processing` → `markSweepActiveAfterPaidReturn` (so a sweep still sees the job if the process dies) → answer `00` (`02` for already) → **after the answer** `createInSapo` (the old try/catch body, unchanged). The Redis claim is held until the deferred work ends: the deferred wrapper catches everything and releases it in `finally`; `releaseLater` is set only after `defer` returned, so a `defer` that throws synchronously (Next's `after` throws outside a request scope) releases the claim and `applyIpnResult` creates the order inline instead (log `ipn.defer_unavailable`). Without `defer` (the `querydr` path, the sweep runner, tests) or with the ledger `unavailable`, behaviour is exactly as in 6b: `00` only once Sapo has the order, else `99`. A replay or the job runner meeting the held claim gets `99` / `busy`; `runSapoJob` no longer counts `busy` as a failed try. The route sets `maxDuration = 120` (worst case with a slow Sapo about 55 s: ledger commit 4 s, two Sapo calls 15 s each, three ledger calls 4 s each, alert mail 5 s; the plan said 60 and the reviewer's arithmetic raised it). `ledgerCommitPaid` logs `ledger.commit_timing` `{txnRef, beganMs, firstMs, totalMs, outcome}` (cumulative: pool connect + BEGIN, through the first insert, through COMMIT) to tell whether the ~2.6 s cold commit is the connection or the statements.
    - **Verified 2026-10-08, locally only:** 15 files / 253 tests pass (PGlite); typecheck, lint, build pass. New tests: answer before Sapo, claim held then freed, never-run work finished by `runSapoJob`, failure in the deferred work counted, `defer` throwing, already + deferral, `unavailable` stays synchronous, forged / wrong-amount / failed payments defer nothing, `busy` not counted. Mutation checks, each reverted: releasing the claim at answer time fails 2 tests; deferring when the ledger is unavailable fails 1. `reviewer`: no critical issue; two should-fix items fixed (claim leak when `after` throws; a test that never reached the wrapper's catch).
    - **Verified on production 2026-10-08 (order #1045, real sandbox payment NCB, 80,000₫, deleted):** `ipn.response` `00` at 07:12:47.754 came **before** `sapo.order_created` at 07:12:49.902 and the deferred work then finished (`ledger.ok what=sapo`, `compare`), so `after()` does live until the work ends on this deployment; IPN `durationMs` **4072** (5660 before 6c, 7396 before the one-statement write); `ledger.commit_timing` `beganMs` 879 (pool connect + BEGIN), `firstMs` 1102, `totalMs` 2611 — so the cold connection is ~0.9 s and the other eight statements of the commit take ~1.5 s (about 0.2 s each, one network round trip apiece): the next lever is fewer statements, not a warmer connection. A repeat of the genuine signed callback answered `02`; Sapo held exactly one order; no `ledger.write_failed`, `ledger.mismatch`, `ipn.deferred_failed` or `ipn.defer_unavailable` in the log. **Still NOT verified:** a process cut off after the answer (only simulated in tests); whether the sweep hint now set after every paid IPN (2 h) costs Neon Free compute hours (up to about 24 sweep runs per order when the customer closed the tab; the compute budget is still unmeasured); how long VNPAY waits for an IPN answer. **Trade-off:** if `after` is cut off, the order reaches Sapo through the sweep in up to 5 minutes instead of seconds. **Known nit left:** if `store.put(completed)` throws after Sapo created the order, the catch records `sapo_error`, counts a job failure and mails `sapo_failed` for an order that exists (pre-existing; `createOrderOnce`'s tag lookup prevents a duplicate).
- **Owner decisions, 2026-10-07.** The storefront mirrors Sapo, test products included. The home and `/shop` lists are cached 30 s (`app/listing-cache.ts`); the product page, cart drawer, quote and checkout read live. The named testimonial was removed (`TESTIMONIALS` is empty), the "3 vị trà mới" block is hidden (`SHOW_NEW_SEASON = false`) and the "bán chạy" grid appears only with `BEST_SELLER_MIN` products. The loose-leaf vs tea-bag FAQ comparison was rewritten in Sanity without health or microplastic claims (6 `productContent` documents patched with `sanity exec`). **Address tables: keep Sapo's old 63-province / district map until Sapo updates.** The Hồng Trà Shan Tuyết product data (name, 60 g, ingredients, origin — it is not Ceylon) must be corrected **in Sapo by the owner**; pending because his Sapo trial has expired and he cannot reach the admin (the API still reads and writes). VNPAY production merchant paperwork is deliberately **last**; remind the owner with a checklist. LCP was **not re-measured** after the 30 s listing cache.
- **Order alerts (`lib/alert.ts`, added 2026-10-06).** A customer who has paid and has no order is the one failure nobody would otherwise see, so `handleIpn` / `applyIpnResult` call `notifyOwner` for three cases: `paid_no_order` (VNPAY confirms a successful payment for a reference with no stored order — the 7-day record expired, or checkout ran on a preview while the portal IPN points at production; IPN `01`), `amount_mismatch` (IPN `04`) and `sapo_failed` (IPN `99`; since 6b, deployed, also when the IPN answered `00` because the retry job took over, and the text says VNPAY **or** the background job retries). A fourth kind, `sapo_gave_up` (6b), is sent when a job has failed 8 times: it has its own hourly dedupe so the limit on `sapo_failed` cannot swallow it, and tells the owner to create the order by hand with tag `vnpay-<ref>`. The mail goes out through Resend's REST API (`POST https://api.resend.com/emails`, Bearer key, `from`/`to`/`subject`/`text`; request shape checked against Resend's send-email reference on 2026-10-06).
  - **It can never change the IPN answer.** It is awaited before the answer returns (a serverless function may be frozen the moment the response is sent), but `sendAlert` never throws and `notifyOwner` swallows anything else; a unit test pins that a failing mail leaves the answer unchanged.
  - **Dedupe is one mail per reference + kind per hour, counted only after a mail was actually sent**, so a failed send does not mute the incident and VNPAY's next retry tries again. The counter is `hit`/`count` in the shared store; `count` reads without incrementing.
  - **No customer data in the mail**: reference, amount, VNPAY transaction number and a fixed reason label (Sapo HTTP status / unreachable / internal) — never a response body.
  - **"What to do" differs per kind, on purpose.** Every mail first says to look in Sapo for an order tagged `vnpay-<ref>` and to stop if one exists (a signed callback can be replayed, so an alert can be a false alarm). `replay-ipn` is suggested only for `sapo_failed`. For the other two it is the wrong tool, and so is `npm run refund` (it needs an existing Sapo order): the mail says to create the order by hand or refund through the VNPAY merchant portal. **That refund-through-the-portal step has not been exercised by this repo.**
  - **Off unless `RESEND_API_KEY` and `ALERT_EMAIL` (older name `ALERT_EMAIL_TO`) are both set**; then the only trace is the log line `alert.not_configured`. On 2026-10-07 the owner enabled Resend (`RESEND_API_KEY` for Production and Preview, sender `onboarding@resend.dev`) and Neon, and the owner set `ALERT_EMAIL` and `CONTACT_EMAIL` on Vercel on 2026-10-08, so alerts are now on. **Unverified end to end:** **no alert mail has ever been sent** (2026-10-08: an attempt to trigger one with a self-signed IPN for an unissued reference was blocked by Claude Code's permission classifier; the owner can run `node --env-file=.env.local scripts/simulate-ipn.mjs 20261008120000999999 1000 00 https://vnpay-sapo-poc.vercel.app`), so it is not known that Resend accepts the alert payload or that the shared sender delivers only to the address the Resend account was opened with. For the contact form, Resend accepted the payload including `reply_to` (production, 2026-10-08, see the `CONTACT_EMAIL` row); delivery to the inbox is unconfirmed. Checkly is not provisioned.
- **Retries of a failed Sapo order cannot be a per-minute cron.** Measured 2026-10-06 with the Vercel CLI: the account is on the **Hobby** plan, and per Vercel's cron docs (vercel.com/docs/cron-jobs/usage-and-pricing, last updated 2026-07-15) Hobby cron jobs run **at most once per day**, with ±59 minutes of precision, and a more frequent expression **fails the deployment**. A scan every minute is therefore not available. The plan is Upstash QStash for the retries (provisioned 2026-10-06: `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` exist for Production and Preview; **used since 2026-10-07 by the sweep**, see "Transaction ledger"), plus a daily cron as a safety net. A cron entry in `vercel.json` more often than daily would break the deploy, so do not add one.
- **One Redis database is attached to every Vercel environment at once**, so keys carry a namespace (`lib/store.ts` `keyNamespace()`): production keeps the unprefixed keys it has always used — shipping the namespacing could not orphan an order mid-payment — while a preview gets `preview-<branch>` (keyed by `VERCEL_GIT_COMMIT_REF`, so redeploying a branch keeps its orders) and a local server gets `local`. Without this, a preview of a branch that changed `PendingOrder` would write records straight into the set production reads, and production, on older code, would mis-read them for a real customer. `store.redis` logs the namespace so a mix-up is visible without guessing. Sharing a namespace on purpose (`ORDER_STORE_NAMESPACE=`) is what lets a local server finish an order whose IPN VNPAY delivered to the production deployment, since the portal holds only one IPN URL; it is only safe while both sides agree on the record shape.
- **The cart lives in the browser and carries no prices.** `localStorage` holds only `{variantId, quantity}`; `/api/checkout` resolves each variant against the live Sapo catalog and recomputes every amount, so a tampered cart can change *what* is ordered but never *what it costs*. A line is keyed by `variantId` because that is where Sapo keeps price and stock. Duplicate variants in one request are folded into a single line rather than refused, and the per-line and per-cart ceilings (`MAX_QUANTITY`, `MAX_CART_LINES`) bound how much work a request can ask for.
- **The cart is cleared on the result page, not at checkout**, so a cancelled payment leaves the basket intact.
- **A product page's handle is Sapo's `alias`, and the route also accepts a `variantId`** (`getProductByHandle`). Links are built from the alias because they are readable and Sapo generates them already; the numeric form is the fallback for a product Sapo gave no alias, and stays valid when renaming a product changes its alias. The lookup filters the catalog list rather than calling a per-product endpoint, which keeps this code on the one Sapo products endpoint that has been verified against a live store.
- **A product's description is stripped to text, never rendered as HTML.** Sapo returns `content` as HTML, so rendering it would let whatever is typed into a product's description execute on the storefront.
- **A stored order without `lines` is read as one line** from the old top-level `sku`/`quantity` (`normaliseLines`). Production shares one key namespace across deploys of `main`, so the first deploy that understands carts will read records the previous deploy wrote for orders that were mid-payment; without the fallback those would be dropped exactly when their IPN arrived. A record that is neither shape is reported absent, which answers `01` and lets VNPAY retry rather than inventing an order.
- **Double idempotency**: the stored status (Redis or Map), plus a Sapo lookup before every create. The lookup filters server-side with `?tag=vnpay-<txnRef>` and re-checks the tag (or `note_attributes.vnp_TxnRef`) on the returned rows, so a store that ignored `tag` still matches correctly from the recent-orders list. Survives restarts/other instances as long as the pending order is known. (Superseded 2026-10-07, T13.2: it now also asks for closed and cancelled orders; the next sentence describes the earlier open-only behaviour.) It sent no `status` filter, so it saw open orders only — enough for a VNPAY IPN retry (within ~50 min), but an order closed in Sapo before the retry would not be found (not verified against a live store: closing an order needs a write we did not make).
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

- **`npm test`** (Vitest 5.0.3, `vitest run`; needs Node ^22.12 or 24+, Vitest's own engine range, while the app itself still runs on ≥20.9), then `npm run typecheck`, `npm run lint`, `npm run build`.
  Eight files since T12, all under `lib/` (the list below predates `alert.test.ts`, described under "Order alerts", and `contact.test.ts` / `product.test.ts`, described under "Storefront UI (T12)"): `vnpay.test.ts` (GMT+7 dates, txnRef shape and uniqueness over 10,000 draws, `TXN_REF_PATTERN`, `normaliseTxnRef`, amount ×100, 15-minute expiry, a **known-answer** HMAC-SHA512 over a hand-written sign string so the algorithm and the URL encoding are pinned, checksum verify incl. a one-đồng tamper and a wrong secret, success needs both codes), `shipping.test.ts` (flat 30,000₫, free at exactly 500,000₫ and not at 499,999₫), `discount.test.ts` (`evaluateRule`: rounding, cap, fixed amount never above goods, every refusal; `quoteDiscount`: `T` and `TEST100` refused although the fuzzy `?query=` matched TEST10, `test10` answered as `TEST10`), `sapo.test.ts` (`buildOrderPayload`: lines − discount + shipping equals the total, discount sent as `fixed_amount`, VNPAY order `paid` with one transaction for the total, COD order `pending` with no transaction) and `order.test.ts` (what `startCheckout` signs equals goods + delivery priced from the catalog and equals `quoteTotals`; browser-sent prices dropped; discounts-off refuses a code; refusals; `handleIpn` answering `97`/`01`/`04`/`00`/`02`/`99`, exactly one Sapo create, and only one of two simultaneous IPNs winning).
  `order.test.ts` also covers `lookupOrder` since T11: lower-case reference, wrong phone == missing order, a malformed reference costs no try, 5 per hour per phone across IPs. **Verified 2026-10-07: 6 files, 81 tests pass** (75 before T11); typecheck, lint, build pass. No mutation check of the T11 tests has been run.
  **Verified 2026-10-07 after T12: 8 files, 90 tests pass**; typecheck, lint, build pass. The two new files, `contact.test.ts` and `product.test.ts`, cover the contact form and `isTestProduct`; no mutation check has been run on them either.
  **2026-10-08, T14 PR 6b (c8b5abb): 13 files, 229 tests pass; typecheck, lint, build pass** (local; details under "Transaction ledger").
  **2026-10-08, follow-up working tree (terminal check, log redaction, one-statement `ledgerRecordSapo`): 15 files, 239 tests pass; typecheck, lint, build pass** (local only). New files: `lib/catalog.test.ts` (unpriced and combo variants withheld, including a pinned `SAPO_VARIANT_ID`) and `lib/log.test.ts`.
  **2026-10-08, PR 6c working tree: 15 files, 253 tests pass; typecheck, lint, build pass** (local only; deferral tests on PGlite, see "Transaction ledger").
  **2026-10-07, after T14 PR 6 (a41c659): 13 files, 188 tests pass** (the ledger, sweep, querydr and idempotency tests among them, the ledger ones against a real in-process Postgres, PGlite); typecheck, lint and build pass. `reviewer` ran three rounds on PR 5/6 and each found real problems, all fixed with tests.
  **2026-10-07, T13 working tree: 10 files, 129 tests pass; typecheck, lint and build pass.** `reviewer` found no critical issue in two rounds and its should-fix items were applied. Mutation checks on the reconcile guards: removing the terminal/reference match and removing the 60 s wait each failed tests. New files: `lib/querydr.test.ts`, `lib/jsonld.test.ts`.
  Verified 2026-10-06: 5 files, 61 tests pass. **Mutation checks, same day, each reverted:** +1₫ on the delivery fee failed 10 tests; +1₫ on goods per line failed 8; signing with SHA-256 instead of SHA-512 failed 11; deleting the `store.put` after the Sapo order is created failed 2 (the repeat-IPN and retry tests). That is the evidence the suite catches an amount one đồng off and a lost status, which typecheck, lint and build do not.
  The tests mock the catalog, locations, the discount lookup, Sapo and the logger; the order store is the real in-memory one and the VNPAY signing is real. So they prove the arithmetic and the IPN state machine, **not** that Sapo or VNPAY accept what is sent — that still takes the live checks below.
- **CI** (`.github/workflows/ci.yml`) runs typecheck, lint, test and build on every pull request and every push to `main`. It was **added 2026-10-06 and has not run on GitHub yet**, so its first result is still unverified.
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
- **COD is disabled (2026-10-06), so the COD checks below cannot run** unless `COD_ENABLED` is set to
  `true` in `lib/product.ts` (revert before committing). Verified 2026-10-06 on `next dev`: `POST /api/checkout`
  with `"paymentMethod":"cod"` → 400 `{"fields":{"paymentMethod":"Cửa hàng hiện chỉ nhận thanh toán qua VNPAY"}}`;
  the same body with `"vnpay"` and an unknown variant → 409 (nothing created); `/checkout` HTML contains no "COD".
  A full VNPAY payment after this change **has since been run** (2026-10-06, T9 checklist item 9, order #1035:
  paid, IPN `00`, stock deducted — see "Variants (T9)"). Any further "real order" test must go through VNPAY or
  re-enable COD temporarily.
- **COD end to end, locally (only while `COD_ENABLED` is true):** POST the full checkout body with `"paymentMethod":"cod"`. It needs no VNPAY config and no tunnel, and it creates a **real** Sapo order immediately — the fastest way to check a payload change, and the way #1025 was verified. Delete that one order afterwards by its id.
- **Addresses:** `npm run check:locations` for the shape of Sapo's tables. The three gates worth
  re-testing after any change to `lib/locations.ts`, all of which must answer **400**: a ward that
  belongs to another district; a district that belongs to another province; and **a missing
  `districtId` for a province that still has districts** — that last one is the gate on the two-tier
  path, and losing it would let a forged request skip the containment check entirely.
- **Order lookup:** `/tra-cuu-don` with the reference and the phone number on the order. A wrong phone must answer exactly like an unknown reference; if it ever differs, the page has become an oracle.
- **COD limits (dormant while `COD_ENABLED` is false; the 400 refusal comes first, so these cannot be exercised):** the ceiling and both rate axes are testable with `curl` and without creating an
  order, which is the only reason they are worth testing often. The ceiling: a cart over 3,000,000₫
  with `"paymentMethod":"cod"` must answer **409** while the same cart on `"vnpay"` goes through
  (verified: a 4,000,000₫ cart refused for COD, signed for VNPAY). The phone axis: send the same
  phone with a different `x-forwarded-for` each time and a cart holding an **out-of-stock** variant —
  the rate check runs before the stock check, so the counter climbs while no order is ever created.
  Verified 2026-10-05: blocked on the attempt after the limit, from a different IP every time.
- **Refund:** `npm run refund -- <txnRef>` with no `--confirm` prints what it would send and sends
  nothing. Treat that as the test; a real refund cannot be undone.
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
the platform's log retention is the real deadline for this, not the order's Redis TTL (7 days since T13.5; it was 24 h when this recovery was verified).

The dev log is `.next/dev/logs/next-development.log`. Next 16 wraps our JSON inside its own
`message` field, so the escaping means the query must be recovered by parsing JSON twice
(`scripts/auto-ipn.mjs` `parseLine`); a regex over the raw line silently drops `vnp_Amount`
— the alphabetically first param — and the replay then fails the checksum with `97`.

## Refunding a payment

`npm run refund -- <txnRef> [amountVnd] [--confirm]`. **A dry run unless `--confirm` is passed**,
and that default is the whole design: a refund moves money out and VNPAY answers `94` ("đã được gửi
yêu cầu hoàn tiền trước đó") to a second attempt, so there is no undo and no retry. The dry run
prints the body, the checksum source string, and the order as Sapo holds it.

It reads `vnp_TransactionNo` and `vnp_PayDate` **out of the order's `note_attributes`** rather than
asking a person to copy them, so the refund is aimed at the transaction Sapo actually recorded. A
COD order is refused outright — no money ever went through VNPAY, so there is nothing to refund.

**Three traps, all in the signing:**

1. Not the payment URL's checksum — that sorts parameters by key and joins `key=value`; refund joins
   thirteen *values* with `|`.
2. Not `querydr`'s either, which joins nine. The three schemes look alike enough that one shared
   helper would eventually be "tidied" into a single wrong one, so each file signs its own.
3. **`vnp_OrderInfo` is last in the checksum but eighth in the body.** The signed order genuinely
   differs from the JSON order; following the body gives a well-formed request that answers `97`.

Signing order: `vnp_RequestId | vnp_Version | vnp_Command | vnp_TmnCode | vnp_TransactionType |
vnp_TxnRef | vnp_Amount | vnp_TransactionNo | vnp_TransactionDate | vnp_CreateBy | vnp_CreateDate |
vnp_IpAddr | vnp_OrderInfo`. `vnp_TransactionType` is `02` for a full refund, `03` for partial.

**It deliberately writes nothing to Sapo.** Recording the refund on the order would need
`POST /admin/orders/{id}/refunds.json`, which is plausible (the nested resource reads fine) but has
never been exercised here — and guessing at a write that moves money and stock is how a shop's books
get corrupted. The script prints the manual steps instead: record the refund on the order, restock
if the goods come back, and write the reason in the note.

Verified as a dry run on order #1028 (2026-10-05): it pulled `vnp_TransactionNo 15695202` and
`vnp_PayDate 20261005141539` from the order and built the 13-value string.

**First live refund, 2026-10-07 (sandbox, local `next dev`):** `npm run refund -- <ref> --confirm` on the
order #1041 payment answered `vnp_ResponseCode 00`, "Refund success", `vnp_TransactionType 02`,
`vnp_TransactionStatus 05`. The script wrote nothing to Sapo, as designed; the test order was then deleted
by id (HTTP 200). A `querydr` run right after got code `94` (duplicate within the API's time window), so
what `querydr` answers for a refunded transaction is **not known**. This is one full refund; a partial one
(`03`) and the other refund response codes are still from the docs only.

## Known MVP limitations

- **The in-memory fallback is still in-memory**: with no Redis env vars, `lib/store.ts` uses a Map, so pending orders are lost on restart and never shared between instances. That is fine for `next dev`/`next start` on one machine and wrong on Vercel, where the IPN may land on an instance that never saw the checkout and answer `01`. Configure Redis for any serverless deployment; the result page names which backend is in use when it cannot find an order.
- If an order is lost from memory, a paid VNPAY transaction cannot be turned into a Sapo order automatically; reconcile manually via VNPAY merchant portal. For orders created since the ledger existed (T14 PR 5) the sweep can recover them from Postgres; **orders from before that cannot be swept.**
- **The owner is told about a stuck paid order by email, but only once the alert env vars are set, and it is unverified end to end.** `lib/alert.ts` mails on `paid_no_order`, `amount_mismatch` and `sapo_failed`; with `RESEND_API_KEY` / `ALERT_EMAIL` unset it is off and only `alert.not_configured` is logged, which nobody reads. `ALERT_EMAIL` was set on Vercel by the owner on 2026-10-08, but **no alert mail has ever been sent**. A failed Sapo order is now retried by the sweep (QStash, every 5 minutes, bounded caps), but the sweep has not yet recovered a real one.
- **The ledger adds Neon latency to the IPN (T14).** Measured 2026-10-07 on production: 5.5 s, against about 2.4 s before, because the first Neon call after idle took about 2 s. The ledger can never block or change the answer (4 s cap per call, errors swallowed), but VNPAY waits for it. **PR 6b (deployed) puts a ledger write *before* the answer** (the transaction is capped at 4 s, then the pre-6b path runs). Measured 2026-10-08 on production (order #1043): IPN `durationMs` 7396, with `commit_paid` ~3.4 s on a cold Neon; a follow-up folds the Sapo-result write into one statement, and it cut the IPN to 5660 ms in a second payment (#1044, f239256, 2026-10-08), the rest being the cold-Neon commit (~2.6 s) and Sapo (~2.2 s). VNPAY did deliver the IPN and accept the `00`, but how long it waits is unknown. **PR 6c (built, uncommitted, not deployed) answers before the Sapo call**, so the IPN should take about the commit time (expected about 3 s); that is an expectation, not a measurement.
- **Production and Preview share one Postgres database**, so previews skip migrations and the QStash schedule targets production only; the Neon branch per preview is a later PR. Tests use PGlite for the same reason the credentials cannot be pulled to a laptop. Neon free-plan compute hours under a 5-minute poll: **unverified**.
- No inventory reservation, no CSRF token on `/api/checkout` (JSON-only POST). Refunds exist as a
  **script a person runs**, not an endpoint or a flow: `npm run refund` talks to VNPAY and leaves the
  Sapo side to a human; one live sandbox full refund has run (2026-10-07, see "Refunding a payment"). `npm run querydr` is a **read-only script** for a person; the server's own `querydr` (`lib/querydr.ts`) is what the result page and the sweep use, limited by the sandbox's one-per-5-minutes window (code `94`).
- **Email confirmation is a switch, not a feature.** `SAPO_SEND_RECEIPT=true` asks Sapo to send its own confirmation; whether Sapo actually delivers it for an API-created order is **unverified**, because finding out means sending a real email. If it does not, a mail provider of our own is needed, which is outside this project (credentials, a verified sending domain, a choice of service).
- **`once_per_customer` on a discount rule cannot be enforced.** There are no customer accounts, so a code marked once-per-customer is accepted and logged (`discount.once_per_customer_unenforced`) rather than refused. The exposure is one extra discount per reuse and it is visible in Sapo; refusing every such code would be worse.
- **A discount rule whose conditions we cannot evaluate is refused outright** — entitled products/variants/collections/provinces, customer groups, saved searches, locations, buy-X-get-Y ratios, a non-`all` customer selection, or a shipping-target rule. The customer is told the code has a condition the site cannot apply. Honouring the parts we understand would charge a discount the shop never offered.
- **The delivery fee is a flat table, not a carrier quote.** `GET /admin/shipping_zones.json` answers `access_denied` even with the order + shipping scope on, so Sapo's own zones are unreachable by a private app. The three zones and the free-shipping threshold in `lib/shipping.ts` are placeholders with a defensible shape; **they are the shop's numbers to set.**
- **The province list is Sapo's 63-province set**, which predates Vietnam's 2025 mergers. That is deliberate: an order is only useful if Sapo accepts the address on it, so the lists the customer picks from have to be the lists Sapo knows. A customer can therefore pick a unit that no longer exists in law (`Quận 1`, `Phường Đa Kao`), and the order records it; couriers still accept the old names through the transition.
- **Nothing checks the free-text street line against the three levels chosen.** A customer can select Bà Rịa-Vũng Tàu correctly and type "63 Đinh Tiên Hoàng, Quận 1" into the address field; the order is accepted and the delivery fee charged is Vũng Tàu's. The cross-level combination is impossible (two layers refuse it) but a contradictory *street* is not detectable without an address-validation or geocoding service — which is why a COD order should be confirmed by phone. Same for a wrong-but-consistent address: the fee follows the province chosen, so the shop absorbs the difference if the real destination is in another zone.
- **COD is switched off (2026-10-06), so the COD bullets in this section (cap, rate limits, double submit) are dormant** — they describe code that
  is kept, not behaviour customers can reach. Setting `COD_ENABLED` to `true` restores it with nothing else to change.
- **COD is capped at `MAX_COD_TOTAL_VND` (3,000,000₫ in `lib/product.ts`)** and carries two rate
  limits the card path does not: 3 per IP per 10 minutes, and 5 per phone number per hour. The
  asymmetry is deliberate — card spam costs the spammer before it costs the shop, while a COD request
  creates a real order and moves real stock for free. The phone axis is **COD only**, so a customer
  whose card keeps failing is never locked out for retrying. Above the ceiling the form disables COD
  and says why, and the server refuses it regardless. Like the delivery fees, **the ceiling is the
  shop's number.**
- **A rejected COD attempt still spends a rate-limit hit**, because the counter runs before the cart
  is priced. That is the point — probing must not be free — but it means a customer refused for stock
  reasons has fewer tries left.
- **Combo products are withheld from the storefront** (`lib/catalog.ts` `isSellable`) because selling
  one moves no stock. The read path was always correct — Sapo reports the derived availability — it
  is the write path that does nothing.
- **Combo products, if that filter is removed, do not move stock** — see the Sapo section and
  `docs/plan/T8-combo-ton-kho.md`. The storefront shows the correct availability; the order simply
  never deducts it. This is an active book-keeping error, not a future risk.
- **A double-submitted COD checkout makes two orders**, because each submit draws its own reference. The button disables on submit and the rate limit bounds the damage. (T13.4 added an `Idempotency-Key` to `startCheckoutOnce`, which covers the VNPAY checkout; not checked against the COD path.)
- **The unit tests cover `lib/vnpay.ts`, `lib/shipping.ts`, `lib/discount.ts` (`evaluateRule`), `lib/order.ts` (checkout totals, quote, IPN, order lookup) `lib/alert.ts` (dedupe, no-throw, mail content, with `fetch` mocked), `lib/contact.ts` (validation, header-injection-safe subject, no personal data logged) and `isTestProduct` in `lib/product.ts` only.** Nothing tests `lib/sapo.ts` (the payload and the lookups), `lib/store.ts` against Redis, the route handlers, the UI or the scripts, so those rely on the live checks under "Test".
- **A paid order no longer depends on someone opening `/success`, but this is untested on a real loss.** The sweep (QStash every 5 minutes) asks VNPAY about orders still pending between 1 minute and 2 hours old, ordered by the signed-return hint, least-asked, then newest. Limits: orders from before the ledger; one `querydr` per 5 minutes per terminal in the sandbox (production VNPAY unknown), so several simultaneous losses clear about one per 5 minutes; an order the sweep gives up on mails the owner only if alerts are configured (they are not yet). The fallback is still a manual `npm run querydr` + `replay-ipn`.
- Rate limiting is per IP in the shared store and **fails open**: a store outage lets requests through rather than stopping the shop from selling.
- Sizes (T9) are one option at most in the URL, and each size is its own variant with its own stock — see "Variants (T9)" for what that does and does not cover. Max 10 per line, max 20 lines.
- **The consent checkbox at checkout is a UI gate, not a record.** `#agree-policies` in `components/CheckoutForm.tsx` (required, links to the four policies) keeps the pay button disabled until ticked. It is **not sent to the server and not stored**, so it is not proof that a customer agreed, and a direct `POST /api/checkout` ignores it. Verified in a browser 2026-10-06: with a complete address the button is disabled until ticked and disabled again when unticked; the request body and the money path are unchanged. If proof of consent is ever needed, it has to travel with the request and be stored with the order.
- **Policy text (`lib/policies.ts`) is the shop owner's old text, patched only where it was false for this shop, and nobody qualified has reviewed it.** Patched (2026-10-06): payment is VNPAY only, with the COD sentence following `COD_ENABLED`; the delivery fee and free-delivery line are computed from `lib/shipping.ts` across one province per zone (a range if the zones ever differ); no customer accounts; the order-lookup page is mentioned; Zalo replaced by Facebook/email. Money is written with `formatVnd` (`₫500,000`). **Left as the owner wrote it, and flagged in the file header:** delivery times and carriers, a Covid mention, the old domain `thehourtea.com`, (the data-retention promise was changed to 90 days on 2026-10-07 and the purge cron implements it; see "Transaction ledger"), and a returns text that says there are no refunds beside a promise to refund an order that never arrived, and that excludes discounted goods from exchange. Treat these pages as a draft for the owner and a lawyer to read, not as settled terms.
- **The order lookup's phone counter can be used to lock a customer out (T11, accepted).** `lookupPhone` allows 5 tries per hour per phone (keyed by the last 9 digits), counted only for a well-formed reference. Someone who knows a victim's number and can produce any reference-shaped string can spend that number's 5 tries and block the real customer's lookup for an hour. Accepted because the alternative (no per-phone limit) lets a rotating-IP attacker guess; the order itself is not exposed.
- **Whether Sapo keeps a tag's letter case is NOT known (T11).** New references contain capitals and customers may type lower case, so `matchesRef` (`lib/sapo.ts`) compares the `vnpay-<ref>` tag case-insensitively, and the lookup upper-cases input first. Not verified: the stored case of the tag, an old-format reference through the new lookup against live Sapo (unit-tested only), and the Sapo-side duplicate guard on a repeat IPN (the repeat answered `02` from the stored status). Seen 2026-10-07: the first lookup seconds after an order was created answered not-found and the same lookup a few seconds later found it (Sapo tag index delay, cause not investigated).
- **Contact form (T12) is built but unverified end to end.** `/lien-he` draws it only when `CONTACT_EMAIL` (older `CONTACT_EMAIL_TO`) is set — **set on Vercel by the owner on 2026-10-08, so the form is on in production** — because a form that goes nowhere is worse than none; unset, `/api/contact` answers 404 and the page shows contact details only (verified 2026-10-07). Measured 2026-10-08 on production: `POST /api/contact` at 05:03:33Z answered 200 `{ok:true}` and `contact.sent` was logged at 05:03:34Z, so Resend accepted the payload including `reply_to`; **that the mail reached the inbox is not confirmed by the owner**, and the code does not log Resend's message id. The newsletter form in the design is **not built** (no service chosen).
- **T12 limitations (2026-10-07).** Photographs are not in the repo: hero, partner logos, founder portrait and the product-story images are grey placeholder boxes (`--color-placeholder*`, `--color-hero-*`). **Mobile (390px) was NOT verified visually** — the headless browser available had a minimum window width, so only 1440px was looked at (home, `/shop`, product page, `/checkout`, footer). **Test products are recognised by name only, and only for search engines:** `isTestProduct(name)` (`lib/product.ts`) is true when the name starts with the word "test", case-insensitive; such a product is listed and sold like any other (the shop mirrors Sapo), but left out of the sitemap and marked `noindex`. "TEST-…" or "[TEST] …" would not be recognised. The live store has one real product ("Hồng Trà Shan Tuyết 60g") beside test ones. **`/collections/*` is not built (T12.6):** Sapo's `custom_collections`, `smart_collections`, `collects` and `collections` endpoints all answered 200 with **empty** lists on this store (read-only, 2026-10-07), so there is nothing to build or verify against until the shop creates a collection. **Design copy kept that makes promises nobody has confirmed**, for the owner to check (the "3 vị trà mới" block and the named testimonial were hidden/removed on 2026-10-07): the "Giá hời bất ngờ" promo, and "hoàn toàn không sử dụng phân bón hay thuốc bảo vệ thực vật".

## Next steps (not in MVP)

1. ~~Persistent store replacing the Map~~ — done, see `lib/store.ts`. Remaining: reconcile orders whose Redis record expired (7-day TTL since T13.5); the Postgres ledger now holds them, but nothing reads the ledger except the sweep and the purge. Next in T14: PR 6b is deployed and checked with one real sandbox payment on 2026-10-08; PR 6c (answer VNPAY before the Sapo call) is built but not committed or deployed; then reading from Postgres, then PR 7–10.
2. ~~VNPAY `querydr` reconciliation~~ — done as a read-only script (`npm run querydr`). The automatic job now exists (the sweep, T14 PR 6, with the ledger as the index of pending references); it has not recovered a real lost IPN yet.
3. ~~Read real products from Sapo~~ — done (`fetchCatalogEntries`). The variant picker is in too (T9, implemented; real order of a non-first size verified via VNPAY 2026-10-06). (Product images **are** present on the live store — all four products return one each; an earlier note here claiming otherwise was stale.)
4. ~~Composable product descriptions from a CMS~~ — done (T1, `docs/plan/T1-product-content.md`), and so is the Sanity webhook → `/api/revalidate` (see "Staying on Sanity's free plan").
5. Blog on Sanity — planned in `docs/plan/T2-blog.md`, reuses the same block array and `BlockRenderer`.
6. **T8 — combo stock** (`docs/plan/T8-combo-ton-kho.md`). Blocked on one 10-minute check in the Sapo admin that splits "the API path cannot expand a combo" from "Sapo does not track combo components at all".
7. T7 remainders, in the order they bite: ~~a variant picker~~ (done, T9 — real order of a non-first size verified 2026-10-06); **combo** as cách A (create the combo as its own Sapo product — no code at all, it flows through the existing path); an **email of our own** if Sapo's receipt turns out not to send; and **restocking a cancelled COD order**, which today is a human in the Sapo admin.
7. Re-skin the whole project to the reference design — planned in `docs/plan/T3-ui-redesign.md`. The token layer (T0) is already in. Open question recorded in `design/TOKENS.md`: the reference's cart is an in-page popup while this project has a `/checkout` route.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
