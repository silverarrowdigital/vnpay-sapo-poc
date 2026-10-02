import Image from "next/image";

import type { StepItem } from "@/lib/blocks";

/**
 * A numbered walkthrough. Server component.
 *
 * `<ol>` rather than divs with a painted-on number: the order *is* the information, and the list
 * conveys it to assistive technology without any markup of ours. The visible number is therefore
 * `aria-hidden` — the list already announces position, and repeating it reads as "one, one".
 *
 * Numbers come from array position, never from a field, so inserting a step in the middle does not
 * mean renumbering the rest by hand.
 */
export default function Steps({
  heading,
  steps,
}: {
  heading?: string | null;
  steps: StepItem[];
}) {
  if (steps.length === 0) return null;
  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={`${step.title}-${i}`} className="grid gap-3">
            {step.image ? (
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-cream">
                <Image
                  src={step.image.url}
                  alt={step.image.alt}
                  fill
                  sizes="(min-width: 1024px) 240px, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
            ) : null}
            <div className="flex items-baseline gap-3">
              <span
                aria-hidden="true"
                className="font-mono text-sm text-ink-soft"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="m-0">{step.title}</h3>
            </div>
            {step.body ? (
              <p className="m-0 text-sm text-ink-soft whitespace-pre-line">{step.body}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
