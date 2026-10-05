/**
 * Resolves what this PoC sells. Server-only: never import from a "use client" file.
 *
 * Sapo is the single source of truth for name, price and stock, and a Sapo outage makes the
 * catalog unavailable rather than silently falling back to a stale price — charging a price the
 * customer did not see is worse than showing an error.
 *
 * Two modes, both reading `/admin/products.json`:
 *
 * - **Catalog** (no `SAPO_VARIANT_ID`): every active product, one entry each. This is the mode the
 *   storefront uses.
 * - **Single variant** (`SAPO_VARIANT_ID` set): the original one-product behaviour, kept so an
 *   existing `.env.local` keeps working unchanged.
 *
 * Without Sapo credentials at all there is nothing to read, so `getDisplayProduct` still answers
 * from the hardcoded `PRODUCT` with stock untracked.
 */
import { getSapoConfig } from "./config";
import { log } from "./log";
import { fetchCatalogEntries, fetchCatalogEntry, type SapoCatalogEntry } from "./sapo";
import { PRODUCT, type CatalogProduct, type DisplayProduct } from "./product";

/**
 * Combo products are withheld from the storefront.
 *
 * **Not a style choice — selling one is a book-keeping error.** A combo variant has no stock of its
 * own (its availability is `min(component stock / quantity needed)`) and
 * `POST /admin/orders.json` does not expand it into components, so an order for a combo takes the
 * money, ships three real items, and leaves every stock figure untouched. Because availability is
 * derived from components that never move, **selling combos never reduces the number shown** — it
 * says 37 forever. Measured on a live store on 2026-10-05, twice: once with 40 units, once with a
 * single unit (order #1034).
 *
 * Setting the product to `draft` in Sapo would have the same effect and was the first choice, but
 * that store does not offer it. So the line is held here instead, and `docs/plan/T8-combo-ton-kho.md`
 * carries the plan for selling them properly. When that ships, this filter goes.
 *
 * It is deliberately a filter over the catalog rather than a refusal at checkout: a product nobody
 * can see is better than one a customer configures and is turned away from at the last step. The
 * checkout refusal still exists as the second layer, because a cart lives in `localStorage` and may
 * already hold a combo from before this shipped.
 */
function isSellable(entry: SapoCatalogEntry): boolean {
  if (!entry.requiresComponents) return true;
  log.warn("catalog.combo_withheld", { variantId: entry.variantId, sku: entry.sku });
  return false;
}

function toCatalogProduct(entry: SapoCatalogEntry): CatalogProduct {
  return {
    name: entry.name,
    sku: entry.sku || PRODUCT.sku,
    variantId: entry.variantId,
    productId: entry.productId,
    alias: entry.alias,
    priceVnd: entry.priceVnd,
    compareAtPriceVnd: entry.compareAtPriceVnd,
    stock: entry.stock,
    unit: entry.unit,
    description: entry.description,
    imageUrl: entry.imageUrl,
    source: "sapo",
  };
}

/**
 * The whole storefront catalog. Throws if Sapo is unreachable.
 *
 * With `SAPO_VARIANT_ID` set this returns just that one product, so the variable still pins the
 * PoC to a single item when that is what you want.
 */
export async function getDisplayProducts(): Promise<CatalogProduct[]> {
  const cfg = getSapoConfig(); // throws MissingEnvError when not configured
  if (cfg.variantId !== undefined) {
    // The pinned-variant mode goes through the same gate: SAPO_VARIANT_ID pointing at a combo is a
    // misconfiguration, and an empty catalog is the safe reading of it. The logged warning from
    // isSellable names the variant.
    const entry = await fetchCatalogEntry(cfg, cfg.variantId);
    return isSellable(entry) ? [toCatalogProduct(entry)] : [];
  }
  return (await fetchCatalogEntries(cfg)).filter(isSellable).map(toCatalogProduct);
}

/**
 * One product by the handle in its URL: Sapo's `alias`, or the variant id as a fallback so a
 * product without an alias is still reachable. `null` when nothing matches, which the page turns
 * into a 404.
 *
 * Filtering the catalog list rather than fetching one product keeps us on the single Sapo endpoint
 * this code has verified against a live store.
 */
export async function getProductByHandle(handle: string): Promise<CatalogProduct | null> {
  const products = await getDisplayProducts();
  const byAlias = products.find((p) => p.alias === handle);
  if (byAlias !== undefined) return byAlias;
  const asVariantId = Number(handle);
  if (!Number.isSafeInteger(asVariantId) || asVariantId <= 0) return null;
  return products.find((p) => p.variantId === asVariantId) ?? null;
}

/** Reads one live product. Throws if Sapo is configured but unreachable. */
export async function getDisplayProduct(): Promise<DisplayProduct> {
  const cfg = getSapoConfig(); // throws MissingEnvError when not configured
  if (cfg.variantId === undefined) {
    return {
      name: PRODUCT.name,
      sku: PRODUCT.sku,
      priceVnd: PRODUCT.priceVnd,
      stock: null, // not tracked without a real variant
      source: "fallback",
    };
  }
  const entry = await fetchCatalogEntry(cfg, cfg.variantId);
  if (!isSellable(entry)) {
    // Nothing honest to return: the fallback PRODUCT would be the wrong name and the wrong price,
    // and the real entry cannot be sold without mis-stating stock. Callers already handle a Sapo
    // failure by saying the catalog is unavailable, which is exactly what this is.
    throw new Error(`SAPO_VARIANT_ID ${cfg.variantId} is a combo (${entry.sku}); see docs/plan/T8-combo-ton-kho.md`);
  }
  return toCatalogProduct(entry);
}
