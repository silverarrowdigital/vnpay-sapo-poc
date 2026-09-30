import CheckoutForm from "@/components/CheckoutForm";
import { getDisplayProducts } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

/**
 * The catalog is read here, on the server, and handed to the form: the cart in the browser holds
 * only variant ids and quantities, so names, prices and stock must come from Sapo on every load.
 * Nothing is checked out from these numbers — /api/checkout prices the order again.
 */
export default async function CheckoutPage() {
  let catalog;
  try {
    catalog = await getDisplayProducts();
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="card">
        <h1>Checkout unavailable</h1>
        <p className="alert err">Could not read products from Sapo. Please try again later.</p>
      </div>
    );
  }

  return (
    <>
      <h1>Checkout</h1>
      <CheckoutForm catalog={catalog} />
    </>
  );
}
