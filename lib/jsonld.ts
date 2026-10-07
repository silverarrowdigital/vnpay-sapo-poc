/**
 * schema.org `Product` data for a product page (T13.9). Plain data in, plain data out: client-safe.
 *
 * Only what Sapo says — name, image, SKU, price, stock — plus Sapo's own description already stripped
 * to text (lib/sapo.ts `htmlToText`). **Never CMS content**: nothing typed into Sanity reaches this
 * object. That restriction is what lets the one `dangerouslySetInnerHTML` in the project
 * (components/JsonLd.tsx) exist, and `serializeJsonLd` closes the remaining hole: a name or
 * description containing `</script>` must not end the tag.
 */
import { isSoldOut, priceRange, type ProductGroup } from "./product";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function productJsonLd(group: ProductGroup, opts: { url?: string; imageUrl?: string; description?: string }): Json {
  const inStock = group.variants.some((v) => !isSoldOut(v));
  const availability = `https://schema.org/${inStock ? "InStock" : "OutOfStock"}`;
  const { fromVnd, varies } = priceRange(group);
  const first = group.variants[0];
  const prices = group.variants.map((v) => v.priceVnd);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: group.name,
    ...(opts.imageUrl ? { image: [opts.imageUrl] } : {}),
    ...(opts.description ? { description: opts.description.slice(0, 5000) } : {}),
    offers: varies
      ? {
          "@type": "AggregateOffer",
          priceCurrency: "VND",
          lowPrice: fromVnd,
          highPrice: Math.max(...prices),
          offerCount: group.variants.length,
          availability,
          ...(opts.url ? { url: opts.url } : {}),
        }
      : { "@type": "Offer", priceCurrency: "VND", price: first.priceVnd, availability, ...(opts.url ? { url: opts.url } : {}) },
  };
}

/**
 * JSON for the inside of a `<script type="application/ld+json">`. `<`, `>` and `&` are written as
 * unicode escapes — still the same JSON string to a parser, but never a tag boundary to the HTML
 * parser — as are U+2028/2029, which older JavaScript engines treat as line breaks.
 */
export function serializeJsonLd(data: Json): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c] ?? c);
}

/** One backslash followed by "u" and four hex digits: JSON's own way to write the character. */
const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
