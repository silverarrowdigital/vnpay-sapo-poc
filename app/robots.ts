import type { MetadataRoute } from "next";
import { getAppBaseUrl, isIndexableDeployment } from "@/lib/config";

/**
 * What a crawler may fetch.
 *
 * - The production deployment is open, except the places that have nothing to index: the API, the
 *   checkout, the result page and the order lookup. /success also carries a noindex of its own; the
 *   lookup page has one too, but a crawler that obeys the disallow below never fetches it, so the
 *   two layers do not reinforce each other there — the disallow is what keeps it out.
 * - **Every other deployment is closed** (see isIndexableDeployment in lib/config.ts).
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment()) return { rules: { userAgent: "*", disallow: "/" } };

  const base = getAppBaseUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/checkout", "/success", "/tra-cuu-don"] },
    ...(base !== undefined ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
