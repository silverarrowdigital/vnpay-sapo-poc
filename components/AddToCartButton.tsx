"use client";
import { useState } from "react";
import { useCart } from "./useCart";

/**
 * Adds one unit of a variant to the cart. Out-of-stock products render a disabled button instead
 * of being hidden, so the customer can see the product exists.
 */
export default function AddToCartButton({
  variantId,
  soldOut,
  max,
}: {
  variantId: number;
  soldOut: boolean;
  /** Largest quantity stock allows, so the button stops rather than silently capping. */
  max: number;
}) {
  const { lines, add } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  if (soldOut) {
    return (
      <button className="btn sold-out" type="button" disabled>
        Out of stock
      </button>
    );
  }

  const inCart = lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
  const atMax = inCart >= max;

  return (
    <button
      className="btn"
      type="button"
      disabled={atMax}
      onClick={() => {
        add(variantId);
        setJustAdded(true);
        window.setTimeout(() => setJustAdded(false), 1200);
      }}
    >
      {atMax ? `Max ${max} in cart` : justAdded ? "Added ✓" : inCart > 0 ? `Add another (${inCart})` : "Add to cart"}
    </button>
  );
}
