/**
 * CMS content for a product page. Server-only.
 *
 * Sapo stays the source of truth for name, price and stock (lib/catalog.ts); Sanity only holds
 * how a product is presented, so a CMS problem must never stop a product being sold.
 *
 * **Two different "no content" answers, and they must not be confused.** An unconfigured CMS, a
 * product nobody has written about, and an empty document are all stable facts: `undefined`, and
 * the caller is free to cache that. A query that *failed* is not a fact about the product — it is
 * a fact about this moment — so it throws, and the caller must not record it as an answer.
 *
 * This module used to swallow the second into the first. Combined with the five-minute cache in
 * app/products/[handle]/page.tsx, one timed-out query was written down as "this product has no
 * description" and served for five minutes — and because the refresh runs in the background just
 * after a publish, it struck exactly when an editor was looking at their new page. Hit for real
 * on 2026-10-02.
 */
import { groqQueryOrThrow, sanityClient } from "./sanity";
import type { ContentBlock } from "./blocks";

/**
 * The fields that turn an image reference into something the markup can use: a URL plus the alt
 * text and the intrinsic size. Written once and spliced into every block that holds an image, so
 * the shapes are provably identical and all of them match BlockImage in lib/blocks.ts.
 *
 * This is why the repo needs no @sanity/image-url: Sanity's CDN takes sizing as query parameters
 * on the URL returned here, so components/blocks/imageUrl.ts is a pair of string helpers.
 */
const IMAGE_FIELDS = `
  alt,
  "url": asset->url,
  "w": asset->metadata.dimensions.width,
  "h": asset->metadata.dimensions.height
`;

/**
 * How a block array is read, shared by product content and blog post bodies so the two cannot
 * drift apart.
 *
 * The `...` spread carries every simple block through untouched, which is what makes a new block
 * type work without editing this string — `comparisonTable` and `brewProfile` hold no images and
 * need no branch of their own. BlockRenderer ignores a `_type` it does not know, so a block added
 * in the Studio before the code ships degrades to nothing rather than an error.
 *
 * The conditional overrides exist only to resolve image assets, and they resolve the *whole*
 * image: an optional one projects to `null` when the editor left it empty, which the components
 * test for by truthiness rather than against `undefined`.
 *
 * Changing this string does not change the cache key — see the warning in CLAUDE.md about
 * revalidating after a deploy that touches it.
 */
export const BLOCKS_PROJECTION = `{
  ...,
  _type == "imageSlider" => {
    "images": images[]{ ${IMAGE_FIELDS}, caption }
  },
  _type == "videoEmbed" => {
    "poster": poster.asset->url
  },
  _type == "logoRow" => {
    "logos": logos[]{ ${IMAGE_FIELDS} }
  },
  _type == "steps" => {
    "steps": steps[]{ title, body, "image": image{ ${IMAGE_FIELDS} } }
  },
  _type == "featureGrid" => {
    "cards": cards[]{ title, body, "image": image{ ${IMAGE_FIELDS} } }
  },
  _type == "ingredientCards" => {
    "cards": cards[]{ name, tags, "image": image{ ${IMAGE_FIELDS} } }
  }
}`;

/**
 * The short facts shown in the buy box, beside the price — not part of the block list.
 *
 * Every field is optional and every one can arrive as `null`, so the buy box tests each before
 * drawing its row. It must never render a label with nothing after it.
 */
export interface ProductMeta {
  /** Pack size, e.g. "15+ lần pha / 50g". */
  servings?: string | null;
  summary?: string | null;
  teaType?: string | null;
  caffeine?: string | null;
  tastingNotes?: string | null;
  perfectFor?: string | null;
  benefits?: string[] | null;
}

/** Everything the CMS holds about one product, in the two shapes the page needs it in. */
export interface ProductContent {
  meta: ProductMeta | null;
  blocks: ContentBlock[];
}

/** Matched on sapoProductId: see CLAUDE.md for why that and not alias or variantId. */
const PRODUCT_CONTENT_QUERY = `*[_type == "productContent" && sapoProductId == $productId][0]{
  meta,
  "blocks": blocks[]${BLOCKS_PROJECTION}
}`;

/**
 * CMS content for one Sapo product, or `undefined` when there is genuinely nothing to render: an
 * invalid id, a CMS that is switched off, no document for this product, or a document holding
 * neither meta nor blocks. Those are the same thing to a caller and are all safe to cache.
 *
 * @throws SanityUnavailableError when the CMS is configured but could not answer — unreachable,
 * too slow, or a query error. The caller renders without CMS content *and does not cache the
 * result*, so the next request tries again instead of inheriting a five-minute hole.
 */
export async function getProductContent(productId: number): Promise<ProductContent | undefined> {
  if (!Number.isSafeInteger(productId) || productId <= 0) return undefined;
  // Not configured is a stable answer, not a failure: the storefront is meant to run without a
  // CMS at all, and throwing here would mean throwing on every request forever.
  if (sanityClient() === undefined) return undefined;

  const doc = await groqQueryOrThrow<{ meta?: ProductMeta | null; blocks?: ContentBlock[] | null } | null>(
    "product_content",
    PRODUCT_CONTENT_QUERY,
    { productId },
  );
  if (doc === null) return undefined;

  const blocks = doc.blocks ?? [];
  const meta = doc.meta ?? null;
  // A document that exists but says nothing is the same as no document at all.
  if (meta === null && blocks.length === 0) return undefined;
  return { meta, blocks };
}
