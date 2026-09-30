import Link from "next/link";
import { getDisplayProduct } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";
import { formatVnd, isSoldOut } from "@/lib/product";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

export default async function ProductPage() {
  let product;
  try {
    product = await getDisplayProduct();
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="card">
        <h1>Product unavailable</h1>
        <p className="alert err">
          Could not read the product from Sapo. Check <code>SAPO_*</code> in <code>.env.local</code> and the
          server log.
        </p>
      </div>
    );
  }

  const soldOut = isSoldOut(product);

  return (
    <div className="card">
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

      {product.description && <p className="muted">{product.description}</p>}

      {soldOut ? (
        <button className="btn sold-out" type="button" disabled>
          Out of stock
        </button>
      ) : (
        <Link className="btn" href="/checkout">
          Buy now
        </Link>
      )}

      <p className="muted source">
        {product.source === "sapo"
          ? "Name, price and stock read live from Sapo."
          : "Hardcoded product — set SAPO_VARIANT_ID to read it from Sapo."}
      </p>
    </div>
  );
}
