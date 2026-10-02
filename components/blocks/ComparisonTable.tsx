import type { ComparisonRow } from "@/lib/blocks";

/**
 * A comparison grid. Server component.
 *
 * A real `<table>` with `<th scope>` on both axes, because the reference table runs to eleven
 * columns and a grid that wide is unreadable without headers: a screen reader needs `scope` to
 * say which column a cell belongs to.
 *
 * **Only the table scrolls sideways, never the page.** The overflow lives on the wrapper, which is
 * also a focusable `role="region"` so the scroll can be driven from the keyboard — an
 * `overflow-x-auto` div with no `tabindex` is reachable by mouse and trackpad only. The label
 * column is `sticky left-0` so a reader who has scrolled to column nine still knows which row
 * they are on. Do not "fix" this by shrinking the table to fit a phone: eleven columns squeezed
 * into 390px is not a readable table.
 *
 * A row the editor left short is padded and a long one is truncated to the header's width, so a
 * mismatched cell count cannot shear the grid. The Studio warns about it at edit time but does not
 * block the save.
 */
export default function ComparisonTable({
  heading,
  columns,
  rows,
}: {
  heading?: string | null;
  columns: string[];
  rows: ComparisonRow[];
}) {
  // Fewer than two columns is not a comparison, and the schema requires two; render nothing
  // rather than a one-column table if a document predates that rule.
  if (columns.length < 2 || rows.length === 0) return null;

  // The first column heads the label column, so the body of a row holds one fewer cell.
  const bodyCellCount = columns.length - 1;

  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}
      <div
        role="region"
        aria-label={heading ? heading : "Bảng so sánh"}
        tabIndex={0}
        /* min-w-0 is load-bearing: a grid or flex item defaults to min-width:auto, and without
           this an ancestor track could be widened by the table instead of the table scrolling —
           which is exactly how a wide table ends up scrolling the whole page. */
        className="min-w-0 overflow-x-auto rounded-xl border border-line bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {columns.map((column, i) => (
                <th
                  key={`${column}-${i}`}
                  scope="col"
                  className={
                    i === 0
                      ? // Above the sticky label column, so it needs the higher stacking order.
                        "sticky left-0 z-20 min-w-[9rem] border-r border-b border-line bg-cream px-4 py-3 font-semibold"
                      : "border-b border-line px-4 py-3 font-semibold whitespace-nowrap"
                  }
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={`${row.label}-${r}`}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[9rem] border-r border-b border-line bg-cream px-4 py-3 text-left font-normal"
                >
                  {row.label}
                </th>
                {Array.from({ length: bodyCellCount }, (_, c) => {
                  const cell = row.cells?.[c] ?? "";
                  return (
                    <td
                      key={c}
                      className="border-b border-line px-4 py-3 whitespace-nowrap text-ink-soft"
                    >
                      {/* An em dash for the eye only: to a screen reader the cell stays empty,
                          which is the truth — there is no value, not a value of "—". */}
                      {cell === "" ? <span aria-hidden="true">—</span> : cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
