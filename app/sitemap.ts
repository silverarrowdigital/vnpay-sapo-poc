import type { MetadataRoute } from "next";
import { allPostSlugs } from "@/lib/blog";
import { getListedProducts } from "@/lib/catalog";
import { getAppBaseUrl } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { POLICIES } from "@/lib/policies";
import { defaultVariant, productHref } from "@/lib/product";

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
    { url: `${base}/shop`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/blog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/ve-chung-toi`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/lien-he`, changeFrequency: "yearly", priority: 0.5 },
    // The policies change when the shop's terms do, which is rare; no lastModified is claimed rather
    // than a made-up "now" on every request.
    ...POLICIES.map((p) => ({ url: `${base}/chinh-sach/${p.slug}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];

  try {
    // One URL per product, however many sizes it has — the sizes are query parameters on it.
    for (const group of await getListedProducts()) {
      entries.push({
        url: `${base}${productHref(defaultVariant(group))}`,
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
