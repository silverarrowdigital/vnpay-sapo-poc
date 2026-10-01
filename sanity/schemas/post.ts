/**
 * A blog post.
 *
 * `body` uses the same `blocksField` helper as `productContent`, so an editor gets exactly the
 * same palette on a post as on a product, and `BLOCKS_PROJECTION` in lib/content.ts reads both.
 * That shared helper is the reason T2 needs no new rendering code.
 */
import { defineField, defineType } from "sanity";
import { blocksField } from "./blocks";

export const post = defineType({
  name: "post",
  title: "Bài viết",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Tiêu đề",
      type: "string",
      validation: (Rule) => Rule.required().min(3).max(200),
    }),
    defineField({
      name: "slug",
      title: "Đường dẫn",
      type: "slug",
      options: { source: "title", maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "excerpt",
      title: "Tóm tắt",
      description: "Hiện trên thẻ bài viết và dùng làm mô tả cho SEO.",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.required().max(200),
    }),
    defineField({
      name: "coverImage",
      title: "Ảnh bìa",
      type: "image",
      options: { hotspot: true },
      fields: [
        defineField({
          name: "alt",
          title: "Mô tả ảnh (alt)",
          type: "string",
          validation: (Rule) => Rule.required().min(2).max(160),
        }),
      ],
    }),
    defineField({
      name: "publishedAt",
      title: "Thời điểm đăng",
      description: "Đặt thời điểm trong tương lai để hẹn giờ — bài chỉ hiện khi tới hạn.",
      type: "datetime",
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: "author", title: "Tác giả", type: "reference", to: [{ type: "author" }] }),
    defineField({
      name: "tags",
      title: "Thẻ",
      type: "array",
      of: [{ type: "string" }],
      options: { layout: "tags" },
    }),
    blocksField("body", "Nội dung bài viết"),
    defineField({
      name: "seo",
      title: "SEO (tuỳ chọn)",
      description: "Bỏ trống thì dùng tiêu đề và tóm tắt ở trên.",
      type: "object",
      options: { collapsible: true, collapsed: true },
      fields: [
        defineField({ name: "title", title: "Tiêu đề SEO", type: "string", validation: (Rule) => Rule.max(70) }),
        defineField({
          name: "description",
          title: "Mô tả SEO",
          type: "text",
          rows: 2,
          validation: (Rule) => Rule.max(160),
        }),
      ],
    }),
  ],
  orderings: [
    {
      title: "Mới nhất trước",
      name: "publishedAtDesc",
      by: [{ field: "publishedAt", direction: "desc" }],
    },
  ],
  preview: {
    select: { title: "title", publishedAt: "publishedAt", media: "coverImage", author: "author.name" },
    prepare: ({ title, publishedAt, media, author }) => ({
      title,
      subtitle: [publishedAt ? String(publishedAt).slice(0, 10) : "chưa đặt ngày", author].filter(Boolean).join(" · "),
      media,
    }),
  },
});
