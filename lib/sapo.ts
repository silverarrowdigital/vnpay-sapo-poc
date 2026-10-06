/**
 * Sapo Admin API client — server-side only.
 *
 * Verified against Sapo's official developer docs (support.sapo.vn):
 *   - Private apps authenticate with HTTP Basic auth using the app's API Key and API Secret
 *     (https://support.sapo.vn/ung-dung-rieng-private-apps). We send it as an Authorization
 *     header, equivalent to the documented https://key:secret@store/admin/... form.
 *   - Create order:  POST /admin/orders.json   body: { "order": { ... } }
 *     (https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2)
 *   - List orders:   GET  /admin/orders.json?status=any&created_on_min=...&fields=...
 *     (https://support.sapo.vn/phuong-thuc-get-cua-order-phan-1)
 *   - Order attributes (financial_status, note_attributes, tags):
 *     https://support.sapo.vn/cac-thuoc-tinh-cua-order-api
 *     source_name is deliberately NOT sent — see buildOrderPayload.
 */
import type { SapoConfig } from "./config";

export class SapoApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "SapoApiError";
  }
}

/** Raw shape of the bits of /admin/products.json we use. */
interface SapoVariant {
  id: number;
  /** "normal" | "combo" (observed live). A combo is assembled from other variants. */
  type?: string | null;
  /** True on a combo variant: it has no stock of its own, only its components'. */
  requires_components?: boolean | null;
  sku?: string | null;
  price?: number | string | null;
  compare_at_price?: number | string | null;
  inventory_quantity?: number | null;
  unit?: string | null;
  image_id?: number | null;
  /** 1-based order within the product; variants are listed in this order. */
  position?: number | null;
  /** The variant's value on each of the product's (up to three) options, e.g. "200g ~ 66 Servings". */
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}
interface SapoProduct {
  id: number;
  /** Option definitions, e.g. `[{name: "Size", values: [...]}]`. Verified on a live product 2026-10-06. */
  options?: { name?: string | null }[] | null;
  name?: string | null;
  content?: string | null;
  /** URL slug Sapo generates from the name, e.g. "test-product-1". Sapo's equivalent of a handle. */
  alias?: string | null;
  /**
   * "active" | "draft" (observed on a live store). Note `published_on` is a separate field and is
   * null even on the product this PoC has been selling all along, so it is not used as a filter.
   */
  status?: string | null;
  variants?: SapoVariant[] | null;
  images?: { id: number; src?: string | null }[] | null;
  image?: { src?: string | null } | null;
}

