import { PortableText, type PortableTextComponents } from "@portabletext/react";
import type { PortableTextBlock } from "@/lib/blocks";

/**
 * Rich text from the CMS, rendered through our own elements.
 *
 * Nothing here goes near dangerouslySetInnerHTML: a product description is text somebody typed
 * into a CMS, so rendering it as HTML would let whatever was typed execute on the storefront.
 * That is the same rule htmlToText() applies to Sapo's own description in lib/sapo.ts.
 *
 * The schema only permits the styles and marks handled below, so there is no "unknown style"
 * branch to hit — an unhandled one would fall back to a paragraph anyway.
 */
const components: PortableTextComponents = {
  block: {
    normal: ({ children }) => <p>{children}</p>,
    h2: ({ children }) => <h2>{children}</h2>,
    h3: ({ children }) => <h3>{children}</h3>,
    blockquote: ({ children }) => <blockquote className="rt-quote">{children}</blockquote>,
  },
  marks: {
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    link: ({ children, value }) => {
      const href = typeof value?.href === "string" ? value.href : undefined;
      if (href === undefined) return <>{children}</>;
      // Only a same-site link stays in the tab. The schema restricts the scheme to
      // http/https/mailto, so there is no javascript: URL to guard against here.
      const internal = href.startsWith("/");
      return internal ? (
        <a href={href}>{children}</a>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  },
  list: {
    bullet: ({ children }) => <ul className="rt-list">{children}</ul>,
    number: ({ children }) => <ol className="rt-list">{children}</ol>,
  },
};

export default function RichText({ content }: { content: PortableTextBlock[] }) {
  if (content.length === 0) return null;
  return (
    <div className="rt">
      <PortableText value={content} components={components} />
    </div>
  );
}
