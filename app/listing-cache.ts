import { unstable_cache } from "next/cache";
import { getStorefrontProducts } from "@/lib/catalog";

/**
 * The product list for the two listing pages — home and /shop — read from Sapo at most every 30
 * seconds instead of on every request (owner's decision, 2026-10-07).
 *
 * Why: Lighthouse measured /shop's LCP at 3.4–3.6 s on a throttled phone because the page could not
 * emit its first <img> until Sapo's product list had come back (~1.4 s). A page that does not wait for
 * Sapo does not have that delay.
 *
 * What it costs, exactly: a product created, repriced or sold out in Sapo shows on these two pages up
 * to 30 seconds later. **It never touches money**: the product page, the cart drawer (/api/catalog),
 * the quote and the checkout all still read Sapo live, and checkout re-prices every line from Sapo
 * regardless of what a listing showed. A tile that says "in stock" for a variant that sold out 20
 * seconds ago is refused at checkout with the usual message.
 *
 * Only a successful answer is cached: \`unstable_cache\` does not store a thrown error, so a Sapo outage
 * is still reported as one and the next request asks again.
 */
export const getCachedStorefrontProducts = unstable_cache(async () => getStorefrontProducts(), ["storefront-listing"], {
  revalidate: 30,
  tags: ["storefront"],
});
