import type { ContentBlock } from "@/lib/blocks";
import Callout from "./Callout";
import Faq from "./Faq";
import ImageSlider from "./ImageSlider";
import RichText from "./RichText";
import Specs from "./Specs";
import VideoEmbed from "./VideoEmbed";

/**
 * Renders a CMS block list in order.
 *
 * **An unknown `_type` renders nothing instead of throwing.** An editor can add a block in the
 * Studio before the code that draws it is deployed, and a storefront that 500s because somebody
 * published early is worse than one missing a section. The same tolerance covers a block whose
 * shape changed: it disappears until the deploy catches up.
 */
export default function BlockRenderer({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="blocks">
      {blocks.map((block) => {
        switch (block._type) {
          case "richText":
            return <RichText key={block._key} content={block.content} />;
          case "imageSlider":
            return <ImageSlider key={block._key} images={block.images} aspect={block.aspect} />;
          case "faq":
            return <Faq key={block._key} heading={block.heading} items={block.items} />;
          case "videoEmbed":
            return (
              <VideoEmbed
                key={block._key}
                provider={block.provider}
                videoId={block.videoId}
                title={block.title}
                poster={block.poster}
              />
            );
          case "specs":
            return <Specs key={block._key} heading={block.heading} rows={block.rows} />;
          case "callout":
            return (
              <Callout key={block._key} tone={block.tone} heading={block.heading} body={block.body} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
