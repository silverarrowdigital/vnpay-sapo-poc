"use client";
import { useEffect } from "react";
import { useCart } from "./useCart";

/**
 * Empties the cart once the order is confirmed. Deliberately not done at checkout time: a payment
 * the customer cancels should leave the basket intact, so the cart survives until an order exists.
 */
export default function ClearCartOnSuccess() {
  const { clear, count } = useCart();
  useEffect(() => {
    if (count > 0) clear();
  }, [count, clear]);
  return null;
}
