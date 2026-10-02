import Image from "next/image";

import type { IngredientCard } from "@/lib/blocks";

/**
 * What is in the cup and what each part brings. Server component.
 *
 * The benefits stay a `<ul>` rather than being joined into a sentence: they are a set of peers,
 * and a list is what tells a screen reader how many there are and where each one ends.
 *
 * Images go through next/image for the reason given in LogoRow — Sanity asset bandwidth counts
 * against the free plan, and these sit on product pages.
 */
export default function IngredientCards({
  heading,
  intro,
  cards,
}: {
  heading?: string | null;
  intro?: string | null;
  cards: IngredientCard[];
}) {
  if (cards.length === 0) return null;
  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}
      {intro ? <p className="mt-0 mb-6 max-w-[65ch] text-ink-soft">{intro}</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <li key={`${card.name}-${i}`} className="grid content-start gap-3 rounded-xl bg-card p-4">
            {card.image ? (
              <div className="relative aspect-square overflow-hidden rounded-lg bg-cream">
                <Image
                  src={card.image.url}
                  alt={card.image.alt}
                  fill
                  sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
            ) : null}
            <h3 className="m-0">{card.name}</h3>
            {card.tags && card.tags.length > 0 ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {card.tags.map((tag, t) => (
                  <li
                    key={`${tag}-${t}`}
                    className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
