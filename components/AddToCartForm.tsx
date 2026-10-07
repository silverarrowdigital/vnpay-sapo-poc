"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "./useCart";

/**
 * Quantity stepper, "add to cart" and "buy now", for a product's own page (T3.4).
 *
 * Laid out like the reference: a pill stepper beside an outlined add button, then a full-width
 * filled primary button below. An out-of-stock product still renders — disabled — so the customer
 * can see it exists rather than wondering where it went.
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
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (soldOut) {
    return (
      <button
        type="button"
        disabled
        className="mt-8 w-full cursor-not-allowed rounded-sm border border-line bg-transparent px-6 py-4 text-sm tracking-wide uppercase opacity-60"
      >
        Hết hàng
      </button>
    );
  }

  const inCart = lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
  const room = Math.max(0, max - inCart);
  const capped = Math.min(quantity, Math.max(1, room));
  const full = room === 0;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="flex items-center rounded-sm border border-line">
          <button
            type="button"
            aria-label="Giảm số lượng"
            disabled={capped <= 1}
            onClick={() => setQuantity(Math.max(1, capped - 1))}
            className="h-12 w-12 cursor-pointer rounded-sm border-0 bg-transparent text-lg disabled:opacity-40"
          >
            −
          </button>
          <span className="w-10 text-center font-mono text-sm" aria-live="polite">
            {capped}
          </span>
          <button
            type="button"
            aria-label="Tăng số lượng"
            disabled={capped >= room}
            onClick={() => setQuantity(Math.min(room, capped + 1))}
            className="h-12 w-12 cursor-pointer rounded-sm border-0 bg-transparent text-lg disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          type="button"
          disabled={full}
          onClick={() => {
            add(variantId, capped);
            setAdded(true);
            window.setTimeout(() => setAdded(false), 1600);
          }}
          className="flex-1 cursor-pointer rounded-sm border border-ink bg-transparent px-6 text-sm tracking-wide uppercase disabled:cursor-not-allowed disabled:opacity-50"
        >
          {full ? `Đã có tối đa ${max} trong giỏ` : added ? "Đã thêm ✓" : "Thêm vào giỏ hàng"}
        </button>
      </div>

      <button
        type="button"
        disabled={full}
        onClick={() => {
          add(variantId, capped);
          router.push("/checkout");
        }}
        className="mt-3 w-full cursor-pointer rounded-sm border-0 bg-primary px-6 py-4 text-sm tracking-wide text-primary-fg uppercase disabled:cursor-not-allowed disabled:opacity-50"
      >
        Mua ngay
      </button>

      {inCart > 0 && <p className="mt-3 text-xs text-ink-soft">Đang có {inCart} trong giỏ.</p>}
    </div>
  );
}
