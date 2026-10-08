/**
 * What may be sold (`isSellable`, through `getVariantCatalog`): the one list the storefront, the cart,
 * the quote and the checkout all price against. Sapo is mocked at its module edge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SapoCatalogEntry } from "./sapo";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock("./sapo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sapo")>()),
  fetchCatalogEntries: vi.fn(),
  fetchCatalogEntry: vi.fn(),
}));

const { fetchCatalogEntries, fetchCatalogEntry } = await import("./sapo");
const { getVariantCatalog, getVariantIndex, getStorefrontProducts } = await import("./catalog");
const { log } = await import("./log");

function entry(variantId: number, priceVnd: number, extra: Partial<SapoCatalogEntry> = {}): SapoCatalogEntry {
  return { productId: 1, variantId, name: "Trà", sku: `SKU-${variantId}`, priceVnd, stock: 10, requiresComponents: false, ...extra };
}

beforeEach(() => {
  process.env.SAPO_STORE_DOMAIN = "shop-test.invalid";
  process.env.SAPO_API_KEY = "key";
  process.env.SAPO_API_SECRET = "secret";
  delete process.env.SAPO_VARIANT_ID;
});

describe("a variant with no price is never sold", () => {
  it("withholds a ₫0 size and a negative or fractional price, and keeps the priced sizes of the same product", async () => {
    vi.mocked(fetchCatalogEntries).mockResolvedValue([
      entry(101, 248_000, { variantLabel: "95g" }),
      entry(102, 0, { variantLabel: "200g" }),
      entry(103, -1, { variantLabel: "5 x 95g" }),
      entry(104, 0.5, { variantLabel: "10 x 95g" }),
      entry(105, Number.MAX_SAFE_INTEGER + 2, { variantLabel: "typo" }),
    ]);
    expect((await getVariantCatalog()).map((v) => v.variantId)).toEqual([101]);
    // The checkout and the quote price from this index: a ₫0 size is simply not in it (→ 409).
    expect([...(await getVariantIndex()).keys()]).toEqual([101]);
    expect((await getStorefrontProducts())[0].variants.map((v) => v.variantId)).toEqual([101]);
    expect(log.warn).toHaveBeenCalledWith("catalog.unpriced_withheld", expect.objectContaining({ variantId: 102 }));
  });

  it("drops a product whose every size is unpriced from the storefront", async () => {
    vi.mocked(fetchCatalogEntries).mockResolvedValue([entry(201, 0, { productId: 2 }), entry(301, 50_000, { productId: 3 })]);
    expect((await getStorefrontProducts()).map((p) => p.productId)).toEqual([3]);
  });

  it("applies the same gate to a pinned SAPO_VARIANT_ID", async () => {
    process.env.SAPO_VARIANT_ID = "401";
    vi.mocked(fetchCatalogEntry).mockResolvedValue(entry(401, 0));
    expect(await getVariantCatalog()).toEqual([]);
  });

  it("still withholds a combo", async () => {
    vi.mocked(fetchCatalogEntries).mockResolvedValue([entry(501, 385_000, { requiresComponents: true }), entry(502, 50_000)]);
    expect((await getVariantCatalog()).map((v) => v.variantId)).toEqual([502]);
  });
});
