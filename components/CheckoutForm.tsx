"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MAX_QUANTITY, formatVnd, maxOrderableQuantity, type CatalogProduct } from "@/lib/product";
import { useCart } from "./useCart";

type FieldErrors = Partial<Record<"name" | "phone" | "email" | "address" | "lines", string>>;

/**
 * The cart and the delivery form on one page (restyled in T3.6).
 *
 * There is no reference design for checkout — it is built from the same tokens, type and controls
 * as the pages that were copied. The behaviour below is unchanged from before the redesign, and
 * deliberately so:
 *
 * - `catalog` comes from the server, so names, prices and stock are live Sapo values.
 * - The request carries **quantities only**; the server reprices every line. The total here is a
 *   display total.
 * - In development the server names the env vars it could not read (never their values), and that
 *   is surfaced below — it is the fastest way to diagnose a misconfigured `.env.local`.
 * - The cart is not cleared here. That happens on the result page, so a cancelled payment does not
 *   cost the customer their basket.
 */
const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink outline-none focus-visible:border-ink";

export default function CheckoutForm({ catalog }: { catalog: CatalogProduct[] }) {
  const { lines, setQuantity, remove } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const byVariant = new Map(catalog.map((p) => [p.variantId, p]));
  const rows = lines.map((line) => ({ line, product: byVariant.get(line.variantId) }));
  const total = rows.reduce((sum, r) => sum + (r.product ? r.product.priceVnd * r.line.quantity : 0), 0);
  const hasUnavailable = rows.some((r) => r.product === undefined);
  const canPay = rows.length > 0 && !hasUnavailable;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          address: data.get("address"),
          // Quantities only. Sending a price would be ignored: the server prices from Sapo.
          lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
        }),
      });
      const json = (await res.json()) as {
        paymentUrl?: string;
        error?: string;
        fields?: FieldErrors;
        // Development only: names of env vars the server could not read (never values).
        missing?: string[];
        placeholder?: string[];
      };
      if (!res.ok || !json.paymentUrl) {
        setErrors(json.fields ?? {});
        const hints = [
          json.missing?.length ? `Thiếu: ${json.missing.join(", ")}` : undefined,
          json.placeholder?.length ? `Còn là giá trị mẫu: ${json.placeholder.join(", ")}` : undefined,
        ].filter((hint) => hint !== undefined);
        setFormError([json.error ?? "Không khởi tạo được thanh toán.", ...hints].join(" "));
        setSubmitting(false);
        return;
      }
      window.location.assign(json.paymentUrl); // hand off to VNPAY
    } catch {
      setFormError("Lỗi mạng. Vui lòng thử lại.");
      setSubmitting(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="py-10">
        <h2 className="font-display mb-3 text-2xl font-normal">Giỏ hàng đang trống</h2>
        <p className="mb-6 text-sm text-ink-soft">Hãy chọn một sản phẩm trước.</p>
        <Link
          href="/"
          className="inline-block rounded-full bg-primary px-6 py-3 text-sm tracking-wide text-primary-fg uppercase no-underline"
        >
          Xem sản phẩm
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-16">
      <form onSubmit={onSubmit} noValidate className="order-2 lg:order-1">
        <h2 className="font-display mb-6 text-2xl font-normal">Thông tin giao hàng</h2>

        <div className="grid gap-5">
          <div>
            <label htmlFor="name" className="mb-1 block text-xs tracking-wide uppercase">
              Họ và tên
            </label>
            <input id="name" name="name" autoComplete="name" required maxLength={100} className={FIELD_CLASS} />
            {errors.name && <span className="mt-1 block text-xs text-[color:var(--err)]">{errors.name}</span>}
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-xs tracking-wide uppercase">
              Số điện thoại
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="09xxxxxxxx"
              required
              className={FIELD_CLASS}
            />
            {errors.phone && <span className="mt-1 block text-xs text-[color:var(--err)]">{errors.phone}</span>}
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-xs tracking-wide uppercase">
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className={FIELD_CLASS} />
            {errors.email && <span className="mt-1 block text-xs text-[color:var(--err)]">{errors.email}</span>}
          </div>

          <div>
            <label htmlFor="address" className="mb-1 block text-xs tracking-wide uppercase">
              Địa chỉ
            </label>
            <textarea
              id="address"
              name="address"
              autoComplete="street-address"
              rows={2}
              required
              maxLength={255}
              className={FIELD_CLASS}
            />
            {errors.address && <span className="mt-1 block text-xs text-[color:var(--err)]">{errors.address}</span>}
          </div>
        </div>

        {formError && (
          <p className="mt-5 rounded-lg border border-[color:var(--err)] px-4 py-3 text-sm text-[color:var(--err)]">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !canPay}
          className="mt-6 w-full cursor-pointer rounded-full border-0 bg-primary px-6 py-4 text-sm tracking-wide text-primary-fg uppercase disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Đang chuyển tới VNPAY…" : `Thanh toán ${formatVnd(total)} qua VNPAY`}
        </button>
      </form>

      <aside className="order-1 lg:order-2 lg:sticky lg:top-8 lg:self-start">
        <h2 className="font-display mb-6 text-2xl font-normal">Đơn hàng</h2>

        <ul className="m-0 list-none p-0">
          {rows.map(({ line, product }) => {
            if (product === undefined) {
              return (
                <li key={line.variantId} className="flex items-center justify-between gap-4 border-b border-line py-4">
                  <span className="text-sm text-[color:var(--err)]">Sản phẩm này không còn bán</span>
                  <button
                    type="button"
                    onClick={() => remove(line.variantId)}
                    className="cursor-pointer border-0 bg-transparent text-xs underline"
                  >
                    Xoá
                  </button>
                </li>
              );
            }
            const maxQty = Math.max(1, Math.min(MAX_QUANTITY, maxOrderableQuantity(product)));
            return (
              <li key={line.variantId} className="flex gap-4 border-b border-line py-4">
                <div className="h-20 w-20 flex-none overflow-hidden rounded bg-cream">
                  {product.imageUrl !== undefined && (
                    // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
                    <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="m-0 text-sm leading-snug">{product.name}</p>
                    <p className="m-0 font-mono text-sm whitespace-nowrap">
                      {formatVnd(product.priceVnd * line.quantity)}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex items-center rounded-full border border-line">
                      <button
                        type="button"
                        aria-label={`Giảm số lượng ${product.name}`}
                        onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                        className="h-11 w-11 cursor-pointer rounded-full border-0 bg-transparent"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-mono text-sm" aria-live="polite">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Tăng số lượng ${product.name}`}
                        disabled={line.quantity >= maxQty}
                        onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                        className="h-11 w-11 cursor-pointer rounded-full border-0 bg-transparent disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Xoá ${product.name}`}
                      onClick={() => remove(line.variantId)}
                      className="cursor-pointer border-0 bg-transparent text-xs text-ink-soft underline"
                    >
                      Xoá
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm">Tổng cộng</span>
          <span className="font-mono text-lg">{formatVnd(total)}</span>
        </div>

        {errors.lines && <p className="mt-3 text-sm text-[color:var(--err)]">{errors.lines}</p>}
        {hasUnavailable && (
          <p className="mt-3 text-sm text-[color:var(--warn)]">Hãy xoá sản phẩm không còn bán để tiếp tục.</p>
        )}
      </aside>
    </div>
  );
}
