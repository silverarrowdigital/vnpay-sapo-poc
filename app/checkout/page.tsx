import Link from "next/link";
import CheckoutForm from "@/components/CheckoutForm";
import { getDisplayProduct } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";
import { formatVnd, isSoldOut } from "@/lib/product";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

export default async function CheckoutPage() {
  let product;
  try {
    product = await getDisplayProduct();
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="card">
        <h1>Checkout unavailable</h1>
        <p className="alert err">Could not read the product from Sapo. Please try again later.</p>
      </div>
    );
  }

  if (isSoldOut(product)) {
    return (
      <div className="card">
        <h1>Out of stock</h1>
        <p className="muted">
          {product.name} ({product.sku}) is not available right now.
        </p>
        <Link className="btn" href="/">
          Back to product
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Checkout</h1>
      <p className="muted">
        {product.name} ({product.sku}) · {formatVnd(product.priceVnd)} each
        {product.stock !== null && ` · ${product.stock} available`}
      </p>
      <CheckoutForm product={product} />
    </div>
  );
}
