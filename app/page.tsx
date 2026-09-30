import AddToCartButton from "@/components/AddToCartButton";
import { getDisplayProducts } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";
import { formatVnd, isSoldOut, maxOrderableQuantity } from "@/lib/product";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

export default async function CatalogPage() {
  let products;
  try {
    products = await getDisplayProducts();
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="card">
        <h1>Catalog unavailable</h1>
        <p className="alert err">
          Could not read products from Sapo. Check <code>SAPO_*</code> in <code>.env.local</code> and the server log.
        </p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="card">
        <h1>No products yet</h1>
        <p className="alert warn">
          Sapo returned no active product. Add one in Sapo admin, or check that its status is
          <code> active</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="catalog-head">
        <h1>Products</h1>
        <p className="muted">Names, prices and stock read live from Sapo.</p>
      </div>

      <ul className="grid">
        {products.map((product) => {
          const soldOut = isSoldOut(product);
          return (
            <li className="card product" key={product.variantId ?? product.sku}>
              {/* Sapo products may carry no image at all, so the tile always has a frame to sit in. */}
              <div className="thumb" aria-hidden="true">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
                  <img src={product.imageUrl} alt="" />
                ) : (
                  <span className="thumb-empty">No image</span>
                )}
              </div>

              <p className="muted">SKU: {product.sku}</p>
              <h2>{product.name}</h2>

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

              {product.description && <p className="muted clamp">{product.description}</p>}

              <AddToCartButton variantId={product.variantId} soldOut={soldOut} max={maxOrderableQuantity(product)} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
