import type { Metadata } from "next";
import ProductTile from "@/components/ProductTile";
import { OPEN_GRAPH } from "@/lib/business";
import { getListedProducts } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

export const metadata: Metadata = {
  title: "Shop Tất Cả Sản Phẩm",
  description: "Toàn bộ sản phẩm trà của The Hour Tea.",
  alternates: { canonical: "/shop" },
  openGraph: { ...OPEN_GRAPH, title: "Shop Tất Cả Sản Phẩm", url: "/shop" },
};

/**
 * The catalog (T12.2) — what the home page was until the design's landing page took that place.
 * One tile per Sapo product, three columns, the shop's own test products left out of the list.
 *
 * The design's sort control is not drawn: nothing would order the list, and a control that does
 * nothing is worse than none (the previous catalog page drew one for fidelity; this one does not).
 */
export default async function ShopPage() {
  let products;
  try {
    products = await getListedProducts();
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="mx-auto w-full max-w-[1016px] px-4 py-16">
        <h1 className="m-0 text-[clamp(2rem,3.6vw,3rem)] leading-[1.3] font-normal">Chưa tải được sản phẩm</h1>
        <p className="mt-4 text-ink-soft">
          Hệ thống đang tạm thời không đọc được danh sách sản phẩm. Vui lòng thử lại sau ít phút.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1416px] px-4 lg:px-10">
      <div className="py-[clamp(48px,5vw,96px)]">
        <h1 className="m-0 text-[clamp(2.125rem,3.6vw,3rem)] leading-[1.3] font-normal">Shop Tất Cả Sản Phẩm</h1>
      </div>
      <hr className="mb-12 border-0 border-t border-line" />

      {products.length === 0 ? (
        <p className="pb-24 text-ink-soft">Cửa hàng chưa có sản phẩm nào đang bán. Vui lòng quay lại sau.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-x-12 gap-y-16 p-0 pb-[clamp(64px,6vw,112px)] min-[520px]:grid-cols-2 lg:grid-cols-3">
          {products.map((group) => (
            <li key={group.productId}>
              <ProductTile group={group} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
