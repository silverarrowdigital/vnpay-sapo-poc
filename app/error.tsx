"use client";

import Link from "next/link";

/**
 * Shown when a page throws while rendering. Next 16 hands the boundary `retry` (not the older
 * `reset`): it re-fetches and re-renders the segment, which is what a customer who hit a Sapo blip
 * actually wants. `error.digest` is an opaque id that matches a line in the server log; the message
 * itself is hidden by Next so nothing internal reaches the page, and is not printed here either.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-24">
      <h1 className="font-display mb-4 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">
        Có lỗi xảy ra
      </h1>
      <p className="max-w-[55ch] text-sm leading-relaxed text-ink-soft">
        Trang này tạm thời không tải được. Nếu bạn đang thanh toán, đừng thanh toán lại: hãy thử tải lại, hoặc dùng mã
        giao dịch để tra cứu đơn.
      </p>
      <p className="mt-8 flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={() => retry()}
          className="cursor-pointer rounded-full border border-line bg-transparent px-5 py-2 text-sm"
        >
          Thử lại
        </button>
        <Link href="/shop" className="text-sm">
          ← Về trang sản phẩm
        </Link>
        <Link href="/tra-cuu-don" className="text-sm">
          Tra cứu đơn hàng
        </Link>
      </p>
      {error.digest !== undefined && (
        <p className="mt-10 font-mono text-xs text-ink-soft">Mã lỗi: {error.digest}</p>
      )}
    </div>
  );
}
