/**
 * The block palette an editor can compose a product description or a blog post from.
 *
 * One array definition, used by both `productContent.blocks` and (from T2) `post.body`, so the
 * two features cannot drift apart. The matching reader is BLOCKS_PROJECTION in lib/content.ts
 * and the matching renderer is components/blocks/BlockRenderer.tsx; a block added here needs a
 * component there, but the renderer ignores a type it does not know, so publishing ahead of a
 * deploy degrades to nothing rather than breaking the page.
 *
 * Every object's `name` is the `_type` that reaches the browser, so these strings must match the
 * ContentBlock union in lib/blocks.ts exactly.
 */
import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * Marks and styles allowed in rich text. Deliberately short: this content is rendered through
 * our own React components, never as HTML, and every style here needs one. `link` is the only
 * annotation, and its href is restricted to schemes that cannot execute — no `javascript:`.
 */
const PORTABLE_TEXT = defineArrayMember({
  type: "block",
  styles: [
    { title: "Đoạn văn", value: "normal" },
    { title: "Tiêu đề 2", value: "h2" },
    { title: "Tiêu đề 3", value: "h3" },
    { title: "Trích dẫn", value: "blockquote" },
  ],
  lists: [
    { title: "Gạch đầu dòng", value: "bullet" },
    { title: "Danh sách số", value: "number" },
  ],
  marks: {
    decorators: [
      { title: "In đậm", value: "strong" },
      { title: "In nghiêng", value: "em" },
    ],
    annotations: [
      {
        name: "link",
        type: "object",
        title: "Liên kết",
        fields: [
          {
            name: "href",
            type: "url",
            title: "Địa chỉ",
            validation: (Rule) =>
              Rule.required().uri({ scheme: ["http", "https", "mailto"] }),
          },
        ],
      },
    ],
  },
});

export const richText = defineType({
  name: "richText",
  title: "Văn bản",
  type: "object",
  fields: [defineField({ name: "content", title: "Nội dung", type: "array", of: [PORTABLE_TEXT] })],
  preview: {
    select: { content: "content" },
    prepare({ content }) {
      // Portable Text has no plain-text field, so build one for the array row in the Studio.
      const first = Array.isArray(content) ? content[0] : undefined;
      const text = first?.children?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
      return { title: "Văn bản", subtitle: text.slice(0, 80) || "(trống)" };
    },
  },
});

export const imageSlider = defineType({
  name: "imageSlider",
  title: "Slider ảnh",
  type: "object",
  fields: [
    defineField({
      name: "aspect",
      title: "Tỉ lệ khung",
      type: "string",
      initialValue: "4-3",
      options: {
        list: [
          { title: "Vuông (1:1)", value: "square" },
          { title: "4:3", value: "4-3" },
          { title: "16:9", value: "16-9" },
        ],
        layout: "radio",
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "images",
      title: "Ảnh",
      type: "array",
      validation: (Rule) => Rule.required().min(1).max(12),
      of: [
        defineArrayMember({
          type: "image",
          options: { hotspot: true },
          fields: [
            // Required: a slide with no alt text is not describable to a screen reader, and the
            // slider is often the only content on a product page.
            defineField({
              name: "alt",
              title: "Mô tả ảnh (alt)",
              type: "string",
              validation: (Rule) => Rule.required().min(2).max(160),
            }),
            defineField({ name: "caption", title: "Chú thích hiển thị", type: "string" }),
          ],
        }),
      ],
    }),
  ],
  preview: {
    select: { images: "images", aspect: "aspect" },
    prepare: ({ images, aspect }) => ({
      title: `Slider ảnh (${Array.isArray(images) ? images.length : 0})`,
      subtitle: `Tỉ lệ ${aspect ?? "?"}`,
    }),
  },
});

export const faq = defineType({
  name: "faq",
  title: "Câu hỏi thường gặp",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "items",
      title: "Câu hỏi",
      type: "array",
      validation: (Rule) => Rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "faqItem",
          fields: [
            defineField({
              name: "question",
              title: "Câu hỏi",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: "answer",
              title: "Trả lời",
              type: "array",
              of: [PORTABLE_TEXT],
              validation: (Rule) => Rule.required(),
            }),
          ],
          preview: { select: { title: "question" } },
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", items: "items" },
    prepare: ({ heading, items }) => ({
      title: heading || "Câu hỏi thường gặp",
      subtitle: `${Array.isArray(items) ? items.length : 0} câu`,
    }),
  },
});

