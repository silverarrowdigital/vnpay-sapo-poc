/**
 * Presentation content for one Sapo product.
 *
 * Matched to Sapo on `sapoProductId` and nothing else. The alternatives both break:
 * renaming a product in Sapo changes its `alias`, and deleting or recreating a variant changes
 * its `variantId`. The product id is stable for the product's whole life. See lib/content.ts.
 */
import { defineField, defineType } from "sanity";
import { blocksField } from "./blocks";

/** Pinned so a Studio deploy cannot silently change how the uniqueness check behaves. */
const VALIDATION_API_VERSION = "2026-10-01";

export const productContent = defineType({
  name: "productContent",
  title: "Nội dung sản phẩm",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Tên nội bộ",
      description: "Chỉ để tìm trong Studio. Tên sản phẩm hiển thị trên web vẫn lấy từ Sapo.",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "sapoProductId",
      title: "Sapo product id",
      description:
        "Số id sản phẩm trong Sapo (không phải variant id, không phải alias). Đây là khoá khớp duy nhất.",
      type: "number",
      validation: (Rule) =>
        Rule.required()
          .integer()
          .positive()
          .custom(async (value, context) => {
            if (typeof value !== "number") return true; // required() already reports this
            // Two documents claiming the same product would make which one renders arbitrary,
            // so refuse the second one at edit time rather than guess at read time.
            const client = context.getClient({ apiVersion: VALIDATION_API_VERSION });
            const id = context.document?._id ?? "";
            // A draft and its published version share an id bar the "drafts." prefix; neither
            // counts as a duplicate of the other.
            const bare = id.replace(/^drafts\./, "");
            const duplicate = await client.fetch<string | null>(
              `*[_type == "productContent" && sapoProductId == $value && !(_id in $self)][0]._id`,
              { value, self: [bare, `drafts.${bare}`] },
            );
            return duplicate === null
              ? true
              : "Đã có nội dung khác dùng product id này. Mỗi sản phẩm chỉ một tài liệu.";
          }),
    }),
    defineField({
      name: "sapoAlias",
      title: "Alias trong Sapo (tham khảo)",
      description:
        "Chỉ để người biên tập nhận ra sản phẩm. KHÔNG dùng để khớp — alias đổi khi đổi tên sản phẩm.",
      type: "string",
    }),
    blocksField("blocks", "Khối nội dung"),
  ],
  preview: {
    select: { title: "title", sapoProductId: "sapoProductId", blocks: "blocks" },
    prepare: ({ title, sapoProductId, blocks }) => ({
      title: title || `Sản phẩm ${sapoProductId ?? "?"}`,
      subtitle: `Sapo id ${sapoProductId ?? "?"} · ${Array.isArray(blocks) ? blocks.length : 0} khối`,
    }),
  },
});
