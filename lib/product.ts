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
  /** Where the data came from, so the UI can say so. */
  source: "sapo" | "fallback";
}

/**
 * A product from the Sapo catalog, always backed by a real variant. The storefront only ever lists
 * these, so nothing downstream has to handle a product it could not put in a cart.
 */
export type CatalogProduct = DisplayProduct & { variantId: number; productId: number };

/**
 * Address of a product's page. The readable slug is preferred, with the variant id as the fallback
 * so a product Sapo never gave an alias still has a working link. The route resolves both.
 */
export function productHref(p: CatalogProduct): string {
  return `/products/${encodeURIComponent(p.alias ?? String(p.variantId))}`;
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
