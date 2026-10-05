import CheckoutForm from "@/components/CheckoutForm";
import { getDisplayProducts } from "@/lib/catalog";
import { getDiscountsEnabled } from "@/lib/config";
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
      <div className="mx-auto max-w-[1416px] px-4 py-16">
        <h1 className="font-display text-3xl font-normal">Chưa thanh toán được</h1>
        <p className="mt-3 text-sm text-ink-soft">Không đọc được sản phẩm từ Sapo. Vui lòng thử lại sau.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1416px] px-4 py-10">
      <h1 className="font-display mb-10 text-[clamp(2rem,5vw,3.5rem)] leading-tight font-normal">Thanh toán</h1>
      {/* Read on the server: the switch is an env var, and the form must not have to ask for it. */}
      <CheckoutForm catalog={catalog} discountsEnabled={getDiscountsEnabled()} />
    </div>
  );
}
