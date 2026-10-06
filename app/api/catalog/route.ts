import { NextResponse } from "next/server";
import { getVariantCatalog } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";
import { productHref } from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // price and stock must never be served stale

/**
 * Public product data for the cart drawer (T3.5).
 *
 * The cart in the browser holds only `{variantId, quantity}` — deliberately, so a tampered cart
 * can never influence a price. The drawer still has to show a name, a price and a thumbnail, so
 * it reads them from here rather than from localStorage.
 *
 * Returning this changes nothing about what can be charged: `/api/checkout` re-resolves every
 * line against Sapo and recomputes the amount server-side regardless of what the browser knows.
 * Nothing here is secret — it is the same catalog the home page already renders.
 */
export async function GET() {
  try {
    const products = await getVariantCatalog();
    return NextResponse.json({
      products: products.map((p) => ({
        variantId: p.variantId,
        name: p.name,
        variantLabel: p.variantLabel,
        priceVnd: p.priceVnd,
        imageUrl: p.imageUrl,
        href: productHref(p, { pickVariant: true }),
        stock: p.stock,
      })),
    });
  } catch (err) {
    // The drawer degrades to quantities only; it must not take the page down with it.
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return NextResponse.json({ error: "Catalog unavailable" }, { status: 503 });
  }
}
