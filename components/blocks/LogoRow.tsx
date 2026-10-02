import Image from "next/image";

import type { BlockImage } from "@/lib/blocks";

/**
 * A wrapping row of logos. Server component — nothing here has state, so it adds no JavaScript.
 *
 * Sizing goes through next/image rather than the query-parameter helpers in ./imageUrl, because
 * from T4 Sanity assets appear on product pages, the busiest pages in the storefront: Next
 * resizes once and caches, so repeat views cost no Sanity asset bandwidth. That also means the
 * bare `url` is passed through untouched — `next.config.ts` pins `search: ""` on cdn.sanity.io,
 * so a URL carrying `?w=…` would be refused.
 *
 * Every logo has required alt text from the schema, so none is announced as an unlabelled image.
 */
export default function LogoRow({
  heading,
  logos,
}: {
  heading?: string | null;
  logos: BlockImage[];
}) {
  if (logos.length === 0) return null;
  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}
      {/* A list, because this is a set of peers rather than running prose. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {logos.map((logo, i) => (
          <li key={`${logo.url}-${i}`} className="flex items-center">
            <Image
              src={logo.url}
              alt={logo.alt}
              width={logo.w}
              height={logo.h}
              sizes="200px"
              /* Height fixed, width free: a tall logo and a wide one then line up optically. */
              className="h-10 w-auto object-contain"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
