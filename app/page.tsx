import Link from "next/link";
import { getDisplayProducts } from "@/lib/catalog";
import { errorMessage, log } from "@/lib/log";
import { formatVnd, isSoldOut, productHref } from "@/lib/product";

export const dynamic = "force-dynamic"; // stock and price must never be served stale

/**
 * Catalog page, rebuilt to the reference design (T3.3).
 *
 * Geometry is measured, not guessed: the reference grid is three 328px columns with a 16px gap,
 * found by scanning the screenshot for tile edges — hence the 1016px container. Colours come
 * from the @theme tokens in globals.css, which were sampled from the same screenshots.
 *
 * Two deliberate departures from the reference, both because the data does not exist here:
 *
 * - **No filter sidebar.** The reference reserves a wide left column for facets
 *   (`tra_ngon`, `cong_dung`, `tea_by_hour` in its markup); its own screenshot shows that column
 *   empty, which is why its grid sits off-centre. Sapo gives this project no facets, so the grid
 *   is centred instead of being pushed right by an empty rail.
 * - **The sort control is presentation only.** Drawn so the page matches; wiring it to an actual
 *   ordering is its own piece of work, not part of copying the layout.
 */
export default async function CatalogPage() {
  let products;
  try {
    products = await getDisplayProducts();
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
    return (
      <div className="card">
        <h1>Catalog unavailable</h1>
        <p className="alert err">
          Could not read products from Sapo. Check <code>SAPO_*</code> in <code>.env.local</code> and the server log.
        </p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="card">
        <h1>No products yet</h1>
        <p className="alert warn">
          Sapo returned no active product. Add one in Sapo admin, or check that its status is
          <code> active</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1016px] px-4">
      <h1 className="font-display mt-10 mb-16 text-center text-[clamp(2.75rem,8vw,5.5rem)] leading-[1.05] font-normal text-ink">
        Shop Tất Cả Sản Phẩm
      </h1>

      {/* Sort row + hairline, as in the reference. Not wired to an ordering — see the note above. */}
      <div className="flex items-center justify-end gap-2 pb-4 text-sm text-ink">
        <span>Sắp xếp theo:</span>
        <span className="font-medium">Nổi bật</span>
      </div>
      <hr className="mb-10 border-0 border-t border-line" />

      <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const soldOut = isSoldOut(product);
          return (
            <li key={product.variantId}>
              {/* The whole tile is the link; quantity and adding to the cart live on the product page. */}
              <Link href={productHref(product)} className="group block no-underline">
                <div className="relative aspect-square overflow-hidden rounded-xl bg-cream">
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote Sapo CDN, no loader configured
                    <img
                      src={product.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xs text-ink-soft">
                      No image
                    </span>
                  )}

                  {soldOut && (
                    <span className="absolute top-3 left-3 rounded-full bg-ink px-3 py-1 font-mono text-[11px] tracking-wide text-white uppercase">
                      Hết hàng
                    </span>
                  )}
                </div>

                {/* Price above the name, as in the reference. */}
                <p className="mt-4 mb-1 font-mono text-sm text-ink">
                  {formatVnd(product.priceVnd)}
                  {product.compareAtPriceVnd !== undefined && (
                    <span className="ml-2 text-ink-soft line-through">{formatVnd(product.compareAtPriceVnd)}</span>
                  )}
                </p>
                <p className="font-display line-clamp-2 text-xl leading-snug text-ink">{product.name}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
