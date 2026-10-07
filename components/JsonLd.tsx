import { serializeJsonLd } from "@/lib/jsonld";

/**
 * The project's one exception to "no dangerouslySetInnerHTML" (CLAUDE.md security rule 8, widened by
 * the owner on 2026-10-07): a `<script type="application/ld+json">` has no other way to carry its
 * text. It is safe only because of two constraints — the data comes from Sapo, never from the CMS
 * (see lib/jsonld.ts), and `serializeJsonLd` escapes `<`, `>` and `&`, so no value can close the tag.
 * Do not give this component anything else.
 */
export default function JsonLd({ data }: { data: Parameters<typeof serializeJsonLd>[0] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
