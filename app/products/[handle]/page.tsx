import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AddToCartForm from "@/components/AddToCartForm";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getProductByHandle } from "@/lib/catalog";
import { getProductContent, type ProductMeta } from "@/lib/content";
import { errorMessage, log } from "@/lib/log";
import { OPEN_GRAPH } from "@/lib/business";
import { defaultVariant, formatVnd, hasChoice, isSoldOut, isTestProduct, maxOrderableQuantity, productHref, selectVariant } from "@/lib/product";
import { FREE_SHIPPING_THRESHOLD_VND } from "@/lib/shipping";

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
 *
 * **A failed query must never land in here.** getProductContent returns `undefined` for the
 * stable "nothing to show" cases and throws for a CMS that could not answer; an error thrown
 * out of this function leaves the cache untouched, so the next request retries. Swallowing it
 * here instead would write "this product has no description" down for five minutes on the
 * strength of one timeout — which is what happened on 2026-10-02, to a page whose owner had
 * just published it.
 */
const cachedProductContent = unstable_cache(
  async (productId: number) => (await getProductContent(productId)) ?? null,
  ["product-content"],
  { revalidate: 300, tags: ["product-content"] },
);

/**
 * The short facts beside the price. Local to this page rather than a block, because the buy box
 * draws these rows in this order and nowhere else — a block would be draggable to the bottom of
 * the description, where it means nothing.
 *
 * A row whose value is missing is dropped entirely. Rendering the label with nothing after it
 * would read, to a screen reader, as a term with no definition.
 */
