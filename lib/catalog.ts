/**
 * Resolves the one product this PoC sells. Server-only: never import from a "use client" file.
 *
 * With SAPO_VARIANT_ID set, Sapo is the single source of truth for name, price and stock, and
 * a Sapo outage makes the product unavailable rather than silently falling back to a stale
 * price — charging a price the customer did not see is worse than showing an error.
 *
 * Without SAPO_VARIANT_ID the PoC keeps working against the hardcoded PRODUCT, with stock
 * untracked (null), which is the original MVP behaviour.
 */
import { getSapoConfig } from "./config";
import { fetchCatalogEntry } from "./sapo";
import { PRODUCT, type DisplayProduct } from "./product";

/** Reads the live product. Throws if Sapo is configured but unreachable. */
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
  return {
    name: entry.name,
    sku: entry.sku || PRODUCT.sku,
    priceVnd: entry.priceVnd,
    compareAtPriceVnd: entry.compareAtPriceVnd,
    stock: entry.stock,
    unit: entry.unit,
    description: entry.description,
    imageUrl: entry.imageUrl,
    source: "sapo",
  };
}
