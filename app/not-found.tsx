import Link from "next/link";

/**
 * The page for an address that does not exist. Until T10 this was Next's own English default, in
 * the one place a customer who followed a stale link or mistyped lands with no other way forward.
 */
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-24">
      <p className="m-0 font-mono text-xs tracking-widest text-ink-soft uppercase">404</p>
      <h1 className="font-display mt-3 mb-4 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">
        Không tìm thấy trang này
      </h1>
      <p className="max-w-[55ch] text-sm leading-relaxed text-ink-soft">
        Đường dẫn có thể đã thay đổi hoặc sản phẩm không còn được bán. Bạn có thể quay lại danh sách sản phẩm, hoặc tra
        cứu một đơn hàng đã đặt.
      </p>
      <p className="mt-8 flex flex-wrap gap-6">
        <Link href="/shop" className="text-sm">
          ← Về trang sản phẩm
        </Link>
        <Link href="/tra-cuu-don" className="text-sm">
          Tra cứu đơn hàng
        </Link>
      </p>
    </div>
  );
}
