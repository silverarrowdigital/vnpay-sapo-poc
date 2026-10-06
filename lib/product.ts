/**
 * Product shapes shared by server and client. Safe to import from client components:
 * no secrets, no server-only imports.
 *
 * PRODUCT is the fallback used only when SAPO_VARIANT_ID is not configured. When it is,
 * the catalog entry comes from Sapo (see lib/catalog.ts) and Sapo is the single source of
 * truth for name, price and stock. The server always recomputes the amount from whichever
 * of the two it resolved; a price sent by the browser is never trusted.
 */

/** Fallback product for the "no SAPO_VARIANT_ID" mode. */
export const PRODUCT = {
  name: "Test Product",
  sku: "TEST-001",
  priceVnd: 100_000,
} as const;

/** Hard ceiling on quantity per line, independent of stock. */
export const MAX_QUANTITY = 10;

/**
 * Whether cash on delivery is offered at all. **Off** (2026-10-06, the shop's decision): every order
 * is paid by VNPAY. The server refuses `paymentMethod: "cod"` in `validateCheckout` — before any rate
 * limit or Sapo call — and the checkout form does not draw the option, so flipping this to `true` is
 * the whole of bringing COD back; `placeCodOrder` and its limits are untouched.
 */
export const COD_ENABLED = false;

/**
 * Hard ceiling on what cash on delivery may be used for.
 *
 * COD is the one path where a request creates a real Sapo order and moves real stock without any
 * money arriving, so the exposure of a single abusive order is capped here rather than left to the
 * rate limits alone. A card payment needs no ceiling: it costs the payer before it costs the shop.
 *
 * **This is the shop's number**, like the delivery fees in lib/shipping.ts — raise it or lower it
 * here and nothing else changes. Above it the customer is asked to pay by card, not refused a sale.
 */
export const MAX_COD_TOTAL_VND = 3_000_000;

/**
 * Hard ceiling on distinct lines in a cart. A crafted request could otherwise ask us to price an
 * unbounded number of lines, and the Sapo order would be just as unbounded.
 */
export const MAX_CART_LINES = 20;

/**
 * A cart line exactly as the browser keeps and sends it: what, and how many. Never a price — the
 * server resolves the variant against Sapo and recomputes every amount (see startCheckout).
 */
export interface CartLine {
  variantId: number;
  quantity: number;
}

/** What the UI renders and what checkout prices against. */
export interface DisplayProduct {
  name: string;
  sku: string;
  /**
   * Sapo variant id, absent in fallback mode. Price and stock live on the variant, so this — not a
   * product id — is what identifies a line the customer is buying.
   */
  variantId?: number;
  /**
   * Sapo product id, absent in fallback mode. Not used for pricing — it is the key the CMS
   * matches a product's content on, because it is the only Sapo identifier that never changes:
   * renaming a product changes its alias, and recreating a variant changes variantId. See
   * lib/content.ts.
   */
  productId?: number;
  /** Sapo's URL slug. Used for the product page's address when present. */
  alias?: string;
  priceVnd: number;
  /** Sapo compare_at_price: the struck-through "was" price, when higher than priceVnd. */
  compareAtPriceVnd?: number;
  /** Units in stock, or null when stock is not tracked (fallback mode). */
  stock: number | null;
  /** Sapo variant unit, e.g. "cái". */
  unit?: string;
  /** Plain-text description (HTML from Sapo is stripped server-side). */
  description?: string;
  imageUrl?: string;
  /**
   * What distinguishes this variant from its siblings ("200g ~ 66 Servings"). **Empty for a product
   * with one variant** — Sapo's "Default Title" is filtered out upstream, so anything that prints
   * this can print it unconditionally.
   */
  variantLabel?: string;
  /** Name of the product's single option ("Size"), used as the page's query key. See lib/sapo.ts. */
  optionName?: string;
  /** Where the data came from, so the UI can say so. */
  source: "sapo" | "fallback";
}

/**
 * A *variant* from the Sapo catalog, always backed by a real variant id. This is the unit that is
 * priced and put in a cart, so nothing downstream has to handle a line it could not sell. One
 * Sapo product with four sizes is four of these (see `ProductGroup` for the display side).
 */
export type CatalogProduct = DisplayProduct & { variantId: number; productId: number };

/**
 * One product as the storefront shows it: its sellable variants, in Sapo's order. A product with
 * a single variant has a one-element list and shows no picker.
 */
export interface ProductGroup {
  productId: number;
  alias?: string;
  name: string;
  variants: CatalogProduct[];
}

/** The size picker appears only when there is something to pick between. */
export function hasChoice(g: ProductGroup): boolean {
  // Every variant needs a label: pills with nothing written on them are not a choice.
  return g.variants.length > 1 && g.variants.every((v) => v.variantLabel !== undefined);
}

