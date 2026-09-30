import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import ClearCartOnSuccess from "@/components/ClearCartOnSuccess";
import { getOrder, orderStoreKind, type PendingOrder } from "@/lib/order";
import { formatVnd } from "@/lib/product";
import { describeResponseCode } from "@/lib/vnpay";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const outcome = one(sp.outcome); // from /api/vnpay/return, checksum already verified server-side
  const txnRef = one(sp.txnRef);
  const code = one(sp.code);

  // Server-side order state is authoritative (set only by the IPN).
  let order: PendingOrder | undefined;
  let storeUnavailable = false;
  if (txnRef) {
    try {
      order = await getOrder(txnRef);
    } catch {
      // A store outage must not be reported as "no such order": the payment may well have gone
      // through, and the IPN will retry. Details stay in the server log.
      storeUnavailable = true;
    }
  }
  const waiting = outcome === "success" && (!order || order.status === "pending" || order.status === "processing");

  let headline: string;
  let tone: "ok" | "warn" | "err";
  let detail: string;

  if (outcome === "invalid") {
    headline = "Could not verify the payment response";
    tone = "err";
    detail = "The data returned from VNPAY failed the checksum check. No order was created.";
  } else if (storeUnavailable) {
    headline = "Cannot read the order state right now";
    tone = "warn";
    detail =
      "The order store could not be reached, so this page cannot say what happened yet. If the payment went through, VNPAY's confirmation will still be processed. This page keeps retrying.";
  } else if (order?.status === "completed") {
    headline = "Payment confirmed — order created";
    tone = "ok";
    detail = `VNPAY confirmed the payment and Sapo order ${order.sapoOrder?.name ?? ""} was created.`;
  } else if (order?.status === "sapo_error") {
    headline = "Payment received — order sync pending";
    tone = "warn";
    detail =
      "Your payment was confirmed, but creating the order in Sapo failed. It will be retried automatically when VNPAY re-sends the notification.";
  } else if (outcome === "cancelled" || order?.status === "cancelled") {
    headline = "Payment cancelled";
    tone = "warn";
    detail = "You cancelled the payment at VNPAY. No order was created.";
  } else if (outcome === "failed" || order?.status === "failed") {
    headline = "Payment failed";
    tone = "err";
    detail = `${describeResponseCode(order?.vnpResponseCode ?? code)}. No order was created.`;
  } else if (waiting && order) {
    headline = "Waiting for payment confirmation…";
    tone = "warn";
    detail =
      "VNPAY reported success in the browser. We create the order only after VNPAY's server-to-server confirmation (IPN) arrives.";
  } else {
    headline = "Order not found";
    tone = "err";
    detail =
      orderStoreKind() === "memory"
        ? "This server has no record of the transaction. Orders are kept in memory, so a restart loses them and a second instance never sees them. Check Sapo and the server logs."
        : "The shared store has no record of this transaction, or it has expired. Check Sapo and the server logs.";
  }

  return (
    <div className="card">
      {((waiting && order) || storeUnavailable) && <AutoRefresh />}
      {order?.status === "completed" && <ClearCartOnSuccess />}
      <h1>{headline}</h1>
      <div className={`alert ${tone}`}>{detail}</div>
      <dl className="kv">
        {txnRef && (
          <>
            <dt>Reference</dt>
            <dd>{txnRef}</dd>
          </>
        )}
        {order && (
          <>
            <dt>Items</dt>
            <dd>
              {order.lines.map((line) => (
                <div key={line.sku + String(line.variantId)}>
                  {line.productName} × {line.quantity} — {formatVnd(line.unitPriceVnd * line.quantity)}
                </div>
              ))}
            </dd>
            <dt>Amount</dt>
            <dd>{formatVnd(order.amountVnd)}</dd>
            <dt>Status</dt>
            <dd>{order.status}</dd>
          </>
        )}
        {order?.vnpTransactionNo && (
          <>
            <dt>VNPAY transaction</dt>
            <dd>{order.vnpTransactionNo}</dd>
          </>
        )}
        {order?.sapoOrder && (
          <>
            <dt>Sapo order</dt>
            <dd>{order.sapoOrder.name}</dd>
          </>
        )}
      </dl>
      <p style={{ marginTop: 24 }}>
        <Link href="/">Back to product</Link>
      </p>
    </div>
  );
}