/** YouTube ids are 11 url-safe characters; Vimeo ids are numeric. */
const VIDEO_ID_PATTERN: Record<string, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^\d+$/,
};

export const videoEmbed = defineType({
  name: "videoEmbed",
  title: "Video",
  type: "object",
  // There is deliberately NO url field and NO html field. The player address is assembled from
  // `provider` and `videoId` in components/blocks/VideoEmbed.tsx, so nothing typed in here can
  // point an iframe at an arbitrary origin or smuggle in a script. See CLAUDE.md security rules.
  fields: [
    defineField({
      name: "provider",
      title: "Nền tảng",
      type: "string",
      initialValue: "youtube",
      options: {
        list: [
          { title: "YouTube", value: "youtube" },
          { title: "Vimeo", value: "vimeo" },
        ],
        layout: "radio",
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "videoId",
      title: "Mã video",
      description:
        "Chỉ phần mã, không phải cả URL. YouTube: 11 ký tự sau ?v= (ví dụ dQw4w9WgXcQ). Vimeo: dãy số.",
      type: "string",
      validation: (Rule) =>
        Rule.required().custom((value, context) => {
          if (typeof value !== "string") return "Thiếu mã video";
          const provider = (context.parent as { provider?: string } | undefined)?.provider;
          const pattern = provider !== undefined ? VIDEO_ID_PATTERN[provider] : undefined;
          if (pattern === undefined) return "Chọn nền tảng trước";
          return pattern.test(value) ? true : `Mã không đúng dạng của ${provider}`;
        }),
    }),
    defineField({
      name: "title",
      title: "Tiêu đề video",
      description: "Dùng làm tên gọi của khung video cho trình đọc màn hình. Bắt buộc.",
      type: "string",
      validation: (Rule) => Rule.required().min(3).max(160),
    }),
    defineField({
      name: "poster",
      title: "Ảnh bìa",
      description:
        "Hiện trước khi người xem bấm phát. Không có thì khối video dùng nền trơn — trong cả hai trường hợp, không request nào gửi sang nền tảng video cho tới khi người xem bấm.",
      type: "image",
      options: { hotspot: true },
    }),
  ],
  preview: {
    select: { title: "title", provider: "provider", videoId: "videoId" },
    prepare: ({ title, provider, videoId }) => ({
      title: title || "Video",
      subtitle: `${provider ?? "?"} · ${videoId ?? "?"}`,
    }),
  },
});

export const specs = defineType({
  name: "specs",
  title: "Bảng thông số",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "rows",
      title: "Dòng",
      type: "array",
      validation: (Rule) => Rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "specRow",
          fields: [
            defineField({
              name: "label",
              title: "Tên",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: "value",
              title: "Giá trị",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
          ],
          preview: { select: { title: "label", subtitle: "value" } },
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", rows: "rows" },
    prepare: ({ heading, rows }) => ({
      title: heading || "Bảng thông số",
      subtitle: `${Array.isArray(rows) ? rows.length : 0} dòng`,
    }),
  },
});

export const callout = defineType({
  name: "callout",
  title: "Khối nhấn mạnh",
  type: "object",
  fields: [
    defineField({
      name: "tone",
      title: "Sắc thái",
      type: "string",
      initialValue: "info",
      options: {
        list: [
          { title: "Thông tin", value: "info" },
          { title: "Lưu ý", value: "warn" },
          { title: "Tốt", value: "success" },
        ],
        layout: "radio",
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: "heading", title: "Tiêu đề", type: "string" }),
    // Plain text, not Portable Text: a callout is one short paragraph, and keeping it plain means
    // there is nothing to render but a string.
    defineField({
      name: "body",
      title: "Nội dung",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.required().max(400),
    }),
  ],
  preview: {
    select: { heading: "heading", body: "body", tone: "tone" },
    prepare: ({ heading, body, tone }) => ({
      title: heading || "Khối nhấn mạnh",
      subtitle: `${tone ?? "info"} · ${(body ?? "").slice(0, 60)}`,
    }),
  },
});

/**
 * Alt text for an image nested inside a block. Required everywhere in this repo: a logo or a
 * feature illustration nobody can describe is invisible to a screen reader, and these blocks
 * often carry the only picture on the page.
 */
const altField = defineField({
  name: "alt",
  title: "Mô tả ảnh (alt)",
  type: "string",
  validation: (Rule) => Rule.required().min(2).max(160),
});

export const logoRow = defineType({
  name: "logoRow",
  title: "Hàng logo",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "logos",
      title: "Logo",
      type: "array",
      validation: (Rule) => Rule.required().min(1).max(12),
      of: [
        defineArrayMember({
          type: "image",
          options: { hotspot: true },
          fields: [altField],
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", logos: "logos" },
    prepare: ({ heading, logos }) => ({
      title: heading || "Hàng logo",
      subtitle: `${Array.isArray(logos) ? logos.length : 0} logo`,
    }),
  },
});

export const steps = defineType({
  name: "steps",
  title: "Các bước",
  type: "object",
  // There is deliberately no number field: Steps numbers the list from array order, so inserting
  // a step in the middle does not mean renumbering every one after it by hand.
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "steps",
      title: "Các bước",
      description: "Số thứ tự tự đánh theo thứ tự trong danh sách, không nhập tay.",
      type: "array",
      validation: (Rule) => Rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "stepItem",
          fields: [
            defineField({
              name: "title",
              title: "Tên bước",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
            defineField({ name: "body", title: "Diễn giải", type: "text", rows: 3 }),
            defineField({
              name: "image",
              title: "Ảnh",
              type: "image",
              options: { hotspot: true },
              fields: [altField],
            }),
          ],
          preview: { select: { title: "title", subtitle: "body", media: "image" } },
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", steps: "steps" },
    prepare: ({ heading, steps: items }) => ({
      title: heading || "Các bước",
      subtitle: `${Array.isArray(items) ? items.length : 0} bước`,
    }),
  },
});

export const featureGrid = defineType({
  name: "featureGrid",
  title: "Dãy ô đặc điểm",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "cards",
      title: "Ô",
      description: "Desktop xếp 3 ô một hàng, tablet 2, điện thoại 1.",
      type: "array",
      validation: (Rule) => Rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "featureCard",
          fields: [
            defineField({
              name: "image",
              title: "Ảnh",
              type: "image",
              options: { hotspot: true },
              fields: [altField],
            }),
            defineField({
              name: "title",
              title: "Tên",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: "body",
              title: "Mô tả",
              type: "text",
              rows: 3,
              validation: (Rule) => Rule.required(),
            }),
          ],
          preview: { select: { title: "title", subtitle: "body", media: "image" } },
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", cards: "cards" },
    prepare: ({ heading, cards }) => ({
      title: heading || "Dãy ô đặc điểm",
      subtitle: `${Array.isArray(cards) ? cards.length : 0} ô`,
    }),
  },
});

export const comparisonTable = defineType({
  name: "comparisonTable",
  title: "Bảng so sánh",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "columns",
      title: "Cột",
      description: "Hàng tiêu đề. Ô đầu tiên là nhãn của cột nhãn bên trái.",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      validation: (Rule) => Rule.required().min(2),
    }),
    defineField({
      name: "rows",
      title: "Hàng",
      type: "array",
      // A mismatched cell count is a *warning*, not an error: ComparisonTable pads a short row
      // and drops the overflow of a long one, so the page survives either way. Blocking the save
      // would only stop an editor halfway through typing a table.
      validation: (Rule) => [
        Rule.required().min(1),
        Rule.custom((rows, context) => {
          const columns = (context.parent as { columns?: unknown[] } | undefined)?.columns;
          if (!Array.isArray(columns) || !Array.isArray(rows)) return true;
          const expected = columns.length - 1;
          const odd = rows
            .map((row, i) => {
              const cells = (row as { cells?: unknown[] } | null)?.cells;
              const got = Array.isArray(cells) ? cells.length : 0;
              return got === expected ? null : `hàng ${i + 1} có ${got} ô`;
            })
            .filter((message): message is string => message !== null);
          if (odd.length === 0) return true;
          return `Nên có ${expected} ô mỗi hàng (bằng số cột trừ cột nhãn): ${odd.join(", ")}.`;
        }).warning(),
      ],
      of: [
        defineArrayMember({
          type: "object",
          name: "comparisonRow",
          fields: [
            defineField({
              name: "label",
              title: "Nhãn hàng",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
            // Free text, not a yes/no enum, so a cell can hold "Có" as readily as "100%".
            defineField({
              name: "cells",
              title: "Ô",
              type: "array",
              of: [defineArrayMember({ type: "string" })],
            }),
          ],
          preview: {
            select: { title: "label", cells: "cells" },
            prepare: ({ title, cells }) => ({
              title: title || "(chưa có nhãn)",
              subtitle: Array.isArray(cells) ? cells.join(" · ") : "",
            }),
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", columns: "columns", rows: "rows" },
    prepare: ({ heading, columns, rows }) => ({
      title: heading || "Bảng so sánh",
      subtitle: `${Array.isArray(columns) ? columns.length : 0} cột × ${
        Array.isArray(rows) ? rows.length : 0
      } hàng`,
    }),
  },
});

export const brewProfile = defineType({
  name: "brewProfile",
  title: "Hướng dẫn pha",
  type: "object",
  // Bảng thông số và thang hương vị nằm chung một khối vì trang tham chiếu vẽ chúng thành một
  // mảng. Tách đôi thì người biên tập phải nhớ luôn đặt hai khối cạnh nhau — một luật ngầm
  // không ai thấy cho tới khi nó bị phá.
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({
      name: "rows",
      title: "Thông số",
      type: "array",
      validation: (Rule) => Rule.required().min(1).max(6),
      of: [
        defineArrayMember({
          type: "object",
          name: "brewRow",
          fields: [
            defineField({ name: "label", title: "Tên", type: "string", validation: (Rule) => Rule.required() }),
            defineField({ name: "value", title: "Giá trị", type: "string", validation: (Rule) => Rule.required() }),
          ],
          preview: { select: { title: "label", subtitle: "value" } },
        }),
      ],
    }),
    defineField({
      name: "scaleMin",
      title: "Đầu nhẹ của thang",
      type: "string",
      initialValue: "Thanh nhẹ",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "scaleMax",
      title: "Đầu đậm của thang",
      type: "string",
      initialValue: "Đậm",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "scaleValue",
      title: "Vị trí trên thang (0–100)",
      description: "0 là nhẹ nhất, 100 là đậm nhất.",
      type: "number",
      initialValue: 50,
      validation: (Rule) => Rule.required().min(0).max(100),
    }),
    defineField({ name: "scaleNote", title: "Ghi chú dưới thang", type: "text", rows: 2 }),
  ],
  preview: {
    select: { heading: "heading", rows: "rows", v: "scaleValue" },
    prepare: ({ heading, rows, v }) => ({
      title: heading || "Hướng dẫn pha",
      subtitle: `${Array.isArray(rows) ? rows.length : 0} thông số · thang ${v ?? "?"}/100`,
    }),
  },
});

export const ingredientCards = defineType({
  name: "ingredientCards",
  title: "Thẻ nguyên liệu",
  type: "object",
  // Khác featureGrid ở chỗ thân thẻ là một *dãy nhãn*, không phải một đoạn văn. Dùng featureGrid
  // rồi nhét nhãn vào ô mô tả sẽ mất cấu trúc danh sách, và trình đọc màn hình đọc ra một câu dài.
  fields: [
    defineField({ name: "heading", title: "Tiêu đề khối", type: "string" }),
    defineField({ name: "intro", title: "Đoạn mở đầu", type: "text", rows: 3 }),
    defineField({
      name: "cards",
      title: "Thẻ",
      type: "array",
      validation: (Rule) => Rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "ingredientCard",
          fields: [
            defineField({ name: "name", title: "Tên nguyên liệu", type: "string", validation: (Rule) => Rule.required() }),
            defineField({ name: "image", title: "Ảnh", type: "image", options: { hotspot: true }, fields: [altField] }),
            defineField({
              name: "tags",
              title: "Nhãn",
              description: "Mỗi nhãn một dòng, ví dụ: Polyphenol, Chống oxy hoá.",
              type: "array",
              of: [defineArrayMember({ type: "string" })],
              validation: (Rule) => Rule.required().min(1).max(8),
            }),
          ],
          preview: {
            select: { title: "name", tags: "tags", media: "image" },
            prepare: ({ title, tags, media }) => ({
              title: title || "(chưa có tên)",
              subtitle: Array.isArray(tags) ? tags.join(" · ") : "",
              media,
            }),
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { heading: "heading", cards: "cards" },
    prepare: ({ heading, cards }) => ({
      title: heading || "Thẻ nguyên liệu",
      subtitle: `${Array.isArray(cards) ? cards.length : 0} thẻ`,
    }),
  },
});

/** Every block object, registered once so both documents can reference them by name. */
export const blockTypes = [
  richText,
  imageSlider,
  faq,
  videoEmbed,
  specs,
  callout,
  logoRow,
  steps,
  featureGrid,
  comparisonTable,
  brewProfile,
  ingredientCards,
];

/**
 * The composable content array. Shared so a product description and a blog post offer the editor
 * exactly the same palette.
 */
export function blocksField(name: string, title = "Nội dung") {
  return defineField({
    name,
    title,
    type: "array",
    of: blockTypes.map((block) => defineArrayMember({ type: block.name })),
  });
}
