"use client";
import Link from "next/link";
import { useCart } from "./useCart";

/** Header link to the cart, hidden while the cart is empty. */
export default function CartBadge() {
  const { count } = useCart();
  // Zero on the server and until hydration reads storage, so the badge simply appears then.
  if (count === 0) return null;
  return (
    <Link className="cart-badge" href="/checkout" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
      <span aria-hidden="true">🛒</span>
      <span className="cart-count">{count}</span>
    </Link>
  );
}