/** Sapo returns prices as numbers or numeric strings depending on the endpoint. */
function toVnd(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? NaN);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Sapo's product description is HTML; the UI renders plain text, so strip it here. */
function htmlToText(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

export interface SapoCatalogEntry {
  productId: number;
  variantId: number;
  /** Sapo's URL slug, absent if the store never generated one. */
  alias?: string;
  name: string;
  sku: string;
  priceVnd: number;
  compareAtPriceVnd?: number;
  stock: number;
  unit?: string;
  description?: string;
  imageUrl?: string;
  /**
   * A combo: a variant assembled from other variants (`type: "combo"`,
   * `requires_components: true`). Carried through because **selling one deducts nothing** —
   * its stock is derived from its components and `POST /admin/orders.json` does not expand it,
   * so an order for a combo takes money and leaves the shop's stock untouched. See
   * docs/plan/T8-combo-ton-kho.md. Until that is solved, `lib/catalog.ts` keeps combos out of
   * the catalog entirely.
   */
  requiresComponents: boolean;
  /**
   * What the customer picks between, e.g. "200g ~ 66 Servings" (several options joined with " / ").
   * **Absent for a product with a single variant**: Sapo then names it "Default Title", which must
   * never be shown to a customer.
   */
  variantLabel?: string;
  /**
   * The option's name ("Size"), set only when the product has exactly one option. It is the query
   * parameter that selects a variant on the product page (`?Size=…`); with several options there is
   * no single name, and the page falls back to `?variant=<id>`.
   */
  optionName?: string;
}

/** Sapo's placeholder for a product that was never given real options. */
const DEFAULT_OPTION = "default title";

function variantLabelOf(variant: SapoVariant): string | undefined {
  const parts = [variant.option1, variant.option2, variant.option3]
    .map((o) => (o ?? "").trim())
    .filter((o) => o !== "" && o.toLowerCase() !== DEFAULT_OPTION);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function optionNameOf(product: SapoProduct): string | undefined {
  const options = product.options ?? [];
  const name = options.length === 1 ? (options[0].name ?? "").trim() : "";
  // The name becomes a query-string key, so refuse anything that would need escaping to be one.
  return /^[A-Za-z][A-Za-z0-9_-]{0,29}$/.test(name) ? name : undefined;
}

/**
 * Map one Sapo product + variant to a catalog entry. Price, stock, sku and unit all live on the
 * **variant**, not the product — that is why a cart line is keyed by variantId.
 */
function toCatalogEntry(product: SapoProduct, variant: SapoVariant): SapoCatalogEntry {
  const price = toVnd(variant.price);
  const compare = toVnd(variant.compare_at_price);
  const image =
    product.images?.find((i) => i.id === variant.image_id)?.src ?? product.image?.src ?? product.images?.[0]?.src;
  return {
    productId: product.id,
    variantId: variant.id,
    alias: product.alias?.trim() || undefined,
    name: product.name?.trim() || `Variant ${variant.id}`,
    sku: (variant.sku ?? "").trim(),
    priceVnd: price,
    compareAtPriceVnd: compare > price ? compare : undefined,
    stock: typeof variant.inventory_quantity === "number" ? variant.inventory_quantity : 0,
    unit: variant.unit?.trim() || undefined,
    description: htmlToText(product.content),
    imageUrl: image ?? undefined,
    requiresComponents: variant.requires_components === true || (variant.type ?? "").toLowerCase() === "combo",
    variantLabel: variantLabelOf(variant),
    optionName: optionNameOf(product),
  };
}

/** Sapo orders variants by `position`; a missing position sorts last rather than first. */
function variantsByPosition(product: SapoProduct): SapoVariant[] {
  const variants = (product.variants ?? []).filter((v) => typeof v.id === "number");
  return [...variants].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Read the catalog entry for cfg.variantId. Sapo has no documented
 * GET /admin/variants/{id}.json for private apps, so we list products and pick the variant —
 * fine for this PoC's single-product catalog.
 */
export async function fetchCatalogEntry(cfg: SapoConfig, variantId: number): Promise<SapoCatalogEntry> {
  const data = (await sapoFetch(cfg, "/admin/products.json?limit=250")) as { products?: SapoProduct[] };
  for (const product of data.products ?? []) {
    for (const variant of product.variants ?? []) {
      if (variant.id !== variantId) continue;
      return toCatalogEntry(product, variant);
    }
  }
  throw new SapoApiError(`No Sapo variant with id ${variantId} (check SAPO_VARIANT_ID)`);
}

/**
 * Every variant of every active product, flat, in Sapo's order (products as listed, each one's
 * variants by position). A product with no variant contributes nothing, and only
 * `status === "active"` is listed, so a draft never reaches the storefront.
 *
 * Flat on purpose: a cart line is keyed by variantId, so pricing needs to find *any* variant, not
 * just a product's first. `lib/catalog.ts` groups these back into products for display.
 */
export async function fetchCatalogEntries(cfg: SapoConfig): Promise<SapoCatalogEntry[]> {
  const data = (await sapoFetch(cfg, "/admin/products.json?limit=250")) as { products?: SapoProduct[] };
  const entries: SapoCatalogEntry[] = [];
  for (const product of data.products ?? []) {
    if ((product.status ?? "active").trim().toLowerCase() !== "active") continue;
    for (const variant of variantsByPosition(product)) entries.push(toCatalogEntry(product, variant));
  }
  return entries;
}

/** How the order was paid. COD is the only one that creates an order before money arrives. */
export type PaymentMethod = "vnpay" | "cod";

/**
 * A delivery address, split the way Vietnam addresses are and Sapo stores them.
 *
 * Field names verified against a live order (2026-10-05): every `shipping_address` and
 * `billing_address` on the store carries `province`, `province_code`, `district`, `district_code`,
 * `ward`, `ward_code` alongside `address1`. **Sapo's own docs do not list `district` or `ward`** —
 * https://support.sapo.vn/cac-thuoc-tinh-cua-order-api stops at `province`/`province_code` — so
 * these four are taken from what the live API itself returns on every order, not invented here.
 */
export interface SapoAddressParts {
  /** House number and street — what the customer types. */
  address1: string;
  ward?: string;
  wardCode?: string;
  district?: string;
  districtCode?: string;
  province?: string;
  provinceCode?: string;
}

export interface SapoCustomerInput extends SapoAddressParts {
  name: string;
  phone: string;
  email: string;
}

export interface SapoOrderInput {
  txnRef: string;
  method: PaymentMethod;
  /** VNPAY's own references. Absent for COD, where no payment has happened yet. */
  vnpTransactionNo?: string;
  vnpBankCode?: string;
  vnpPayDate?: string;
  customer: SapoCustomerInput;
  lines: SapoOrderLine[];
  /** Delivery, priced by lib/shipping.ts. Sent as a Sapo `shipping_line`. */
  shipping?: { title: string; code: string; priceVnd: number };
  /** A verified discount. The amount is always the server's own computation. */
  discount?: { code: string; amountVnd: number };
  /** What the customer pays in total: goods − discount + shipping. */
  totalVnd: number;
}

/**
 * One line to create. Structurally the same as a stored order line; declared here so this module
 * stays independent of lib/store.ts, which imports it.
 */
export interface SapoOrderLine {
  /** Sapo variant id. Without one the line is created as a custom item and moves no stock. */
  variantId?: number;
  sku: string;
  productName: string;
  /** Size/option label; only used to title a custom line, since a variant-linked line gets it from Sapo. */
  variantLabel?: string;
  unitPriceVnd: number;
  quantity: number;
}

export interface SapoOrderRef {
  id: number;
  name: string;
}

const TIMEOUT_MS = 15_000;

function authHeader(cfg: SapoConfig): string {
  return "Basic " + Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`, "utf-8").toString("base64");
}

async function sapoFetch(cfg: SapoConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  const url = `https://${cfg.storeDomain}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(cfg),
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new SapoApiError(`Network error calling Sapo ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    // Body is logged by the caller (truncated); never includes our credentials.
    throw new SapoApiError(`Sapo ${init.method ?? "GET"} ${path} failed with HTTP ${res.status}`, res.status, text.slice(0, 1000));
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new SapoApiError(`Sapo ${path} returned non-JSON response`, res.status, text.slice(0, 500));
  }
}

/**
 * Read-only Sapo GET, exported for the modules that only ever read: `lib/locations.ts` (the
 * administrative-division tables) and `lib/discount.ts` (price rules). They get the same auth,
 * timeout and error shape as every other call rather than each building their own fetch.
 */
export async function sapoGet(cfg: SapoConfig, path: string): Promise<unknown> {
  return sapoFetch(cfg, path);
}

/**
 * Tag used to find an order again by its payment reference (idempotency across restarts and
 * instances). VNPAY orders keep the `vnpay-` prefix they have always had — existing orders are
 * found by it — and COD gets its own, so the two payment paths can never match each other's order.
 */
export function txnTag(txnRef: string, method: PaymentMethod = "vnpay"): string {
  return `${method}-${txnRef}`;
}

/** "Nguyễn Văn An" → last_name "Nguyễn Văn", first_name "An" (Vietnamese given name comes last). */
function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[parts.length - 1], last_name: parts.slice(0, -1).join(" ") };
}

export function buildOrderPayload(cfg: SapoConfig, input: SapoOrderInput) {
  const { first_name, last_name } = splitName(input.customer.name);
  const c = input.customer;
  const address = {
    first_name,
    last_name,
    name: input.customer.name,
    phone: input.customer.phone,
    address1: c.address1,
    country: "Vietnam",
    // Only send a level the customer actually chose. An explicit null would overwrite nothing,
    // but it also tells a courier integration "there is no district", which is worse than absent.
    ...(c.ward !== undefined ? { ward: c.ward } : {}),
    ...(c.wardCode !== undefined ? { ward_code: c.wardCode } : {}),
    ...(c.district !== undefined ? { district: c.district } : {}),
    ...(c.districtCode !== undefined ? { district_code: c.districtCode } : {}),
    ...(c.province !== undefined ? { province: c.province } : {}),
    ...(c.provinceCode !== undefined ? { province_code: c.provinceCode } : {}),
    // Sapo has a separate `city` field that the live store leaves null on every order; the
    // province is the city for Hà Nội / TP HCM, so there is nothing distinct to put in it.
  };

  // A line's own variantId wins; cfg.variantId is the fallback that keeps a legacy single-line
  // record (written before carts existed) linked to the variant it was bought from.
  const resolved = input.lines.map((line) => ({ line, variantId: line.variantId ?? cfg.variantId }));
  const lineItems = resolved.map(({ line, variantId }) =>
    variantId !== undefined
      ? { variant_id: variantId, quantity: line.quantity, price: line.unitPriceVnd }
      : {
          title: line.variantLabel !== undefined ? `${line.productName} - ${line.variantLabel}` : line.productName,
          sku: line.sku,
          price: line.unitPriceVnd,
          quantity: line.quantity,
        },
  );
  const anyVariantLinked = resolved.some(({ variantId }) => variantId !== undefined);

  const paid = input.method === "vnpay";

  return {
    order: {
      email: input.customer.email,
      phone: input.customer.phone,
      line_items: lineItems,
      customer: { first_name, last_name, email: input.customer.email, phone: input.customer.phone },
      billing_address: address,
      shipping_address: address,
      // Delivery as its own line, so the shop's books show goods and shipping separately and the
      // total Sapo computes is the total VNPAY charged. Field names from the docs:
      // https://support.sapo.vn/cac-thuoc-tinh-cua-order-api — code, price, source, title.
      ...(input.shipping !== undefined
        ? {
            shipping_lines: [
              {
                title: input.shipping.title,
                code: input.shipping.code,
                price: input.shipping.priceVnd,
                source: "vnpay-sapo-poc",
              },
            ],
          }
        : {}),
      // The discount is sent as the **amount we actually charged**, as a fixed_amount, even for a
      // percentage rule. Sending "percentage" would ask Sapo to recompute it, and a rounding
      // difference of one đồng between Sapo's arithmetic and ours would put the order total out of
      // step with the money VNPAY took. Our number is the one the customer paid, so our number is
      // the one recorded. Documented types: percentage | shipping | fixed_amount (default).
      ...(input.discount !== undefined
        ? { discount_codes: [{ code: input.discount.code, amount: input.discount.amountVnd, type: "fixed_amount" }] }
        : {}),
      // COD is "pending" — documented value, "Việc thanh toán đang tạm hoãn". The money has not
      // arrived, so saying "paid" here would be a false entry in the shop's books.
      financial_status: paid ? "paid" : "pending",
      // No transaction for COD: nothing has been captured. Sapo derives the order's top-level
      // `gateway` from this array, so a COD order carries no gateway, and its payment method is
      // recorded in the note, the note_attributes and the tags instead.
      ...(paid ? { transactions: [{ kind: "sale", status: "success", amount: input.totalVnd, gateway: "VNPAY" }] } : {}),
      note: paid
        ? `Paid via VNPAY Sandbox. TxnRef ${input.txnRef}, VNPAY TransactionNo ${input.vnpTransactionNo ?? ""}.`
        : `Thanh toán khi nhận hàng (COD). Mã đơn ${input.txnRef}. CHƯA thu tiền.`,
      note_attributes: [
        { name: "payment_method", value: input.method },
        { name: "order_ref", value: input.txnRef },
        ...(paid
          ? [
              { name: "vnp_TxnRef", value: input.txnRef },
              { name: "vnp_TransactionNo", value: input.vnpTransactionNo ?? "" },
              { name: "vnp_BankCode", value: input.vnpBankCode ?? "" },
              { name: "vnp_PayDate", value: input.vnpPayDate ?? "" },
            ]
          : []),
        { name: "sku", value: input.lines.map((l) => l.sku).join(", ") },
        ...(input.shipping !== undefined
          ? [{ name: "shipping_fee_vnd", value: String(input.shipping.priceVnd) }]
          : []),
        ...(input.discount !== undefined
          ? [
              { name: "discount_code", value: input.discount.code },
              { name: "discount_vnd", value: String(input.discount.amountVnd) },
            ]
          : []),
        { name: "amount_vnd", value: String(input.totalVnd) },
      ],
      tags: `headless-poc, ${input.method}, ${txnTag(input.txnRef, input.method)}`,
      // Stock movement. Without this field Sapo defaults to "bypass" and never touches stock
      // (https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2). Only meaningful when the
      // line is linked to a real variant — a custom line item has nothing to deduct.
      //
      // "decrement_ignoring_policy" is deliberate over "decrement_obeying_policy": we only get
      // here after the payment is already verified, so a refusal for being out of stock would
      // leave money taken and no order (IPN 99 → VNPAY retries → still fails). This always
      // succeeds and may drive stock negative; that is an ops problem, not a payment one.
      ...(anyVariantLinked ? { inventory_behaviour: "decrement_ignoring_policy" } : {}),
      // No source_name: Sapo reserves values like "web"/"pos" for its own channels and rejects
      // a private app that sets one (HTTP 422 "cannot be set to a protected value by an
      // untrusted API client"). The order is identified by its tags and note_attributes instead.
      // Sapo's own order-confirmation email, off unless the shop asked for it (SAPO_SEND_RECEIPT).
      // Until T7.6 this was hardcoded false, which meant a customer who closed the tab had nothing
      // at all; it is now a switch the shop owns. The fulfilment notice stays off — that one
      // belongs to whoever actually ships the parcel.
      send_receipt: cfg.sendReceipt,
      send_fulfillment_receipt: false,
    },
  };
}

interface OrderListItem {
  id: number;
  name?: string;
  tags?: string;
  note_attributes?: { name: string; value: string }[];
}

/** Look for an order already created for this reference in the last 3 days. */
export async function findOrderByTxnRef(
  cfg: SapoConfig,
  txnRef: string,
  method: PaymentMethod = "vnpay",
): Promise<SapoOrderRef | null> {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const createdMin = since.toISOString().slice(0, 16).replace("T", " "); // "YYYY-MM-DD HH:mm"
  // Filter server-side on the singular "tag" parameter: verified against a live store to match
  // the whole tag exactly (a prefix of the tag returns nothing). The plural "tags" is silently
  // ignored and returns every order, so it must not be used here.
  //
  // No "status" filter either: Shopify's "status=any" is not valid on Sapo and matches nothing
  // (HTTP 200 with an empty list), which silently disabled this whole guard. Sapo's default
  // listing covers open orders — what a VNPAY IPN retry (within ~50 min) is looking for.
  //
  // created_on_min and the exact re-check below stay as a fallback: on a store that ignored
  // "tag" we would get a plain recent-orders list and still match correctly, just less cheaply.
  const tag = txnTag(txnRef, method);
  const qs = new URLSearchParams({
    tag,
    limit: "250",
    created_on_min: createdMin,
    fields: "id,name,tags,note_attributes",
  });
  const data = (await sapoFetch(cfg, `/admin/orders.json?${qs.toString()}`)) as { orders?: OrderListItem[] };
  const match = (data.orders ?? []).find((o) => matchesRef(o, txnRef, tag));
  return match ? { id: match.id, name: match.name ?? `#${match.id}` } : null;
}

/**
 * Does this listed order belong to our reference? The tag is checked whole, and the
 * note_attributes are the fallback for a store that ignored the `tag` filter.
 *
 * `order_ref` is the attribute both payment paths write; `vnp_TxnRef` is kept because every order
 * created before COD existed carries that one and nothing else.
 */
function matchesRef(o: OrderListItem, txnRef: string, tag: string): boolean {
  if ((o.tags ?? "").split(",").map((t) => t.trim()).includes(tag)) return true;
  return (o.note_attributes ?? []).some(
    (a) => (a.name === "order_ref" || a.name === "vnp_TxnRef") && a.value === txnRef,
  );
}

export async function createOrder(cfg: SapoConfig, input: SapoOrderInput): Promise<SapoOrderRef> {
  const payload = buildOrderPayload(cfg, input);
  const data = (await sapoFetch(cfg, "/admin/orders.json", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { order?: { id?: number; name?: string } };
  if (!data.order?.id) throw new SapoApiError("Sapo returned no order id", undefined, JSON.stringify(data).slice(0, 500));
  return { id: data.order.id, name: data.order.name ?? `#${data.order.id}` };
}

/** Idempotent create: reuse an existing Sapo order for this reference if one exists. */
export async function createOrderOnce(
  cfg: SapoConfig,
  input: SapoOrderInput,
): Promise<{ order: SapoOrderRef; created: boolean }> {
  const existing = await findOrderByTxnRef(cfg, input.txnRef, input.method);
  if (existing) return { order: existing, created: false };
  return { order: await createOrder(cfg, input), created: true };
}

/**
 * What the customer-facing order lookup shows (T7.6). Read from the **list** endpoint, because
 * `GET /admin/orders/{id}.json` returns no `line_items` on this store.
 */
export interface SapoOrderDetail extends SapoOrderRef {
  createdOn?: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  status?: string;
  totalVnd: number;
  shippingVnd: number;
  discountVnd: number;
  /** Digits only, for comparing against what the person looking up the order typed. */
  phoneDigits: string;
  /** `variantTitle` is Sapo's `variant_title`; absent for a single-variant product ("Default Title"). */
  lines: { title: string; variantTitle?: string; sku?: string; quantity: number; priceVnd: number }[];
  address?: {
    address1?: string;
    ward?: string;
    district?: string;
    province?: string;
  };
}

interface OrderDetailRow extends OrderListItem {
  created_on?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  status?: string;
  phone?: string | null;
  total_price?: number | string | null;
  total_shipping_price?: number | string | null;
  total_discounts?: number | string | null;
  line_items?: {
    title?: string;
    name?: string;
    variant_title?: string | null;
    sku?: string | null;
    quantity?: number;
    price?: number | string;
  }[];
  shipping_address?: {
    address1?: string | null;
    ward?: string | null;
    district?: string | null;
    province?: string | null;
    phone?: string | null;
  } | null;
}

/** A line's size, or `undefined` for Sapo's "Default Title" placeholder, which is never shown. */
function lineVariantTitle(raw: string | null | undefined): string | undefined {
  const t = (raw ?? "").trim();
  return t === "" || t.toLowerCase() === DEFAULT_OPTION ? undefined : t;
}

/** Keep only digits, so "+84 912 345 678" and "0912345678" compare equal on their last 9. */
function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D+/g, "");
}

/**
 * The order for a reference, with enough detail to show the customer. Tries both payment paths'
 * tags, so one reference finds its order whether it was paid by VNPAY or placed as COD.
 *
 * Deliberately does **not** check who is asking: the caller does that, by comparing the phone
 * number. Keeping the two apart means this function stays a plain read and the access rule lives
 * in one place (`lib/order.ts` `lookupOrder`).
 */
export async function fetchOrderDetailByRef(cfg: SapoConfig, txnRef: string): Promise<SapoOrderDetail | null> {
  const methods = ["vnpay", "cod"] as const;

  // **Both tags are queried in parallel, always, and neither short-circuits the other.** Asking in
  // sequence and stopping at the first hit made the work depend on the answer: a reference that
  // exists as a VNPAY order cost one Sapo request, a reference that exists at all cost two. That is
  // a timing oracle on top of the one `lookupOrder` is careful to close — it would let a caller
  // tell "no such order" from "wrong phone number" by the clock rather than by the message. Doing
  // both every time makes the cost the same whatever the outcome, and is faster for a COD order.
  const settled = await Promise.allSettled(
    methods.map((method) => {
      const tag = txnTag(txnRef, method);
      const qs = new URLSearchParams({ tag, limit: "50", fields: "id,name,tags,note_attributes" });
      return sapoFetch(cfg, `/admin/orders.json?${qs.toString()}`) as Promise<{ orders?: OrderDetailRow[] }>;
    }),
  );

  let row: OrderDetailRow | undefined;
  for (const [i, result] of settled.entries()) {
    if (result.status !== "fulfilled") continue;
    const tag = txnTag(txnRef, methods[i]);
    const hit = (result.value.orders ?? []).find((o) => matchesRef(o, txnRef, tag));
    if (hit !== undefined) {
      row = hit;
      break; // methods order decides, so the answer does not depend on which request returned first
    }
  }

  if (row === undefined) {
    // Nothing matched. If a request *failed*, we did not actually look everywhere, and "no such
    // order" would be a lie told to a customer whose order exists — so raise instead, and let the
    // route answer "could not look up" rather than "not found".
    const failure = settled.find((r) => r.status === "rejected");
    if (failure !== undefined) throw (failure as PromiseRejectedResult).reason;
    return null;
  }

  return {
    id: row.id,
    name: row.name ?? `#${row.id}`,
    createdOn: row.created_on,
    financialStatus: row.financial_status,
    fulfillmentStatus: row.fulfillment_status ?? undefined,
    status: row.status,
    totalVnd: toVnd(row.total_price),
    shippingVnd: toVnd(row.total_shipping_price),
    discountVnd: toVnd(row.total_discounts),
    phoneDigits: phoneDigits(row.phone ?? row.shipping_address?.phone),
    lines: (row.line_items ?? []).map((l) => ({
      title: (l.title ?? l.name ?? "").trim() || "Sản phẩm",
      variantTitle: lineVariantTitle(l.variant_title),
      sku: (l.sku ?? "").trim() || undefined,
      quantity: typeof l.quantity === "number" ? l.quantity : 0,
      priceVnd: toVnd(l.price),
    })),
    address: row.shipping_address
      ? {
          address1: row.shipping_address.address1 ?? undefined,
          ward: row.shipping_address.ward ?? undefined,
          district: row.shipping_address.district ?? undefined,
          province: row.shipping_address.province ?? undefined,
        }
      : undefined,
  };
}

export function sapoAdminOrderUrl(cfg: SapoConfig, orderId: number): string {
  return `https://${cfg.storeDomain}/admin/orders/${orderId}`;
}