function MetaRows({ meta }: { meta: ProductMeta | null }) {
  if (meta === null) return null;
  const rows: Array<[string, string]> = [];
  if (meta.teaType) rows.push(["Loại trà", meta.teaType]);
  if (meta.caffeine) rows.push(["Caffeine", meta.caffeine]);
  if (meta.tastingNotes) rows.push(["Hương vị", meta.tastingNotes]);
  if (meta.perfectFor) rows.push(["Hợp với", meta.perfectFor]);
  if (rows.length === 0) return null;
  return (
    <dl className="mb-6 grid gap-3 border-t border-line pt-4">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <dt className="m-0 text-[11px] tracking-widest text-ink-soft uppercase">{label}</dt>
          <dd className="m-0 text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Params = Promise<{ handle: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params;
  try {
    const product = await getProductByHandle(handle);
    // The page is the same product whatever size is selected, so every ?Size= address names the
    // plain one as canonical: sizes are one page to a search engine, not four.
    if (product) {
      // The variant the sitemap lists, so the canonical and the sitemap entry are one address.
      const first = defaultVariant(product);
      const description = first.description?.slice(0, 160);
      return {
        title: product.name,
        description,
        alternates: { canonical: productHref(first) },
        // The shop's own test products stay reachable by link but are kept out of search (T12, question 6).
        ...(isTestProduct(product.name) ? { robots: { index: false, follow: true } } : {}),
        openGraph: {
          ...OPEN_GRAPH,
          title: product.name,
          description,
          ...(first.imageUrl ? { images: [first.imageUrl] } : {}),
        },
      };
    }
  } catch {
    // A Sapo outage must not break the page's own error handling; fall through to the default.
  }
  return {};
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { handle } = await params;
  const query = await searchParams;

  let group;
  try {
    group = await getProductByHandle(handle);
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="mx-auto max-w-[1416px] px-4 py-16">
        <h1 className="font-display text-3xl">Không đọc được sản phẩm</h1>
        <p className="mt-3 text-sm text-ink-soft">Sapo đang không phản hồi. Vui lòng thử lại sau.</p>
        <Link href="/shop" className="mt-6 inline-block text-sm text-ink">
          ← Về trang sản phẩm
        </Link>
      </div>
    );
  }

  if (group === null) notFound();

  // Which size the page shows. A link that names a size we do not have (renamed, mistyped,
  // truncated) opens the default one instead of a 404 — see selectVariant.
  const product = selectVariant(group, handle, query);
  const choice = hasChoice(group);
  const soldOut = isSoldOut(product);
  // A CMS outage must not stop a sale, so it is caught — but caught *here*, outside the cache,
  // so the failure is never recorded as an answer. The page falls back to Sapo's own
  // description below, and the next request asks Sanity again rather than inheriting a
  // five-minute hole.
  let content: Awaited<ReturnType<typeof cachedProductContent>> = null;
  try {
    content = await cachedProductContent(product.productId);
  } catch (err) {
    log.warn("product_content.unavailable", {
      productId: product.productId,
      error: errorMessage(err),
    });
  }
  const meta = content?.meta ?? null;
  const blocks = content?.blocks ?? [];

  return (
    <div className="mx-auto w-full max-w-[1416px] px-4 lg:px-10">
      <nav aria-label="Breadcrumb" className="py-4 text-xs">
        <ol className="m-0 flex list-none flex-wrap gap-1 p-0">
          <li>
            <Link href="/shop" className="text-ink no-underline hover:underline">
              Shop
            </Link>
          </li>
          <li aria-hidden="true" className="text-ink-soft">
            /
          </li>
          <li className="font-medium">{product.name}</li>
        </ol>
      </nav>

      {/* Two equal columns at desktop: image left, details right. One column below that. */}
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        {/* The reference shows four images in a 2×2 grid here. Sapo returns one image per product,
            so this is a single frame; a Sanity imageSlider block carries any others in the content
            section below. */}
        <div className="aspect-square overflow-hidden rounded-sm bg-placeholder">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xs text-ink-soft">Chưa có ảnh</span>
          )}
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="m-0 text-[11px] tracking-widest uppercase text-ink-soft">SKU {product.sku}</p>
          <h1 className="m-0 mt-2 mb-6 text-[clamp(1.875rem,3.2vw,3rem)] leading-[1.3] font-normal">
            {product.name}
          </h1>

          {/* "Quy cách" is hidden when sizes exist: the picker already says it, and the two would
              contradict each other (the field says 50g while the button says 95g). */}
          {meta?.servings && !choice ? (
            <p className="m-0 -mt-4 mb-4 text-sm text-ink-soft">{meta.servings}</p>
          ) : null}
          {meta?.summary ? (
            <p className="m-0 mb-6 max-w-[55ch] text-sm leading-relaxed">{meta.summary}</p>
          ) : null}

          <MetaRows meta={meta} />

          {meta?.benefits && meta.benefits.length > 0 ? (
            <div className="mb-6">
              <p className="m-0 mb-2 text-[11px] tracking-widest text-ink-soft uppercase">Lợi ích</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {meta.benefits.map((b, i) => (
                  <li
                    key={`${b}-${i}`}
                    className="rounded-sm bg-primary px-3 py-1 text-[11px] tracking-wide text-primary-fg uppercase"
                  >
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {choice && (
            <fieldset className="m-0 mb-6 min-w-0 border-0 p-0">
              <legend className="mb-2 p-0 text-[11px] tracking-widest text-ink-soft uppercase">
                {product.optionName ?? "Lựa chọn"}: <span className="text-ink">{product.variantLabel}</span>
              </legend>
              {/* Links, not buttons: each size is its own address, so a size can be shared and the
                  picker works with no script. A sold-out size is drawn but is not a link. */}
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {group.variants.map((v) => {
                  const selected = v.variantId === product.variantId;
                  const out = isSoldOut(v);
                  const cls = `inline-block rounded-sm border px-4 py-2 text-sm font-medium no-underline ${
                    selected ? "border-primary bg-primary text-primary-fg" : "border-line text-ink"
                  } ${out ? "cursor-not-allowed opacity-40" : "hover:border-ink"}`;
                  return (
                    <li key={v.variantId}>
                      {out ? (
                        <span aria-disabled="true" className={`${cls} line-through`}>
                          {v.variantLabel} <span className="sr-only">(hết hàng)</span>
                        </span>
                      ) : (
                        <Link
                          href={productHref(v, { pickVariant: true })}
                          scroll={false}
                          aria-current={selected ? "true" : undefined}
                          className={cls}
                        >
                          {v.variantLabel}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <p className="m-0 text-[30px] leading-[34px] tabular-nums">
            {formatVnd(product.priceVnd)}
            {product.compareAtPriceVnd !== undefined && (
              <span className="ml-3 text-base text-ink-soft line-through">
                {formatVnd(product.compareAtPriceVnd)}
              </span>
            )}
          </p>
          {/* Concrete, because this line used to promise a calculation that did not exist. The
              threshold is read from lib/shipping.ts, so the page cannot drift from what is charged. */}
          <p className="mt-2 text-xs text-ink-soft">
            Phí vận chuyển tính theo tỉnh/thành khi thanh toán — miễn phí với đơn từ{" "}
            {formatVnd(FREE_SHIPPING_THRESHOLD_VND)}.
          </p>

          {product.stock !== null && (
            <p className={`mt-4 font-mono text-xs ${soldOut ? "text-[color:var(--err)]" : "text-[color:var(--ok)]"}`}>
              {soldOut ? "Hết hàng" : `Còn ${product.stock} ${product.unit ?? ""}`.trim()}
            </p>
          )}

          {/* Keyed by variant so the quantity stepper starts again at 1 when the size changes. */}
          <AddToCartForm
            key={product.variantId}
            variantId={product.variantId}
            soldOut={soldOut}
            max={maxOrderableQuantity(product)}
          />

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
        {blocks.length > 0 ? (
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
