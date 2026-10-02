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

/**
 * An image inside a block, already resolved to a URL by the GROQ projection — SliderImage without
 * the caption.
 *
 * Optional images are typed `| null`, not merely optional, because `null` is what GROQ actually
 * returns: projecting a field the editor left empty yields the key with a null value, not an
 * absent key (verified against the live dataset). A `!== undefined` check would therefore read
 * "no image" as "image present" and emit a broken `src`.
 */
export interface BlockImage {
  url: string;
  alt: string;
  /** Intrinsic size, projected so the markup can reserve the box and avoid layout shift. */
  w: number;
  h: number;
}

export interface StepItem {
  title: string;
  body?: string | null;
  image?: BlockImage | null;
}

export interface FeatureCard {
  title: string;
  body: string;
  image?: BlockImage | null;
}

/**
 * One row of a comparison table. `cells` is free text rather than a yes/no enum so a cell can hold
 * "Có" as readily as "100%". Its length is advisory only: ComparisonTable pads a short row and
 * ignores the overflow of a long one, because data an editor typed must never break the layout.
 */
export interface ComparisonRow {
  label: string;
  /**
   * Optional *and* nullable: the `...` spread carries this row through untouched, so a row whose
   * cells the editor never filled in arrives with no `cells` key at all rather than an empty
   * array. Verified against the live dataset.
   */
  cells?: string[] | null;
}

export type ContentBlock =
  | { _type: "richText"; _key: string; content: PortableTextBlock[] }
  | { _type: "imageSlider"; _key: string; aspect: SliderAspect; images: SliderImage[] }
  | { _type: "faq"; _key: string; heading?: string | null; items: FaqItem[] }
  | {
      _type: "videoEmbed";
      _key: string;
      provider: VideoProvider;
      videoId: string;
      /** Used as the iframe's accessible name, so it is required in the schema. */
      title: string;
      poster?: string | null;
    }
  | { _type: "specs"; _key: string; heading?: string | null; rows: SpecRow[] }
  | {
      _type: "callout";
      _key: string;
      tone: "info" | "warn" | "success";
      heading?: string | null;
      body: string;
    }
  /** A logo is the array member itself, so every entry has an image and an alt. */
  | { _type: "logoRow"; _key: string; heading?: string | null; logos: BlockImage[] }
  | { _type: "steps"; _key: string; heading?: string | null; steps: StepItem[] }
  | { _type: "featureGrid"; _key: string; heading?: string | null; cards: FeatureCard[] }
  | {
      _type: "comparisonTable";
      _key: string;
      heading?: string | null;
      /** The header row. Its first entry labels the row-label column. */
      columns: string[];
      rows: ComparisonRow[];
    };

export type { PortableTextBlock };
