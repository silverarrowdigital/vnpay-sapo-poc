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
  sku?: string | null;
  price?: number | string | null;
  compare_at_price?: number | string | null;
  inventory_quantity?: number | null;
  unit?: string | null;
  image_id?: number | null;
  /** 1-based order within the product; used to pick a single representative variant. */
  position?: number | null;
}
interface SapoProduct {
  id: number;
  name?: string | null;
  content?: string | null;
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
  name: string;
  sku: string;
  priceVnd: number;
  compareAtPriceVnd?: number;
  stock: number;
  unit?: string;
  description?: string;
  imageUrl?: string;
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
    name: product.name?.trim() || `Variant ${variant.id}`,
    sku: (variant.sku ?? "").trim(),
    priceVnd: price,
    compareAtPriceVnd: compare > price ? compare : undefined,
    stock: typeof variant.inventory_quantity === "number" ? variant.inventory_quantity : 0,
    unit: variant.unit?.trim() || undefined,
    description: htmlToText(product.content),
    imageUrl: image ?? undefined,
  };
}

/** Sapo orders variants by `position`; a missing position sorts last rather than first. */
function firstVariant(product: SapoProduct): SapoVariant | undefined {
  const variants = (product.variants ?? []).filter((v) => typeof v.id === "number");
  if (variants.length === 0) return undefined;
  return [...variants].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))[0];
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
 * Every sellable product, one entry each: the first variant by position. Products with no variant
 * are skipped, and only `status === "active"` is listed, so a draft never reaches the storefront.
 *
 * One entry per product is a deliberate PoC limit — a product with real options would need a
 * variant picker. Because entries already carry variantId, adding that later does not change the
 * shape of a cart line.
 */
export async function fetchCatalogEntries(cfg: SapoConfig): Promise<SapoCatalogEntry[]> {
  const data = (await sapoFetch(cfg, "/admin/products.json?limit=250")) as { products?: SapoProduct[] };
  const entries: SapoCatalogEntry[] = [];
  for (const product of data.products ?? []) {
    if ((product.status ?? "active").trim().toLowerCase() !== "active") continue;
    const variant = firstVariant(product);
    if (variant === undefined) continue;
    entries.push(toCatalogEntry(product, variant));
  }
  return entries;
}

export interface SapoOrderInput {
  txnRef: string;
  vnpTransactionNo: string;
  vnpBankCode?: string;
  vnpPayDate?: string;
  customer: { name: string; phone: string; email: string; address: string };
  sku: string;
  productName: string;
  unitPriceVnd: number;
  quantity: number;
  totalVnd: number;
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

/** Tag used to find an order again by its VNPAY reference (idempotency across restarts/instances). */
export function txnTag(txnRef: string): string {
  return `vnpay-${txnRef}`;
}

/** "Nguyễn Văn An" → last_name "Nguyễn Văn", first_name "An" (Vietnamese given name comes last). */
function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[parts.length - 1], last_name: parts.slice(0, -1).join(" ") };
}

export function buildOrderPayload(cfg: SapoConfig, input: SapoOrderInput) {
  const { first_name, last_name } = splitName(input.customer.name);
  const address = {
    first_name,
    last_name,
    name: input.customer.name,
    phone: input.customer.phone,
    address1: input.customer.address,
    country: "Vietnam",
  };

  const lineItem = cfg.variantId
    ? { variant_id: cfg.variantId, quantity: input.quantity, price: input.unitPriceVnd }
    : { title: input.productName, sku: input.sku, price: input.unitPriceVnd, quantity: input.quantity };

  return {
    order: {
      email: input.customer.email,
      phone: input.customer.phone,
      line_items: [lineItem],
      customer: { first_name, last_name, email: input.customer.email, phone: input.customer.phone },
      billing_address: address,
      shipping_address: address,
      financial_status: "paid",
      transactions: [{ kind: "sale", status: "success", amount: input.totalVnd, gateway: "VNPAY" }],
      note: `Paid via VNPAY Sandbox. TxnRef ${input.txnRef}, VNPAY TransactionNo ${input.vnpTransactionNo}.`,
      note_attributes: [
        { name: "vnp_TxnRef", value: input.txnRef },
        { name: "vnp_TransactionNo", value: input.vnpTransactionNo },
        { name: "vnp_BankCode", value: input.vnpBankCode ?? "" },
        { name: "vnp_PayDate", value: input.vnpPayDate ?? "" },
        { name: "sku", value: input.sku },
        { name: "amount_vnd", value: String(input.totalVnd) },
      ],
      tags: `headless-poc, vnpay, ${txnTag(input.txnRef)}`,
      // Stock movement. Without this field Sapo defaults to "bypass" and never touches stock
      // (https://support.sapo.vn/phuong-thuc-post-cua-order-phan-2). Only meaningful when the
      // line is linked to a real variant — a custom line item has nothing to deduct.
      //
      // "decrement_ignoring_policy" is deliberate over "decrement_obeying_policy": we only get
      // here after the payment is already verified, so a refusal for being out of stock would
      // leave money taken and no order (IPN 99 → VNPAY retries → still fails). This always
      // succeeds and may drive stock negative; that is an ops problem, not a payment one.
      ...(cfg.variantId ? { inventory_behaviour: "decrement_ignoring_policy" } : {}),
      // No source_name: Sapo reserves values like "web"/"pos" for its own channels and rejects
      // a private app that sets one (HTTP 422 "cannot be set to a protected value by an
      // untrusted API client"). The order is identified by its tags and note_attributes instead.
      send_receipt: false,
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

/** Look for an order already created for this txnRef in the last 3 days. */
export async function findOrderByTxnRef(cfg: SapoConfig, txnRef: string): Promise<SapoOrderRef | null> {
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
  const qs = new URLSearchParams({
    tag: txnTag(txnRef),
    limit: "250",
    created_on_min: createdMin,
    fields: "id,name,tags,note_attributes",
  });
  const data = (await sapoFetch(cfg, `/admin/orders.json?${qs.toString()}`)) as { orders?: OrderListItem[] };
  const tag = txnTag(txnRef);
  const match = (data.orders ?? []).find(
    (o) =>
      (o.tags ?? "").split(",").map((t) => t.trim()).includes(tag) ||
      (o.note_attributes ?? []).some((a) => a.name === "vnp_TxnRef" && a.value === txnRef),
  );
  return match ? { id: match.id, name: match.name ?? `#${match.id}` } : null;
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

/** Idempotent create: reuse an existing Sapo order for this txnRef if one exists. */
export async function createOrderOnce(
  cfg: SapoConfig,
  input: SapoOrderInput,
): Promise<{ order: SapoOrderRef; created: boolean }> {
  const existing = await findOrderByTxnRef(cfg, input.txnRef);
  if (existing) return { order: existing, created: false };
  return { order: await createOrder(cfg, input), created: true };
}

export function sapoAdminOrderUrl(cfg: SapoConfig, orderId: number): string {
  return `https://${cfg.storeDomain}/admin/orders/${orderId}`;
}
