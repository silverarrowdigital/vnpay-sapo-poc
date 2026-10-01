import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AddToCartForm from "@/components/AddToCartForm";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getProductByHandle } from "@/lib/catalog";
import { getProductContent } from "@/lib/content";
import { errorMessage, log } from "@/lib/log";
import { formatVnd, isSoldOut, maxOrderableQuantity } from "@/lib/product";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

/**
 * CMS content is cached even though the page is force-dynamic, and the two are not in conflict:
 * force-dynamic is about price and stock, which must be read from Sapo on every request. A
 * product description changes when somebody edits it, so re-reading it per request would add a
 * network round trip to every page view for nothing.
 *
 * `unstable_cache` and not `use cache`: the latter needs the project-wide `cacheComponents` flag,
 * and turning that on is a migration of every route in the app (see
 * node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md) — far more than
 * this feature should carry. This is the documented route for a project on the previous model.
 *
 * It lives at module scope because the cache is keyed per wrapper; building one per render would
 * cache nothing. And it returns `null` rather than `undefined` because the cache serialises its
 * value, and "absent" has to survive that round trip.
 *
 * Cost of the 5-minute window: new content takes up to that long to appear, and a stale entry
 * survives a dev-server restart — clear `.next` if content will not budge. See CLAUDE.md.
 */
const cachedProductContent = unstable_cache(
  async (productId: number) => (await getProductContent(productId)) ?? null,
  ["product-content"],
  { revalidate: 300, tags: ["product-content"] },
);

type Params = Promise<{ handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params;
  try {
    const product = await getProductByHandle(handle);
    if (product) return { title: `${product.name} — VNPAY → Sapo PoC` };
  } catch {
    // A Sapo outage must not break the page's own error handling; fall through to the default.
  }
  return {};
}

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { handle } = await params;

  let product;
  try {
    product = await getProductByHandle(handle);
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="mx-auto max-w-[1416px] px-4 py-16">
        <h1 className="font-display text-3xl">Không đọc được sản phẩm</h1>
        <p className="mt-3 text-sm text-ink-soft">Sapo đang không phản hồi. Vui lòng thử lại sau.</p>
        <Link href="/" className="mt-6 inline-block text-sm">
          ← Về trang sản phẩm
        </Link>
      </div>
    );
  }

  if (product === null) notFound();

  const soldOut = isSoldOut(product);
  // Never throws: lib/content.ts turns an unconfigured, unreachable or empty CMS into null, and
  // the page falls back to Sapo's own description below. A CMS outage must not stop a sale.
  const blocks = await cachedProductContent(product.productId);

  return (
    <div className="mx-auto w-full max-w-[1416px] px-4">
      <nav aria-label="Breadcrumb" className="py-4 text-xs">
        <ol className="m-0 flex list-none flex-wrap gap-1 p-0">
          <li>
            <Link href="/" className="no-underline hover:underline">
              Trang chủ
            </Link>
          </li>
          <li aria-hidden="true" className="text-ink-soft">
            /
          </li>
          <li className="font-medium">{product.name}</li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-16">
        {/* Reference shows a multi-image grid. Sapo returns one image per product, so this grid
            holds a single cell until the store has more; a Sanity imageSlider block can carry the
            rest in the content section below. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="aspect-square overflow-hidden rounded-xl bg-cream sm:col-span-2">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
              <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs text-ink-soft">
                Chưa có ảnh
              </span>
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="m-0 text-[11px] tracking-widest uppercase text-ink-soft">SKU {product.sku}</p>
          <h1 className="font-display mt-2 mb-6 text-[clamp(2rem,4vw,3rem)] leading-[1.1] font-normal">
            {product.name}
          </h1>

          <p className="m-0 font-mono text-xl">
            {formatVnd(product.priceVnd)}
            {product.compareAtPriceVnd !== undefined && (
              <span className="ml-3 text-base text-ink-soft line-through">
                {formatVnd(product.compareAtPriceVnd)}
              </span>
            )}
          </p>
          <p className="mt-2 text-xs text-ink-soft">Phí vận chuyển được tính khi thanh toán.</p>

          {product.stock !== null && (
            <p className={`mt-4 font-mono text-xs ${soldOut ? "text-[color:var(--err)]" : "text-primary"}`}>
              {soldOut ? "Hết hàng" : `Còn ${product.stock} ${product.unit ?? ""}`.trim()}
            </p>
          )}

          <AddToCartForm variantId={product.variantId} soldOut={soldOut} max={maxOrderableQuantity(product)} />

          {/* The reference shows third-party payment marks here; this project only takes VNPAY, so
              it says so in words rather than borrowing anyone's brand assets. */}
          <p className="mt-6 text-xs text-ink-soft">Thanh toán an toàn qua VNPAY.</p>
        </div>
      </div>

      <section className="mt-20">
        <h2 className="font-display mb-6 text-[clamp(1.75rem,3vw,2.5rem)] font-normal">Mô tả sản phẩm</h2>
        {/* Sapo's description is HTML; it is stripped to text server-side rather than rendered, so
            nothing a product's content contains can execute on this page. Shown only when the CMS
            has nothing for this product — blocks supersede it. */}
        {blocks !== null ? (
          <BlockRenderer blocks={blocks} />
        ) : product.description ? (
          <p className="max-w-[65ch] text-sm leading-relaxed">{product.description}</p>
        ) : (
          <p className="text-sm text-ink-soft">Chưa có mô tả cho sản phẩm này.</p>
        )}
      </section>
    </div>
  );
}
