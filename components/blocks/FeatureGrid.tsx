import Image from "next/image";

import type { FeatureCard } from "@/lib/blocks";

/**
 * Cards of image + name + description, three to a row on desktop, two on tablet, one on a phone.
 * Server component.
 *
 * A card with no image keeps its text rather than being dropped: the image is optional in the
 * schema, and half a card beats a hole in the grid.
 */
export default function FeatureGrid({
  heading,
  cards,
}: {
  heading?: string | null;
  cards: FeatureCard[];
}) {
  if (cards.length === 0) return null;
  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <li
            key={`${card.title}-${i}`}
            className="grid content-start gap-3 rounded-xl bg-card p-4"
          >
            {card.image ? (
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-cream">
                <Image
                  src={card.image.url}
                  alt={card.image.alt}
                  fill
                  sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
            ) : null}
            <h3 className="m-0">{card.title}</h3>
            <p className="m-0 text-sm text-ink-soft whitespace-pre-line">{card.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
