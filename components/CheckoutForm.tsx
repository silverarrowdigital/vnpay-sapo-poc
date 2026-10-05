"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_COD_TOTAL_VND,
  MAX_QUANTITY,
  formatVnd,
  maxOrderableQuantity,
  type CatalogProduct,
} from "@/lib/product";
import AddressSelects, { type AddressSelection } from "./AddressSelects";
import { FIELD_CLASS, FIELD_ERROR_CLASS } from "./formField";
import { useCart } from "./useCart";

type FieldErrors = Partial<
  Record<
    "name" | "phone" | "email" | "address" | "provinceId" | "districtId" | "wardId" | "discountCode" | "lines",
    string
  >
>;

/** What /api/quote returns: the same numbers /api/checkout will charge. */
interface Quote {
  goodsVnd: number;
  discount?: { code: string; amountVnd: number; summary: string };
  shipping: { title: string; feeVnd: number; listFeeVnd: number; isFree: boolean; zoneLabel: string };
  totalVnd: number;
}

type PaymentMethod = "vnpay" | "cod";

/**
 * The cart and the delivery form on one page.
 *
 * Three things here are load-bearing and should not be "simplified":
 *
 * - **The total shown comes from the server** (`/api/quote`), not from arithmetic in the browser.
 *   The delivery fee depends on the chosen province and the discount depends on a Sapo price rule,
 *   so a second implementation here would be a second answer — and the one the customer reads is
 *   the one they expect to be charged. Before a province is chosen there is deliberately **no**
 *   total: the page says the fee is calculated once the address is known rather than promising a
 *   number it cannot produce.
 * - **The request carries a discount *code*, never an amount.** `/api/checkout` re-verifies the
 *   code against Sapo and recomputes the money. Editing anything in this component changes the
 *   display and nothing else.
 * - The cart is not cleared here. That happens on the result page, so a cancelled payment does not
 *   cost the customer their basket.
 *
 * In development the server also names the env vars it could not read (never their values), which
 * is the fastest way to diagnose a misconfigured `.env.local`.
 */
