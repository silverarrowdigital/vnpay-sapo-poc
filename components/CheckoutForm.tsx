"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MAX_QUANTITY, formatVnd, maxOrderableQuantity, type CatalogProduct } from "@/lib/product";
import { useCart } from "./useCart";

type FieldErrors = Partial<Record<"name" | "phone" | "email" | "address" | "lines", string>>;

/**
 * The cart and the delivery form on one page.
 *
 * `catalog` comes from the server so names, prices and stock are the live Sapo values; the cart
 * itself lives in the browser. The total shown here is only a display total — the request carries
 * quantities alone and the server recomputes the amount it charges.
 */
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
          json.missing?.length ? `Missing: ${json.missing.join(", ")}` : undefined,
          json.placeholder?.length ? `Still a placeholder: ${json.placeholder.join(", ")}` : undefined,
        ].filter((hint) => hint !== undefined);
        setFormError([json.error ?? "Could not start payment.", ...hints].join(" "));
        setSubmitting(false);
        return;
      }
      // The cart is left alone on purpose: it is cleared on the result page once the payment is
      // confirmed, so a cancelled payment does not cost the customer their basket.
      window.location.assign(json.paymentUrl); // hand off to VNPAY
    } catch {
      setFormError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <h2>Your cart is empty</h2>
        <p className="muted">Add a product first.</p>
        <Link className="btn" href="/">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2>Your cart</h2>
        <ul className="cart-lines">
          {rows.map(({ line, product }) => {
            if (product === undefined) {
              return (
                <li className="cart-line gone" key={line.variantId}>
                  <span className="cart-name">This product is no longer available</span>
                  <button className="link-btn" type="button" onClick={() => remove(line.variantId)}>
                    Remove
                  </button>
                </li>
              );
            }
            const maxQty = Math.max(1, Math.min(MAX_QUANTITY, maxOrderableQuantity(product)));
            return (
              <li className="cart-line" key={line.variantId}>
                <span className="cart-name">
                  {product.name}
                  <span className="muted"> · {formatVnd(product.priceVnd)}</span>
                </span>
                <span className="cart-qty">
                  <button
                    className="step"
                    type="button"
                    aria-label={`Decrease quantity of ${product.name}`}
                    onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={maxQty}
                    step={1}
                    value={line.quantity}
                    aria-label={`Quantity of ${product.name}`}
                    onChange={(e) =>
                      setQuantity(line.variantId, Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))
                    }
                  />
                  <button
                    className="step"
                    type="button"
                    aria-label={`Increase quantity of ${product.name}`}
                    disabled={line.quantity >= maxQty}
                    onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                  >
                    +
                  </button>
                </span>
                <span className="cart-sum">{formatVnd(product.priceVnd * line.quantity)}</span>
                <button
                  className="link-btn"
                  type="button"
                  aria-label={`Remove ${product.name}`}
                  onClick={() => remove(line.variantId)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <div className="summary">
          <span>Total</span>
          <span>{formatVnd(total)}</span>
        </div>
        {errors.lines && <div className="alert err">{errors.lines}</div>}
        {hasUnavailable && <div className="alert warn">Remove the unavailable product to continue.</div>}
      </div>

      <form className="form card" onSubmit={onSubmit} noValidate>
        <h2>Delivery details</h2>
        <div className="field">
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" autoComplete="name" required maxLength={100} />
          {errors.name && <span className="error">{errors.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="09xxxxxxxx" required />
          {errors.phone && <span className="error">{errors.phone}</span>}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          {errors.email && <span className="error">{errors.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="address">Address</label>
          <textarea id="address" name="address" autoComplete="street-address" rows={2} required maxLength={255} />
          {errors.address && <span className="error">{errors.address}</span>}
        </div>
        {formError && <div className="alert err">{formError}</div>}
        <button className="btn" type="submit" disabled={submitting || !canPay}>
          {submitting ? "Redirecting to VNPAY…" : `Pay ${formatVnd(total)} with VNPAY`}
        </button>
      </form>
    </>
  );
}
