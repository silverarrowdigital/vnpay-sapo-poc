/**
 * Shapes of the CMS content blocks, shared by server and client.
 *
 * **This is the second client-safe module in lib/**, after lib/product.ts: components under
 * components/blocks/ are "use client" and need these shapes. It holds types only, and its one
 * import is type-only (erased at compile time), so nothing server-side can leak through it.
 * Keep it that way — no config, no client, no logger.
 *
 * The same block array backs both a product description and a blog post body, which is why
 * these types live here rather than beside either feature.
 */
import type { PortableTextBlock } from "@portabletext/types";

/** One slide, with its asset already resolved to a URL by the GROQ projection. */
export interface SliderImage {
  url: string;
  /** Required in the schema: a slide with no alt text is not describable to a screen reader. */
  alt: string;
  caption?: string;
  /** Intrinsic size, projected so the markup can reserve the box and avoid layout shift. */
  w: number;
  h: number;
}

export interface FaqItem {
  question: string;
  answer: PortableTextBlock[];
}

export interface SpecRow {
  label: string;
  value: string;
}

/** Fixed aspect box for a slider, so slides of differing sizes do not jump. */
export type SliderAspect = "square" | "4-3" | "16-9";

/**
 * A video the editor picked by provider and id — never a URL and never an HTML snippet. The
 * player URL is assembled in components/blocks/VideoEmbed.tsx from this enum, so nothing typed
 * into the CMS can become a script tag or point an iframe somewhere unexpected.
 */
export type VideoProvider = "youtube" | "vimeo";

export type ContentBlock =
  | { _type: "richText"; _key: string; content: PortableTextBlock[] }
  | { _type: "imageSlider"; _key: string; aspect: SliderAspect; images: SliderImage[] }
  | { _type: "faq"; _key: string; heading?: string; items: FaqItem[] }
  | {
      _type: "videoEmbed";
      _key: string;
      provider: VideoProvider;
      videoId: string;
      /** Used as the iframe's accessible name, so it is required in the schema. */
      title: string;
      poster?: string;
    }
  | { _type: "specs"; _key: string; heading?: string; rows: SpecRow[] }
  | { _type: "callout"; _key: string; tone: "info" | "warn" | "success"; heading?: string; body: string };

export type { PortableTextBlock };
