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

/** Every block object, registered once so both documents can reference them by name. */
export const blockTypes = [richText, imageSlider, faq, videoEmbed, specs, callout];

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
