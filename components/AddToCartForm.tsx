"use client";
import Link from "next/link";
import { useState } from "react";
import { useCart } from "./useCart";

/**
 * Quantity picker plus the add button, for a product's own page. An out-of-stock product still
 * renders — disabled — so the customer can see it exists rather than wondering where it went.
 *
 * `max` is the server's view of what stock allows. The server checks it again at checkout, so this
 * only saves the customer a rejected payment attempt.
 */
export default function AddToCartForm({
  variantId,
  soldOut,
  max,
}: {
  variantId: number;
  soldOut: boolean;
  max: number;
}) {
  const { lines, add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (soldOut) {
    return (
      <button className="btn sold-out" type="button" disabled>
        Out of stock
      </button>
    );
  }

  const inCart = lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
  const room = Math.max(0, max - inCart);
  const capped = Math.min(quantity, Math.max(1, room));

  return (
    <div className="add-form">
      <div className="qty">
        <label htmlFor="qty">Quantity</label>
        <div className="cart-qty">
          <button
            className="step"
            type="button"
            aria-label="Decrease quantity"
            disabled={capped <= 1}
            onClick={() => setQuantity(Math.max(1, capped - 1))}
          >
            −
          </button>
          <input
            id="qty"
            type="number"
            min={1}
            max={Math.max(1, room)}
            step={1}
            value={capped}
            onChange={(e) => setQuantity(Math.max(1, Math.min(Math.max(1, room), Number(e.target.value) || 1)))}
          />
          <button
            className="step"
            type="button"
            aria-label="Increase quantity"
            disabled={capped >= room}
            onClick={() => setQuantity(Math.min(room, capped + 1))}
          >
            +
          </button>
        </div>
      </div>

      <button
        className="btn"
        type="button"
        disabled={room === 0}
        onClick={() => {
          add(variantId, capped);
          setAdded(true);
          window.setTimeout(() => setAdded(false), 1600);
        }}
      >
        {room === 0 ? `Max ${max} already in cart` : added ? "Added ✓" : "Add to cart"}
      </button>

      {inCart > 0 && (
        <p className="muted">
          {inCart} already in your cart · <Link href="/checkout">go to checkout</Link>
        </p>
      )}
    </div>
  );
}
