import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import ProductTile from "@/components/ProductTile";
import { listPosts } from "@/lib/blog";
import { getListedProducts } from "@/lib/catalog";
import {
  BEST_SELLER_COUNT,
  BEST_SELLER_PRODUCT_IDS,
  HOME,
  MARQUEE_WORDS,
  PARTNER_LOGOS,
  SHOW_HEALTH_CLAIMS,
} from "@/lib/home";
import { errorMessage, log } from "@/lib/log";
import { isGroupSoldOut, type ProductGroup } from "@/lib/product";

export const dynamic = "force-dynamic"; // the best-seller prices and stock must never be served stale

/**
 * The landing page (T12.2), drawn from design/site-v3/index.html. The catalog moved to /shop.
 *
 * Every photograph in the design is a grey box, and none has been supplied, so the same boxes are
 * drawn here (`PH`) and become images when files arrive. The two sections that carry a claim the
 * shop has not signed off (health benefits) or an asset it has not supplied (partner logos) are
 * switched in lib/home.ts and not drawn until then.
 *
 * Two data sources, two failure modes — the same split the rest of the site uses. Sapo is the
 * source of prices, so a Sapo failure shows the best-seller strip as unavailable rather than an
 * old price; Sanity only supplies the journal, so a CMS failure just leaves that section out.
 */

const PH = "block w-full rounded-sm bg-placeholder";
const H2 = "m-0 text-[clamp(2rem,3.4vw,3rem)] leading-[1.3] font-normal";
const BTN =
  "inline-flex min-h-[52px] items-center justify-center rounded-sm bg-primary px-6 py-4 text-sm leading-5 font-medium tracking-wide text-primary-fg uppercase no-underline hover:brightness-105";
const LINK = "text-inherit text-sm leading-5 font-medium tracking-wide uppercase no-underline";

/** Two newest posts for "Nhâm nhi và đọc"; cached like the blog (an hour, cleared by the webhook). */
const cachedLatestPosts = unstable_cache(async () => (await listPosts({ page: 1, perPage: 2 })).posts, ["home-journal"], {
  revalidate: 3600,
  tags: ["blog"],
});

function pickBestSellers(listed: ProductGroup[]): ProductGroup[] {
  const chosen = BEST_SELLER_PRODUCT_IDS.map((id) => listed.find((g) => g.productId === id)).filter(
    (g): g is ProductGroup => g !== undefined,
  );
  if (chosen.length > 0) return chosen.slice(0, BEST_SELLER_COUNT);
  return listed.filter((g) => !isGroupSoldOut(g)).slice(0, BEST_SELLER_COUNT);
}

