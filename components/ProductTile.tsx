import Link from "next/link";
import { defaultVariant, formatVnd, isGroupSoldOut, priceRange, productHref, type ProductGroup } from "@/lib/product";

/**
 * One product tile for the home page and the shop (T12.2): image, name, price. One tile per Sapo
 * *product* — it shows the variant a visitor would land on, and the link opens the product page,
 * where the sizes are. Quantity and adding to the cart live there too.
 *
 * Rendered on the server from live Sapo data, so price and stock are never stale.
 */
/**
 * `priority` is for the tiles at the top of the page: they are what the browser measures as the page
 * loading (LCP), and `loading="lazy"` on them made /shop take 3.2 s on a throttled phone (Lighthouse,
 * 2026-10-07). Everything below the fold stays lazy.
 */
export default function ProductTile({
  group,
  priority = false,
  headingLevel = 3,
}: {
  group: ProductGroup;
  priority?: boolean;
  /** The name's heading level: 2 where the page's h1 is directly above the grid (/shop), 3 under a section h2 (home). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const product = defaultVariant(group);
  const soldOut = isGroupSoldOut(group);
  const { fromVnd, varies } = priceRange(group);

  return (
    <Link href={productHref(product)} className="group grid content-start gap-4 text-ink no-underline">
      <div className="relative aspect-square overflow-hidden rounded-sm bg-placeholder">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
          <img
            src={product.imageUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-ink-soft">No image</span>
        )}
        {soldOut && (
          <span className="absolute top-3 left-3 rounded-sm bg-ink px-3 py-1 text-[11px] tracking-wide text-page uppercase">
            Hết hàng
          </span>
        )}
      </div>
      <Heading className="m-0 line-clamp-2 text-[22px] leading-[30px] font-normal group-hover:underline">{product.name}</Heading>
      <p className="m-0 border-t border-line pt-4 text-xl leading-[26px] tabular-nums">
        {varies && <span className="mr-1">Từ</span>}
        {formatVnd(varies ? fromVnd : product.priceVnd)}
        {!varies && product.compareAtPriceVnd !== undefined && (
          <span className="ml-2 text-ink-soft line-through">{formatVnd(product.compareAtPriceVnd)}</span>
        )}
      </p>
    </Link>
  );
}
