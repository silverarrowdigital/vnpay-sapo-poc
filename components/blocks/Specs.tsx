import type { SpecRow } from "@/lib/blocks";

/**
 * A label/value table. <dl> rather than <table>: these are name-value pairs, not a grid of data
 * with meaningful rows and columns, and a screen reader announces the pairing without needing
 * headers.
 */
export default function Specs({ heading, rows }: { heading?: string; rows: SpecRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="specs">
      {heading !== undefined && <h2>{heading}</h2>}
      <dl className="specs-list">
        {rows.map((row, i) => (
          <div className="specs-row" key={`${row.label}-${i}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
