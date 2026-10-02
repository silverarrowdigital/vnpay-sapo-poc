import type { FaqItem } from "@/lib/blocks";
import RichText from "./RichText";

/**
 * Accordion built on <details>/<summary>, so it opens and closes with no JavaScript at all and
 * stays a server component. The browser also gives us the keyboard behaviour and the correct
 * expanded/collapsed state for screen readers for free, which a div-and-onClick version would
 * have to reimplement.
 */
export default function Faq({ heading, items }: { heading?: string | null; items: FaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="faq">
      {heading ? <h2>{heading}</h2> : null}
      {items.map((item, i) => (
        <details key={`${item.question}-${i}`} className="faq-item">
          <summary>{item.question}</summary>
          <div className="faq-answer">
            <RichText content={item.answer} />
          </div>
        </details>
      ))}
    </section>
  );
}
