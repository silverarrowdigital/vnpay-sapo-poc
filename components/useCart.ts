"use client";
/**
 * Cart state, kept in the browser. Only `{variantId, quantity}` is ever stored or sent — the server
 * resolves every price from Sapo (see startCheckout), so nothing here can influence what is charged.
 *
 * localStorage is an external store, so it is read through useSyncExternalStore rather than copied
 * into state in an effect: that is what makes the server's HTML and hydration agree without a
 * "mounted" flag. The server snapshot is an empty cart, which is the truth as far as the server
 * knows. Every access is guarded because localStorage can be absent or throw (private windows,
 * blocked site data); the cart then simply starts empty and is not remembered.
 */
import { useCallback, useSyncExternalStore } from "react";
import { MAX_CART_LINES, MAX_QUANTITY, type CartLine } from "@/lib/product";

const STORAGE_KEY = "vnpay-sapo-cart";
/** Fired on this tab after a write; the `storage` event only reaches other tabs. */
const CHANGE_EVENT = "vnpay-sapo-cart-change";

function parse(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const lines: CartLine[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const { variantId, quantity } = item as Partial<CartLine>;
      if (typeof variantId !== "number" || !Number.isSafeInteger(variantId) || variantId <= 0) continue;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) continue;
      lines.push({ variantId, quantity: Math.min(quantity, MAX_QUANTITY) });
    }
    return lines.slice(0, MAX_CART_LINES);
  } catch {
    return [];
  }
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const EMPTY: CartLine[] = [];

/**
 * useSyncExternalStore compares snapshots by identity and re-renders whenever they differ, so the
 * parsed value is cached against the raw string it came from. Returning a fresh array every call
 * would loop forever.
 */
let snapshot: { raw: string | null; lines: CartLine[] } = { raw: null, lines: EMPTY };

function getSnapshot(): CartLine[] {
  const raw = readRaw();
  if (raw !== snapshot.raw) snapshot = { raw, lines: parse(raw) };
  return snapshot.lines;
}

function getServerSnapshot(): CartLine[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Nothing to do: the cart stays correct for this page view and is simply not remembered.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useCart() {
  const lines = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const add = useCallback((variantId: number, quantity = 1) => {
    const current = parse(readRaw());
    const existing = current.find((l) => l.variantId === variantId);
    if (existing) {
      existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + quantity);
      write([...current]);
      return;
    }
    if (current.length >= MAX_CART_LINES) return;
    write([...current, { variantId, quantity: Math.min(MAX_QUANTITY, Math.max(1, quantity)) }]);
  }, []);

  const setQuantity = useCallback((variantId: number, quantity: number) => {
    const current = parse(readRaw());
    if (quantity < 1) {
      write(current.filter((l) => l.variantId !== variantId));
      return;
    }
    write(current.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(MAX_QUANTITY, quantity) } : l)));
  }, []);

  const remove = useCallback((variantId: number) => {
    write(parse(readRaw()).filter((l) => l.variantId !== variantId));
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  return { lines, count, add, setQuantity, remove, clear };
}