/** Sold out only when **every** variant is — one size left is still a product that can be bought. */
export function isGroupSoldOut(g: ProductGroup): boolean {
  return g.variants.every((v) => isSoldOut(v));
}

/**
 * The variant a page opens on with nothing chosen: the first by Sapo's order, or — if that one is
 * sold out — the first that is not, so a customer never lands on a locked buy button beside a size
 * that is available.
 */
export function defaultVariant(g: ProductGroup): CatalogProduct {
  return g.variants.find((v) => !isSoldOut(v)) ?? g.variants[0];
}

/** "From" price when sizes are priced differently, otherwise the one price. */
export function priceRange(g: ProductGroup): { fromVnd: number; varies: boolean } {
  const prices = g.variants.map((v) => v.priceVnd);
  const fromVnd = Math.min(...prices);
  return { fromVnd, varies: prices.some((p) => p !== fromVnd) };
}

/** Case, runs of spaces and `+` (a space in a query string) must not stop a label matching itself. */
function normaliseLabel(s: string): string {
  return s.replace(/\+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Pick the variant a product page should show.
 *
 * Order: `?variant=<id>`, then `?<OptionName>=<label>`, then a numeric path handle (the page's
 * fallback address for a product with no alias), then the default. **Anything that does not match
 * falls through to the default rather than failing** — a stale or mistyped link still opens a page
 * the customer can buy from. Input is only ever compared, never echoed or used as a key.
 */
export function selectVariant(
  g: ProductGroup,
  handle: string,
  query: Record<string, string | string[] | undefined>,
): CatalogProduct {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const byId = Number(first(query.variant));
  if (Number.isSafeInteger(byId) && byId > 0) {
    const hit = g.variants.find((v) => v.variantId === byId);
    if (hit !== undefined) return hit;
  }

  const optionName = g.variants[0]?.optionName;
  // hasOwn: an option called "constructor" must not read an inherited function off the object.
  const wanted = optionName !== undefined && Object.hasOwn(query, optionName) ? first(query[optionName]) : undefined;
  if (typeof wanted === "string" && wanted.length <= 200) {
    const w = normaliseLabel(wanted);
    const hit = g.variants.find((v) => v.variantLabel !== undefined && normaliseLabel(v.variantLabel) === w);
    if (hit !== undefined) return hit;
  }

  const asVariantId = Number(handle);
  if (Number.isSafeInteger(asVariantId) && asVariantId > 0) {
    const hit = g.variants.find((v) => v.variantId === asVariantId);
    if (hit !== undefined) return hit;
  }
  return defaultVariant(g);
}

/**
 * Address of a product's page. The readable slug is preferred, with a variant id as the fallback
 * so a product Sapo never gave an alias still has a working link. The route resolves both.
 *
 * Pass a variant of a multi-variant product to link to that exact size (`?Size=…`, or
 * `?variant=<id>` when the product has no single option name).
 */
export function productHref(p: CatalogProduct, opts: { pickVariant?: boolean } = {}): string {
  const base = `/products/${encodeURIComponent(p.alias ?? String(p.variantId))}`;
  if (!opts.pickVariant || p.variantLabel === undefined) return base;
  if (p.optionName !== undefined) return `${base}?${p.optionName}=${encodeURIComponent(p.variantLabel)}`;
  return `${base}?variant=${p.variantId}`;
}

/**
 * Stock is all these two need, so that is all they ask for. Taking the whole DisplayProduct would
 * force every caller to own one — the cart drawer, for instance, carries a trimmed catalog entry
 * with no sku or source, and casting it would have been a lie about what it is.
 */
type Stocked = Pick<DisplayProduct, "stock">;

/** true when the product cannot be bought right now. */
export function isSoldOut(p: Stocked): boolean {
  return p.stock !== null && p.stock <= 0;
}

/** Largest quantity the customer may pick: the hard ceiling, capped by stock when tracked. */
export function maxOrderableQuantity(p: Stocked): number {
  if (p.stock === null) return MAX_QUANTITY;
  return Math.max(0, Math.min(MAX_QUANTITY, p.stock));
}

/**
 * Money, in the reference storefront's format: symbol first, comma groups — ₫248,000.
 *
 * Note this is not the usual Vietnamese convention (248.000 ₫, dot groups, symbol last). The
 * reference site uses its platform's default and the brief is to match it, so the whole app uses
 * this one function: a storefront that prices a tile one way and the checkout another is a bug,
 * not fidelity. Changing it back is a one-line edit here.
 */
export function formatVnd(amount: number): string {
  return `₫${amount.toLocaleString("en-US")}`;
}
