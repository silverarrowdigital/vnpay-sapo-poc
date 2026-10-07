import { describe, expect, it } from "vitest";
import { productJsonLd, serializeJsonLd } from "./jsonld";
import type { CatalogProduct, ProductGroup } from "./product";

const v = (variantId: number, priceVnd: number, stock: number): CatalogProduct => ({
  variantId, productId: 1, name: "Trà", sku: `SKU-${variantId}`, priceVnd, stock, source: "sapo",
});
const group = (...variants: CatalogProduct[]): ProductGroup => ({ productId: 1, name: "Trà Lài", variants });

describe("productJsonLd", () => {
  it("one variant → an Offer with the price and stock", () => {
    const d = productJsonLd(group(v(1, 268_000, 5)), { url: "https://shop.test/products/tra-lai", imageUrl: "https://cdn.test/a.jpg" }) as Record<string, unknown>;
    expect(d["@type"]).toBe("Product");
    expect(d.offers).toMatchObject({ "@type": "Offer", price: 268_000, priceCurrency: "VND", availability: "https://schema.org/InStock" });
  });

  it("sizes priced differently → an AggregateOffer from the lowest to the highest", () => {
    const d = productJsonLd(group(v(1, 248_000, 1), v(2, 848_000, 1)), { url: "u" }) as { offers: Record<string, unknown> };
    expect(d.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: 248_000, highPrice: 848_000, offerCount: 2 });
  });

  it("is OutOfStock only when every size is", () => {
    const sold = productJsonLd(group(v(1, 1000, 0), v(2, 1000, 0)), { url: "u" }) as { offers: Record<string, unknown> };
    expect(sold.offers.availability).toBe("https://schema.org/OutOfStock");
    const some = productJsonLd(group(v(1, 1000, 0), v(2, 1000, 3)), { url: "u" }) as { offers: Record<string, unknown> };
    expect(some.offers.availability).toBe("https://schema.org/InStock");
  });
});

describe("serializeJsonLd", () => {
  it("cannot be made to close the script tag", () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script> & "x"', d: "a b" });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain(" ");
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script> & "x"'); // same data once parsed
  });
});
