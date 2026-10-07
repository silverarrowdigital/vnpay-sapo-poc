import type { Metadata } from "next";
import OrderLookup from "@/components/OrderLookup";
import { TXN_REF_PATTERN, normaliseTxnRef } from "@/lib/vnpay";

export const dynamic = "force-dynamic"; // an order's status must never be served from a cache

export const metadata: Metadata = {
  title: "Tra cứu đơn hàng",
  description: "Xem lại đơn hàng bằng mã đơn và số điện thoại đã đặt.",
  // Nothing here should be indexed: the page exists to show one person their own order.
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The page a customer lands on when the confirmation tab is long closed.
 *
 * The reference is prefilled from the query string when the result page linked here, but the phone
 * number never is — a link that carries both halves of the key would turn a shared URL into a
 * shared address book.
 */
export default async function OrderLookupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.txnRef) ? sp.txnRef[0] : sp.txnRef;
  const initialRef = typeof raw === "string" && TXN_REF_PATTERN.test(normaliseTxnRef(raw)) ? normaliseTxnRef(raw) : "";

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-16">
      <h1 className="font-display mb-4 text-[clamp(2rem,5vw,3rem)] leading-tight font-normal">Tra cứu đơn hàng</h1>
      <p className="no-print mb-10 max-w-[48ch] text-sm text-ink-soft">
        Nhập mã đơn hàng trên trang xác nhận cùng số điện thoại bạn đã dùng để đặt. Không cần tạo tài khoản.
      </p>
      <OrderLookup initialRef={initialRef} />
    </div>
  );
}
