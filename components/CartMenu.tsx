"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_QUANTITY, formatVnd, maxOrderableQuantity, type DisplayProduct } from "@/lib/product";
import { useCart } from "./useCart";

/**
 * The header cart button and its drawer (T3.5), kept in one component so they can share open
 * state without a context or a store — the button is the only thing that opens the drawer.
 *
 * Product names, prices and thumbnails come from /api/catalog, fetched the first time the drawer
 * opens. The cart itself still holds only `{variantId, quantity}`: the browser never stores a
 * price, and `/api/checkout` recomputes every amount from Sapo regardless of what is shown here.
 *
 * The reference drawer also has a discount-code field. There is no discount system behind this
 * project, so it is left out rather than drawn as something that cannot work.
 */
type CatalogEntry = Pick<DisplayProduct, "name" | "priceVnd" | "imageUrl" | "stock"> & {
  variantId: number;
  href: string;
};

export default function CartMenu() {
  const { lines, count, setQuantity, remove } = useCart();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Loaded lazily: most page views never open the cart.
  useEffect(() => {
    if (!open || catalog !== null || failed) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/catalog");
        if (!res.ok) throw new Error(String(res.status));
        const body: { products: CatalogEntry[] } = await res.json();
        if (!cancelled) setCatalog(body.products);
      } catch {
        // Sapo is unreachable. Quantities still render; names and prices simply do not.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, catalog, failed]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus(); // return focus to what opened the drawer
  }, []);

  // Escape closes, Tab stays inside, and the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || panelRef.current === null) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  const find = (variantId: number) => catalog?.find((p) => p.variantId === variantId);
  const subtotal = lines.reduce((sum, l) => sum + (find(l.variantId)?.priceVnd ?? 0) * l.quantity, 0);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="cursor-pointer border-0 bg-transparent p-0 font-body text-[12px] tracking-wider uppercase text-ink"
      >
        {/* Zero on the server and until hydration reads storage, which is the truth as far as the server knows. */}
        Cart ({count})
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Dimmed page behind. A plain button so a click anywhere outside closes the drawer. */}
          <button
            type="button"
            aria-label="Đóng giỏ hàng"
            onClick={close}
            className="absolute inset-0 cursor-default border-0 bg-ink/40 p-0"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Giỏ hàng"
            className="relative flex h-full w-full max-w-[510px] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between px-6 py-5">
              <h2 className="m-0 font-body text-lg font-semibold">Giỏ hàng</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Đóng giỏ hàng"
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-xl"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6">
              {lines.length === 0 && <p className="text-sm text-ink-soft">Giỏ hàng đang trống.</p>}

              {failed && lines.length > 0 && (
                <p className="mb-4 text-sm text-ink-soft">
                  Không đọc được tên và giá sản phẩm lúc này. Số lượng vẫn đúng.
                </p>
              )}

              <ul className="m-0 list-none p-0">
                {lines.map((line) => {
                  const product = find(line.variantId);
                  const max = product ? maxOrderableQuantity(product) : MAX_QUANTITY;
                  return (
                    <li key={line.variantId} className="flex gap-4 py-4">
                      <div className="h-24 w-24 flex-none overflow-hidden rounded bg-cream">
                        {product?.imageUrl !== undefined && (
                          // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
                          <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="m-0 text-sm leading-snug">
                            {product ? (
                              <Link href={product.href} onClick={close} className="no-underline">
                                {product.name}
                              </Link>
                            ) : (
                              <span className="text-ink-soft">Sản phẩm #{line.variantId}</span>
                            )}
                          </p>
                          {product && (
                            <p className="m-0 font-mono text-sm whitespace-nowrap">
                              {formatVnd(product.priceVnd * line.quantity)}
                            </p>
                          )}
                        </div>

                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex items-center rounded-full border border-line">
                            <button
                              type="button"
                              onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                              aria-label="Giảm số lượng"
                              className="h-11 w-11 cursor-pointer rounded-full border-0 bg-transparent"
                            >
                              −
                            </button>
                            <span className="w-8 text-center font-mono text-sm" aria-live="polite">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                              disabled={line.quantity >= max}
                              aria-label="Tăng số lượng"
                              className="h-11 w-11 cursor-pointer rounded-full border-0 bg-transparent disabled:opacity-40"
                            >
                              +
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => remove(line.variantId)}
                            aria-label="Xoá khỏi giỏ"
                            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-line bg-transparent"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {lines.length > 0 && (
              <div className="border-t border-line px-6 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm">Tổng phụ</span>
                  <span className="font-mono text-sm">{failed ? "—" : formatVnd(subtotal)}</span>
                </div>
                <Link
                  href="/checkout"
                  onClick={close}
                  className="block rounded-full bg-primary px-6 py-4 text-center text-sm text-primary-fg no-underline"
                >
                  Tiếp tục thanh toán
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
