import type { BrewRow } from "@/lib/blocks";

/**
 * Brewing numbers plus where this tea sits on a light-to-strong axis. Server component.
 *
 * The bar is `role="img"` with the whole reading in its label rather than `role="meter"`, which
 * expresses the same thing more precisely but is announced unevenly across screen readers. A
 * label that always reads correctly beats a role that sometimes reads better: a decorative bar
 * with no text equivalent would leave the strength of the tea visible only to people who can see
 * it.
 */
export default function BrewProfile({
  heading,
  rows,
  scaleMin,
  scaleMax,
  scaleValue,
  scaleNote,
}: {
  heading?: string | null;
  rows: BrewRow[];
  scaleMin: string;
  scaleMax: string;
  scaleValue: number;
  scaleNote?: string | null;
}) {
  if (rows.length === 0) return null;
  // Clamped because the number comes from a CMS field: a value outside 0–100 would push the fill
  // out of its track rather than being refused at render time.
  const pct = Math.min(100, Math.max(0, Number.isFinite(scaleValue) ? scaleValue : 0));

  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="rounded-xl bg-cream p-4">
            <dt className="m-0 text-xs tracking-wide text-ink-soft uppercase">{row.label}</dt>
            <dd className="m-0 mt-1 font-display text-xl">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <div
          role="img"
          aria-label={`Độ đậm: ${pct} trên 100, trên thang từ ${scaleMin} đến ${scaleMax}.`}
          className="h-2 w-full overflow-hidden rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        {/* aria-hidden: the two ends are already named inside the bar's label, and repeating them
            would have a screen reader read the axis twice. */}
        <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-ink-soft">
          <span>{scaleMin}</span>
          <span>{scaleMax}</span>
        </div>
        {scaleNote ? <p className="mt-3 mb-0 text-sm text-ink-soft">{scaleNote}</p> : null}
      </div>
    </section>
  );
}
