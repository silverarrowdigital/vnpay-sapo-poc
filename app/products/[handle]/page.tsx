import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AddToCartForm from "@/components/AddToCartForm";
import { getProductByHandle } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";
import { formatVnd, isSoldOut, maxOrderableQuantity } from "@/lib/product";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

type Params = Promise<{ handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params;
  try {
    const product = await getProductByHandle(handle);
    if (product) return { title: `${product.name} — VNPAY → Sapo PoC` };
  } catch {
    // A Sapo outage must not break the page's own error handling; fall through to the default.
  }
  return {};
}

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { handle } = await params;

  let product;
  try {
    product = await getProductByHandle(handle);
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="card">
        <h1>Product unavailable</h1>
        <p className="alert err">Could not read this product from Sapo. Please try again later.</p>
        <Link href="/">Back to products</Link>
      </div>
    );
  }

  if (product === null) notFound();

  const soldOut = isSoldOut(product);

  return (
    <>
      <p className="crumb">
        <Link href="/">← All products</Link>
      </p>

      <div className="card detail">
        <div className="detail-media">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
            <img src={product.imageUrl} alt={product.name} />
          ) : (
            <span className="thumb-empty">No image</span>
          )}
        </div>

        <div className="detail-body">
          <p className="muted">SKU: {product.sku}</p>
          <h1>{product.name}</h1>

          <p className="price">
            {formatVnd(product.priceVnd)}
            {product.compareAtPriceVnd !== undefined && (
              <span className="was">{formatVnd(product.compareAtPriceVnd)}</span>
            )}
          </p>

          {product.stock !== null && (
            <p className={soldOut ? "stock out" : "stock in"}>
              {soldOut ? "Out of stock" : `${product.stock} ${product.unit ?? "in stock"} available`}
            </p>
          )}

          {/* Sapo's description is HTML; it is stripped to text server-side rather than rendered,
              so nothing a product's content contains can execute on this page. */}
          {product.description && <p>{product.description}</p>}

          <AddToCartForm variantId={product.variantId} soldOut={soldOut} max={maxOrderableQuantity(product)} />

          <p className="muted source">Name, price and stock read live from Sapo.</p>
        </div>
      </div>
    </>
  );
}