export default function CheckoutForm({
  catalog,
  discountsEnabled = true,
}: {
  catalog: CatalogProduct[];
  /** False hides the code box entirely. The server refuses codes either way; this is the UI half. */
  discountsEnabled?: boolean;
}) {
  const { lines, setQuantity, remove } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressSelection>({});
  const [method, setMethod] = useState<PaymentMethod>("vnpay");

  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [quote, setQuote] = useState<Quote | undefined>(undefined);
  const [quoting, setQuoting] = useState(false);

  const byVariant = new Map(catalog.map((p) => [p.variantId, p]));
  const rows = lines.map((line) => ({ line, product: byVariant.get(line.variantId) }));
  const goodsTotal = rows.reduce((sum, r) => sum + (r.product ? r.product.priceVnd * r.line.quantity : 0), 0);
  const hasUnavailable = rows.some((r) => r.product === undefined);
  // Province and ward only: the district is not part of the test because AddressSelects enforces
  // the chain — the ward select stays disabled until its parent is settled, so a chosen ward already
  // implies a chosen district wherever Sapo still has one. Requiring districtId here would block
  // checkout on a two-tier province, which is the case this is meant to survive.
  const addressComplete = address.provinceId !== undefined && address.wardId !== undefined;

  // COD is capped on the final total. Derived rather than corrected in an effect: if the basket
  // grows past the ceiling while COD is selected, `payWith` falls back to card on the spot — no
  // cascading render, and no window where the button says COD and the request asks for something
  // else. The server enforces the same ceiling; this only saves the customer a refused submit.
  const codAllowed = quote === undefined || quote.totalVnd <= MAX_COD_TOTAL_VND;
  const payWith: PaymentMethod = codAllowed ? method : "vnpay";
  const canPay = rows.length > 0 && !hasUnavailable && addressComplete;

  /** The cart as the API wants it: quantities only. */
  const cartPayload = lines.map(({ variantId, quantity }) => ({ variantId, quantity }));
  const cartKey = JSON.stringify(cartPayload);

  // Re-quote when the cart, the province or the applied code changes. Debounced, because the
  // quantity steppers fire several times while a customer holds the button down and each quote is
  // a Sapo read.
  const quoteSeq = useRef(0);
  const refreshQuote = useCallback(
    async (code: string | undefined) => {
      if (address.provinceId === undefined) {
        setQuote(undefined);
        return;
      }
      const seq = ++quoteSeq.current;
      setQuoting(true);
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: JSON.parse(cartKey), provinceId: address.provinceId, discountCode: code }),
        });
        const json = (await res.json()) as Quote & { error?: string; fields?: FieldErrors; needsProvince?: boolean };
        if (seq !== quoteSeq.current) return; // a newer quote is already in flight
        if (!res.ok) {
          // A refused code must not leave a stale discount on screen: drop it and say why.
          if (json.fields?.discountCode ?? json.error) setCodeError(json.fields?.discountCode ?? json.error ?? null);
          if (code !== undefined) setAppliedCode(undefined);
          setQuote(undefined);
          return;
        }
        if (json.needsProvince) {
          setQuote(undefined);
          return;
        }
        setQuote(json);
        setCodeError(null);
      } catch {
        if (seq === quoteSeq.current) setQuote(undefined);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    },
    [address.provinceId, cartKey],
  );

  useEffect(() => {
    const t = setTimeout(() => void refreshQuote(appliedCode), 300);
    return () => clearTimeout(t);
  }, [refreshQuote, appliedCode]);

  function applyCode(e: FormEvent) {
    e.preventDefault();
    const code = codeInput.trim();
    setCodeError(null);
    if (code === "") {
      setAppliedCode(undefined);
      return;
    }
    if (address.provinceId === undefined) {
      setCodeError("Hãy chọn địa chỉ giao hàng trước để tính được đơn hàng.");
      return;
    }
    setAppliedCode(code);
  }

  function clearCode() {
    setCodeInput("");
    setAppliedCode(undefined);
    setCodeError(null);
  }

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
          provinceId: address.provinceId,
          districtId: address.districtId,
          wardId: address.wardId,
          paymentMethod: payWith,
          // A code, never an amount: the server decides what it is worth.
          discountCode: appliedCode,
          // Quantities only. Sending a price would be ignored: the server prices from Sapo.
          lines: cartPayload,
        }),
      });
      const json = (await res.json()) as {
        paymentUrl?: string;
        successUrl?: string;
        error?: string;
        fields?: FieldErrors;
        // Development only: names of env vars the server could not read (never values).
        missing?: string[];
        placeholder?: string[];
      };
      if (!res.ok || !(json.paymentUrl ?? json.successUrl)) {
        setErrors(json.fields ?? {});
        if (json.fields?.discountCode) setCodeError(json.fields.discountCode);
        const hints = [
          json.missing?.length ? `Thiếu: ${json.missing.join(", ")}` : undefined,
          json.placeholder?.length ? `Còn là giá trị mẫu: ${json.placeholder.join(", ")}` : undefined,
        ].filter((hint) => hint !== undefined);
        setFormError([json.error ?? "Không khởi tạo được đơn hàng.", ...hints].join(" "));
        setSubmitting(false);
        return;
      }
      // VNPAY: hand off to the gateway. COD: the order already exists, go to the result page.
      window.location.assign(json.paymentUrl ?? (json.successUrl as string));
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

  const payLabel =
    payWith === "cod"
      ? quote !== undefined
        ? `Đặt hàng — thu ${formatVnd(quote.totalVnd)} khi nhận`
        : "Đặt hàng (thanh toán khi nhận)"
      : quote !== undefined
        ? `Thanh toán ${formatVnd(quote.totalVnd)} qua VNPAY`
        : "Thanh toán qua VNPAY";

  // Two equal columns at desktop: delivery form left, order summary right.
  return (
    <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
      <form onSubmit={onSubmit} noValidate className="order-2 lg:order-1">
        <h2 className="font-display mb-6 text-2xl font-normal">Thông tin giao hàng</h2>

        <div className="grid gap-5">
          <div>
            <label htmlFor="name" className="mb-1 block text-xs tracking-wide uppercase">
              Họ và tên
            </label>
            <input id="name" name="name" autoComplete="name" required maxLength={100} className={FIELD_CLASS} />
            {errors.name && <span className={FIELD_ERROR_CLASS}>{errors.name}</span>}
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
            {errors.phone && <span className={FIELD_ERROR_CLASS}>{errors.phone}</span>}
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-xs tracking-wide uppercase">
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className={FIELD_CLASS} />
            {errors.email && <span className={FIELD_ERROR_CLASS}>{errors.email}</span>}
          </div>

          <AddressSelects value={address} onChange={setAddress} errors={errors} />

          <div>
            <label htmlFor="address" className="mb-1 block text-xs tracking-wide uppercase">
              Số nhà, đường
            </label>
            <textarea
              id="address"
              name="address"
              autoComplete="street-address"
              rows={2}
              required
              maxLength={255}
              placeholder="Ví dụ: 14/8 Lam Sơn"
              className={FIELD_CLASS}
            />
            {errors.address && <span className={FIELD_ERROR_CLASS}>{errors.address}</span>}
          </div>
        </div>

        <h2 className="font-display mt-10 mb-4 text-2xl font-normal">Thanh toán</h2>
        <div className="grid gap-3">
          {(
            [
              { id: "vnpay", title: "Thẻ / Chuyển khoản qua VNPAY", hint: "Trả trước, đơn được xác nhận ngay." },
              {
                id: "cod",
                title: "Thanh toán khi nhận hàng (COD)",
                hint: `Trả tiền mặt cho người giao hàng. Áp dụng cho đơn đến ${formatVnd(MAX_COD_TOTAL_VND)}.`,
              },
            ] as const
          ).map((option) => {
            const disabled = option.id === "cod" && !codAllowed;
            return (
              <label
                key={option.id}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                  disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                } ${payWith === option.id ? "border-ink" : "border-line"}`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={option.id}
                  checked={payWith === option.id}
                  disabled={disabled}
                  onChange={() => setMethod(option.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm">{option.title}</span>
                  <span className="block text-xs text-ink-soft">
                    {disabled ? `Đơn này vượt ${formatVnd(MAX_COD_TOTAL_VND)} — hãy thanh toán qua VNPAY.` : option.hint}
                  </span>
                </span>
              </label>
            );
          })}
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
          {submitting ? (payWith === "cod" ? "Đang tạo đơn…" : "Đang chuyển tới VNPAY…") : payLabel}
        </button>
        {!addressComplete && rows.length > 0 && (
          <p className="mt-3 text-center text-xs text-ink-soft">
            Chọn đủ tỉnh/thành, quận/huyện và phường/xã để tính phí vận chuyển.
          </p>
        )}
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

        {discountsEnabled && (
        <div className="mt-5 border-b border-line pb-5">
          <label htmlFor="discountCode" className="mb-1 block text-xs tracking-wide uppercase">
            Mã giảm giá
          </label>
          <div className="flex gap-2">
            <input
              id="discountCode"
              name="discountCode"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                // The form around it belongs to the delivery details; Enter here must apply the
                // code, not submit the checkout.
                if (e.key === "Enter") applyCode(e);
              }}
              maxLength={64}
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Nhập mã nếu có"
              className={FIELD_CLASS}
            />
            <button
              type="button"
              onClick={applyCode}
              className="cursor-pointer rounded-lg border border-ink bg-transparent px-5 text-sm whitespace-nowrap"
            >
              Áp dụng
            </button>
          </div>
          {codeError && <span className={FIELD_ERROR_CLASS}>{codeError}</span>}
          {quote?.discount !== undefined && (
            <p className="mt-2 flex items-center justify-between gap-3 text-xs text-[color:var(--ok)]">
              <span>
                Đã áp dụng <strong>{quote.discount.code}</strong> — {quote.discount.summary}
              </span>
              <button
                type="button"
                onClick={clearCode}
                className="cursor-pointer border-0 bg-transparent text-xs text-ink-soft underline"
              >
                Bỏ
              </button>
            </p>
          )}
        </div>
        )}

        <dl className="m-0 mt-5 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
          <dt className="m-0">Tạm tính</dt>
          <dd className="m-0 font-mono text-right">{formatVnd(quote?.goodsVnd ?? goodsTotal)}</dd>

          {quote?.discount !== undefined && (
            <>
              <dt className="m-0">Giảm giá</dt>
              <dd className="m-0 font-mono text-right text-[color:var(--ok)]">
                −{formatVnd(quote.discount.amountVnd)}
              </dd>
            </>
          )}

          <dt className="m-0">Phí vận chuyển</dt>
          <dd className="m-0 font-mono text-right">
            {quote === undefined ? (
              <span className="text-ink-soft">Chọn địa chỉ</span>
            ) : quote.shipping.isFree ? (
              <span>
                <span className="mr-2 text-ink-soft line-through">{formatVnd(quote.shipping.listFeeVnd)}</span>
                Miễn phí
              </span>
            ) : (
              formatVnd(quote.shipping.feeVnd)
            )}
          </dd>
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm">Tổng cộng</span>
          <span className="font-mono text-lg" aria-live="polite">
            {quote !== undefined ? formatVnd(quote.totalVnd) : quoting ? "đang tính…" : "—"}
          </span>
        </div>

        {errors.lines && <p className="mt-3 text-sm text-[color:var(--err)]">{errors.lines}</p>}
        {hasUnavailable && (
          <p className="mt-3 text-sm text-[color:var(--warn)]">Hãy xoá sản phẩm không còn bán để tiếp tục.</p>
        )}
      </aside>
    </div>
  );
}
