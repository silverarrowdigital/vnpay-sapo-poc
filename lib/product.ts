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
export type CatalogProduct = DisplayProduct & { variantId: number };

/** true when the product cannot be bought right now. */
export function isSoldOut(p: DisplayProduct): boolean {
  return p.stock !== null && p.stock <= 0;
}

/** Largest quantity the customer may pick: the hard ceiling, capped by stock when tracked. */
export function maxOrderableQuantity(p: DisplayProduct): number {
  if (p.stock === null) return MAX_QUANTITY;
  return Math.max(0, Math.min(MAX_QUANTITY, p.stock));
}

export function formatVnd(amount: number): string {
  return `${amount.toLocaleString("vi-VN")} ₫`;
}