export default async function HomePage() {
  let bestSellers: ProductGroup[] | null = null;
  try {
    bestSellers = pickBestSellers(await getListedProducts());
  } catch (err) {
    log.error("catalog.unavailable", { error: errorMessage(err) });
  }

  let posts: Awaited<ReturnType<typeof cachedLatestPosts>> = [];
  try {
    posts = await cachedLatestPosts();
  } catch (err) {
    log.warn("home.journal_unavailable", { error: errorMessage(err) });
  }

  return (
    <>
      {/* Hero: two colour fields and a scrim stand in for the photograph. The header floats over it. */}
      <section
        aria-labelledby="hero-title"
        className="relative isolate grid min-h-[clamp(560px,46vw,880px)] place-items-center px-[clamp(16px,5vw,96px)] pt-[120px] pb-16 text-center text-white sm:pt-[140px]"
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 grid grid-cols-2">
          <div className="bg-hero-a" />
          <div className="bg-hero-b" />
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(0_0_0/16%)_0%,rgb(0_0_0/34%)_40%,rgb(0_0_0/34%)_65%,rgb(0_0_0/52%)_100%)]"
        />
        <div className="grid max-w-[720px] justify-items-center gap-6">
          <h1 id="hero-title" className="m-0 text-[clamp(2.25rem,4vw,3rem)] leading-[1.2] font-normal">
            {HOME.heroTitle[0]}
            <br />
            {HOME.heroTitle[1]}
          </h1>
          <Link href="/shop" className={BTN}>
            Shop Now
          </Link>
        </div>
      </section>

      {/* Marquee: the list is repeated four times and slid by a quarter, so the loop has no seam. */}
      <section aria-label="Từ khoá của The Hour" tabIndex={0} className="marquee overflow-hidden border-y border-line">
        <div className="marquee-track flex w-max">
          {[0, 1, 2, 3].map((n) => (
            <ul key={n} aria-hidden={n > 0 ? "true" : undefined} className="m-0 flex shrink-0 list-none gap-12 p-6">
              {MARQUEE_WORDS.map((w) => (
                <li key={w} className="text-[22px] leading-[30px] whitespace-nowrap">
                  {w}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>

      <section aria-labelledby="new-season" className="bg-ink text-page">
        <div className="mx-auto grid items-center gap-8 px-[clamp(16px,5vw,96px)] py-12 min-[760px]:grid-cols-2 min-[760px]:gap-16">
          <div role="img" aria-label="Sản phẩm mới" className={`${PH} aspect-[3/4] max-w-[560px] justify-self-center bg-placeholder-dark`} />
          <div className="grid max-w-[520px] justify-items-start gap-4">
            <h2 id="new-season" className={H2}>
              {HOME.newSeason.title}
            </h2>
            <p className="m-0">{HOME.newSeason.text}</p>
            <Link href="/shop" className={`${LINK} border-b border-page/20 pb-0.5`}>
              {HOME.newSeason.cta}
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="best-sellers" className="px-[clamp(16px,5vw,96px)] py-[clamp(64px,6vw,112px)]">
        <h2 id="best-sellers" className={`${H2} mb-14`}>
          Các sản phẩm bán chạy
        </h2>
        {bestSellers === null ? (
          <p className="m-0 text-ink-soft">Chưa tải được sản phẩm. Vui lòng thử lại sau ít phút.</p>
        ) : bestSellers.length === 0 ? (
          <p className="m-0 text-ink-soft">Cửa hàng chưa có sản phẩm nào đang bán.</p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-x-8 gap-y-12 p-0 min-[520px]:grid-cols-2 lg:grid-cols-4">
            {bestSellers.map((g, i) => (
              // The design staggers the four columns downward; only on a wide screen, where there are four.
              <li key={g.productId} className={["", "lg:pt-16", "lg:pt-32", "lg:pt-48"][i] ?? ""}>
                <ProductTile group={g} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-16 flex justify-center">
          <Link href="/shop" className={BTN}>
            Shop Tất Cả Sản Phẩm
          </Link>
        </div>
      </section>

      <section aria-labelledby="promo" className="border-t border-page/20 bg-ink text-page">
        <div className="mx-auto grid items-center gap-8 px-[clamp(16px,5vw,96px)] py-12 min-[760px]:grid-cols-2 min-[760px]:gap-16">
          <div role="img" aria-label="Ưu đãi" className={`${PH} aspect-[2/3] max-w-[560px] justify-self-center bg-placeholder-dark min-[760px]:order-2`} />
          <div className="grid max-w-[520px] justify-items-start gap-4">
            <h2 id="promo" className={H2}>
              {HOME.promo.title}
            </h2>
            <p className="m-0">{HOME.promo.text}</p>
            <Link href="/shop" className={`${LINK} border-b border-page/20 pb-0.5`}>
              {HOME.promo.cta}
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="origin-title" className="relative">
        <div className="grid min-h-[clamp(480px,48vw,920px)] grid-cols-1 min-[760px]:grid-cols-3">
          <div role="img" aria-label="Nghệ nhân trà" className="min-h-[220px] bg-placeholder" />
          <div aria-hidden="true" className="min-h-[220px] bg-placeholder-2" />
          <div aria-hidden="true" className="min-h-[220px] bg-placeholder-3" />
        </div>
        <div className="grid justify-items-start gap-8 bg-page p-[clamp(24px,5vw,64px)] min-[760px]:absolute min-[760px]:top-1/2 min-[760px]:right-[clamp(16px,5vw,96px)] min-[760px]:w-[min(704px,60%)] min-[760px]:-translate-y-1/2">
          <h2 id="origin-title" className={H2}>
            {HOME.origin.title}
          </h2>
          <p className="m-0 text-xl leading-[26px]">{HOME.origin.text}</p>
          <Link href="/ve-chung-toi" className={BTN}>
            Về chúng tôi
          </Link>
        </div>
      </section>

      {SHOW_HEALTH_CLAIMS && (
        <section aria-labelledby="benefits-title" className="border-t border-line px-[clamp(16px,5vw,96px)] py-[clamp(64px,6vw,112px)]">
          <h2 id="benefits-title" className="m-0 mb-12 text-[clamp(1.75rem,2.6vw,2.25rem)] leading-[1.3] font-normal">
            {HOME.benefits.title}
          </h2>
          <div className="grid gap-12 min-[520px]:grid-cols-2 lg:grid-cols-4">
            {HOME.benefits.items.map((b) => (
              <div key={b.title}>
                <h3 className="m-0 mb-3 text-[22px] leading-[30px] font-normal">{b.title}</h3>
                <p className="m-0 text-ink-soft">{b.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {PARTNER_LOGOS.length > 0 && (
        <section aria-label="Những người bạn đồng hành" className="border-t border-line px-[clamp(16px,5vw,96px)] py-12">
          <h2 className="m-0 mb-8 text-[clamp(1.75rem,2.6vw,2.25rem)] leading-[1.3] font-normal">Những người bạn đồng hành</h2>
          <ul className="m-0 flex list-none flex-wrap items-center gap-8 p-0">
            {PARTNER_LOGOS.map((l) => (
              <li key={l.src}>
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size logo, no resizing needed */}
                <img src={l.src} alt={l.alt} className="h-12 w-auto" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="testi-title" className="border-t border-line px-[clamp(16px,5vw,96px)] py-[clamp(64px,6vw,112px)]">
        <h2 id="testi-title" className="m-0 mb-12 text-[clamp(1.75rem,2.6vw,2.25rem)] leading-[1.3] font-normal">
          {HOME.testimonial.title}
        </h2>
        <figure className="m-0 grid max-w-[360px] gap-4">
          <blockquote className="m-0">“{HOME.testimonial.quote}”</blockquote>
          <span role="img" aria-label="5 sao" className="text-sm tracking-[0.15em]">
            ★★★★★
          </span>
          <figcaption className="font-medium">— {HOME.testimonial.author}</figcaption>
        </figure>
      </section>

      {posts.length > 0 && (
        <section aria-labelledby="journal-title" className="px-4 py-[clamp(64px,6vw,112px)] lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[384px_minmax(0,1fr)]">
            <div className="grid content-start justify-items-start gap-6">
              <h2 id="journal-title" className={H2}>
                {HOME.journalTitle}
              </h2>
              <Link href="/blog" className={LINK}>
                Xem tất cả
              </Link>
            </div>
            <ul className="m-0 grid list-none gap-x-8 gap-y-12 p-0 min-[760px]:grid-cols-2">
              {posts.map((post) => (
                <li key={post.slug}>
                  <Link href={`/blog/${post.slug}`} className="group grid content-start gap-4 text-ink no-underline">
                    <div className="relative aspect-[3/2] overflow-hidden rounded-sm bg-placeholder">
                      {post.cover !== null && (
                        <Image
                          src={post.cover.url}
                          alt={post.cover.alt}
                          fill
                          sizes="(min-width: 1024px) 440px, (min-width: 760px) 50vw, 100vw"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <h3 className="m-0 text-[22px] leading-[30px] font-normal group-hover:underline">{post.title}</h3>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
