import type { MetadataRoute } from "next";
import { allPostSlugs } from "@/lib/blog";
import { getDisplayProducts } from "@/lib/catalog";
import { getAppBaseUrl } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { productHref } from "@/lib/product";

/**
 * Every page worth indexing: the two listings, each product and each post.
 *
 * Both data sources are wrapped separately so one outage does not empty the whole sitemap — a
 * Sapo problem should still leave the blog listed, and vice versa. An absent APP_BASE_URL leaves
 * the sitemap empty rather than emitting relative URLs, which search engines reject anyway.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getAppBaseUrl();
  if (base === undefined) {
    log.warn("sitemap.no_base_url", {});
    return [];
  }

  const entries: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/blog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  ];

  try {
    for (const product of await getDisplayProducts()) {
      entries.push({
        url: `${base}${productHref(product)}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  } catch (err) {
    log.warn("sitemap.products_unavailable", { error: errorMessage(err) });
  }

  try {
    for (const slug of await allPostSlugs()) {
      entries.push({
        url: `${base}/blog/${slug}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  } catch (err) {
    log.warn("sitemap.posts_unavailable", { error: errorMessage(err) });
  }

  return entries;
}
