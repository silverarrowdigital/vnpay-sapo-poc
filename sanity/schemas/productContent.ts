/**
 * Presentation content for one Sapo product.
 *
 * Matched to Sapo on `sapoProductId` and nothing else. The alternatives both break:
 * renaming a product in Sapo changes its `alias`, and deleting or recreating a variant changes
 * its `variantId`. The product id is stable for the product's whole life. See lib/content.ts.
 */
import { defineArrayMember, defineField, defineType } from "sanity";
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
    /**
     * Thông tin hiện trong khung mua, cạnh giá — không phải một khối trong danh sách nội dung.
     *
     * Để ở đây thay vì làm block vì hình dạng của nó cố định: khung mua vẽ đúng những dòng này
     * ở đúng chỗ này. Một block thì người biên tập kéo được xuống dưới mô tả, nơi nó vô nghĩa.
     * Mọi trường đều không bắt buộc, và khung mua bỏ qua dòng nào trống thay vì để nhãn rỗng.
     */
    defineField({
      name: "meta",
      title: "Thông tin trong khung mua",
      type: "object",
      options: { collapsible: true, collapsed: false },
      fields: [
        defineField({ name: "servings", title: "Quy cách", description: "Ví dụ: 15+ lần pha / 50g", type: "string" }),
        defineField({ name: "summary", title: "Mô tả một dòng", type: "text", rows: 2 }),
        defineField({ name: "teaType", title: "Loại trà", type: "string" }),
        defineField({
          name: "caffeine",
          title: "Mức caffeine",
          type: "string",
          options: {
            list: [
              { title: "Không có", value: "Không có" },
              { title: "Thấp", value: "Thấp" },
              { title: "Vừa", value: "Vừa" },
              { title: "Cao", value: "Cao" },
            ],
            layout: "radio",
          },
        }),
        defineField({ name: "tastingNotes", title: "Hương vị cảm nhận", description: "Ví dụ: Sô-cô-la, Ca-cao, Bánh quy", type: "string" }),
        defineField({ name: "perfectFor", title: "Hợp với", type: "text", rows: 3 }),
        defineField({
          name: "benefits",
          title: "Huy hiệu lợi ích",
          description: "Chữ ngắn, viết hoa. Tối đa 4 — nhiều hơn thì khung mua chật và không ai đọc.",
          type: "array",
          of: [defineArrayMember({ type: "string" })],
          validation: (Rule) => Rule.max(4),
        }),
      ],
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
