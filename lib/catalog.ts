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
import { fetchCatalogEntries, fetchCatalogEntry, type SapoCatalogEntry } from "./sapo";
import { PRODUCT, type CatalogProduct, type DisplayProduct } from "./product";

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
    return [toCatalogProduct(await fetchCatalogEntry(cfg, cfg.variantId))];
  }
  return (await fetchCatalogEntries(cfg)).map(toCatalogProduct);
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
  return toCatalogProduct(await fetchCatalogEntry(cfg, cfg.variantId));
}
