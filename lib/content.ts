/**
 * CMS content for a product page. Server-only.
 *
 * Sapo stays the source of truth for name, price and stock (lib/catalog.ts); Sanity only holds
 * how a product is presented. So this module never throws: an unconfigured, unreachable or
 * empty CMS all resolve to `undefined`, and the product page falls back to the plain-text
 * description Sapo already gives it.
 */
import { groqQuery } from "./sanity";
import type { ContentBlock } from "./blocks";

/**
 * How a block array is read, shared by product content and (from T2) blog post bodies so the two
 * cannot drift apart.
 *
 * The `...` spread carries every simple block through untouched, which is what makes a new block
 * type work without editing this string — BlockRenderer ignores a `_type` it does not know, so a
 * block added in the Studio before the code ships degrades to nothing rather than an error.
 *
 * The two conditional overrides resolve image assets to URLs here, in the query. That is why this
 * repo needs no @sanity/image-url: Sanity's CDN takes sizing as query parameters on the returned
 * URL, so the components append `?w=…&q=…&auto=format` themselves. Intrinsic width and height
 * come along so the markup can reserve the box and avoid layout shift.
 */
export const BLOCKS_PROJECTION = `{
  ...,
  _type == "imageSlider" => {
    "images": images[]{
      alt,
      caption,
      "url": asset->url,
      "w": asset->metadata.dimensions.width,
      "h": asset->metadata.dimensions.height
    }
  },
  _type == "videoEmbed" => {
    "poster": poster.asset->url
  }
}`;

/** Matched on sapoProductId: see CLAUDE.md for why that and not alias or variantId. */
const PRODUCT_CONTENT_QUERY = `*[_type == "productContent" && sapoProductId == $productId][0].blocks[]${BLOCKS_PROJECTION}`;

/**
 * Blocks for one Sapo product, or `undefined` when there is nothing to render — no document for
 * this product, an empty block list, Sanity not configured, or the query failed. Callers treat
 * all of those the same way, so they are not distinguished.
 */
export async function getProductContent(productId: number): Promise<ContentBlock[] | undefined> {
  if (!Number.isSafeInteger(productId) || productId <= 0) return undefined;
  const blocks = await groqQuery<ContentBlock[] | null>("product_content", PRODUCT_CONTENT_QUERY, { productId });
  if (blocks === undefined || blocks === null || blocks.length === 0) return undefined;
  return blocks;
}
