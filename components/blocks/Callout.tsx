/**
 * A short highlighted note. The body is plain text in the schema, so there is nothing to render
 * but a string — no Portable Text, no HTML.
 *
 * `tone` only picks a colour. It is not a live status message, so there is no role="alert" here:
 * announcing editorial copy as an alert would interrupt a screen reader for no reason.
 */
export default function Callout({
  tone,
  heading,
  body,
}: {
  tone: "info" | "warn" | "success";
  heading?: string | null;
  body: string;
}) {
  return (
    <aside className={`callout ${tone}`}>
      {heading ? <p className="callout-heading">{heading}</p> : null}
      <p className="callout-body">{body}</p>
    </aside>
  );
}
