/**
 * Renders a policy as plain text: headings, sub-headings and paragraphs, nothing else.
 *
 * The source is a list of lines (lib/policies.ts), classified by how they start: "1. " is a section,
 * "1.1. " a sub-section, a short line ending in ":" a label, anything else a paragraph. No HTML is
 * ever taken from the source, so there is nothing to sanitise.
 */
export default function PolicyBody({ lines }: { lines: string[] }) {
  return (
    <div className="grid gap-3 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (/^\d+\.\d+\.\s/.test(line)) {
          return (
            <h3 key={i} className="mt-4 mb-0 text-base font-medium">
              {line}
            </h3>
          );
        }
        if (/^\d+\.\s/.test(line) && line.length < 120) {
          return (
            <h2 key={i} className="font-display mt-8 mb-0 text-xl font-normal">
              {line}
            </h2>
          );
        }
        if (line.length < 60 && line.endsWith(":")) {
          return (
            <p key={i} className="m-0 mt-4 font-medium">
              {line}
            </p>
          );
        }
        // "a. …" items sit under their sub-heading; indent them a little so the structure reads.
        const indented = /^[a-z]\.\s/.test(line);
        return (
          <p key={i} className={`m-0 ${indented ? "pl-4" : ""}`}>
            {line}
          </p>
        );
      })}
    </div>
  );
}
