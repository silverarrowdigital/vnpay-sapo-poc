"use client";

import { useState, type FormEvent } from "react";
import { formatVnd } from "@/lib/product";
import { FIELD_CLASS, FIELD_ERROR_CLASS } from "./formField";

interface OrderDetail {
  id: number;
  name: string;
  createdOn?: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  status?: string;
  totalVnd: number;
  shippingVnd: number;
  discountVnd: number;
  lines: { title: string; variantTitle?: string; sku?: string; quantity: number; priceVnd: number }[];
  address?: { address1?: string; ward?: string; district?: string; province?: string };
}

const FINANCIAL_LABEL: Record<string, string> = {
  paid: "Đã thanh toán",
  pending: "Chưa thanh toán",
  partially_paid: "Đã thanh toán một phần",
  refunded: "Đã hoàn tiền",
  voided: "Đã huỷ thanh toán",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Đang xử lý",
  closed: "Đã hoàn tất",
  cancelled: "Đã huỷ",
};

/**
 * Tra cứu đơn hàng: order reference plus the phone number on the order.
 *
 * No account, because this shop has none — and that is exactly why the server treats a wrong phone
 * number and a non-existent reference identically. This component must not undo that: it shows the
 * single message the server returns and never says which half was wrong.
 *
 * The result doubles as the printable slip (T7.7). `window.print()` on the same markup is enough
 * because `app/globals.css` has a `@media print` block that drops the header, the footer and every
 * control marked `.no-print` — so there is no second route holding a copy of the order, and
 * therefore no second URL to guess.
 */
export default function OrderLookup({ initialRef = "" }: { initialRef?: string }) {
  const [txnRef, setTxnRef] = useState(initialRef);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | undefined>(undefined);
  const [method, setMethod] = useState<"vnpay" | "cod" | undefined>(undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOrder(undefined);
    try {
      const res = await fetch("/api/order-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnRef, phone }),
      });
      const json = (await res.json()) as { order?: OrderDetail; paymentMethod?: "vnpay" | "cod"; error?: string };
      if (!res.ok || json.order === undefined) {
        setError(json.error ?? "Không tra cứu được.");
        return;
      }
      setOrder(json.order);
      setMethod(json.paymentMethod);
    } catch {
      setError("Lỗi mạng. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="no-print grid max-w-[480px] gap-5">
        <div>
          <label htmlFor="txnRef" className="mb-1 block text-xs tracking-wide uppercase">
            Mã đơn hàng
          </label>
          <input
            id="txnRef"
            name="txnRef"
            value={txnRef}
            onChange={(e) => setTxnRef(e.target.value)}
            required
            inputMode="numeric"
            maxLength={40}
            placeholder="Dãy số trên trang xác nhận đơn"
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="lookupPhone" className="mb-1 block text-xs tracking-wide uppercase">
            Số điện thoại đặt hàng
          </label>
          <input
            id="lookupPhone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            autoComplete="tel"
            placeholder="09xxxxxxxx"
            className={FIELD_CLASS}
          />
          {error && <span className={FIELD_ERROR_CLASS}>{error}</span>}
        </div>
        <button
          type="submit"
          disabled={loading || txnRef.trim() === "" || phone.trim() === ""}
          className="cursor-pointer rounded-full border-0 bg-primary px-6 py-4 text-sm tracking-wide text-primary-fg uppercase disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Đang tra cứu…" : "Tra cứu đơn hàng"}
        </button>
      </form>

      {order !== undefined && (
        <section className="print-slip mt-12 rounded-lg border border-line p-6">
          <header className="slip-block mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
            <div>
              <h2 className="font-display m-0 text-2xl font-normal">Đơn hàng {order.name}</h2>
              {order.createdOn !== undefined && (
                <p className="m-0 mt-1 text-xs text-ink-soft">
                  Đặt ngày{" "}
                  {new Date(order.createdOn).toLocaleString("vi-VN", {
                    dateStyle: "long",
                    timeStyle: "short",
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="no-print cursor-pointer rounded-full border border-ink bg-transparent px-5 py-2 text-xs tracking-wide uppercase"
            >
              In đơn hàng
            </button>
          </header>

          <dl className="slip-block m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-soft">Thanh toán</dt>
            <dd className="m-0">
              {FINANCIAL_LABEL[order.financialStatus ?? ""] ?? order.financialStatus ?? "—"}
              {method === "cod" && " — thu khi nhận hàng (COD)"}
              {method === "vnpay" && " — qua VNPAY"}
            </dd>
            <dt className="text-ink-soft">Trạng thái đơn</dt>
            <dd className="m-0">{STATUS_LABEL[order.status ?? ""] ?? order.status ?? "—"}</dd>
            {order.address !== undefined && (
              <>
                <dt className="text-ink-soft">Giao tới</dt>
                <dd className="m-0">
                  {[order.address.address1, order.address.ward, order.address.district, order.address.province]
                    .filter((part) => part !== undefined && part !== "")
                    .join(", ")}
                </dd>
              </>
            )}
          </dl>

          <ul className="slip-block mt-6 m-0 list-none p-0">
            {order.lines.map((line, i) => (
              <li key={`${line.sku ?? line.title}-${i}`} className="flex justify-between gap-4 border-b border-line py-3 text-sm">
                <span>
                  {line.title}
                  {line.variantTitle && ` (${line.variantTitle})`} × {line.quantity}
                  {line.sku !== undefined && <span className="ml-2 font-mono text-xs text-ink-soft">{line.sku}</span>}
                </span>
                <span className="font-mono whitespace-nowrap">{formatVnd(line.priceVnd * line.quantity)}</span>
              </li>
            ))}
          </ul>

          <dl className="slip-block m-0 mt-4 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            {order.discountVnd > 0 && (
              <>
                <dt className="m-0">Giảm giá</dt>
                <dd className="m-0 text-right font-mono">−{formatVnd(order.discountVnd)}</dd>
              </>
            )}
            <dt className="m-0">Phí vận chuyển</dt>
            <dd className="m-0 text-right font-mono">
              {order.shippingVnd === 0 ? "Miễn phí" : formatVnd(order.shippingVnd)}
            </dd>
            <dt className="m-0 border-t border-line pt-2 font-semibold">Tổng cộng</dt>
            <dd className="m-0 border-t border-line pt-2 text-right font-mono text-base">
              {formatVnd(order.totalVnd)}
            </dd>
          </dl>

          <p className="slip-block mt-6 m-0 text-xs text-ink-soft">
            Phiếu này là phiếu đặt hàng, không phải hoá đơn giá trị gia tăng. Nếu bạn cần hoá đơn VAT, hãy liên hệ shop.
          </p>
        </section>
      )}
    </>
  );
}
