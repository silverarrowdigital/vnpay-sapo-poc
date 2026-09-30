"use client";

import { useState, type FormEvent } from "react";
import { formatVnd, maxOrderableQuantity, type DisplayProduct } from "@/lib/product";

type FieldErrors = Partial<Record<"name" | "phone" | "email" | "address" | "quantity" | "sku", string>>;

export default function CheckoutForm({ product }: { product: DisplayProduct }) {
  const maxQty = maxOrderableQuantity(product);
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

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
          sku: product.sku,
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          address: data.get("address"),
          quantity: Number(data.get("quantity")),
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
      window.location.assign(json.paymentUrl); // hand off to VNPAY
    } catch {
      setFormError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
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
      <div className="field">
        <label htmlFor="quantity">Quantity</label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          min={1}
          max={maxQty}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))}
        />
        {product.stock !== null && <span className="hint">Max {maxQty} per order</span>}
        {errors.quantity && <span className="error">{errors.quantity}</span>}
      </div>
      <div className="summary">
        <span>Total</span>
        <span>{formatVnd(product.priceVnd * quantity)}</span>
      </div>
      {formError && <div className="alert err">{formError}</div>}
      <button className="btn" type="submit" disabled={submitting}>
        {submitting ? "Redirecting to VNPAY…" : "Pay with VNPAY"}
      </button>
    </form>
  );
}
