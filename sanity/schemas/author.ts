/** Who wrote a post. Referenced from `post.author`, so one person is edited in one place. */
import { defineField, defineType } from "sanity";

export const author = defineType({
  name: "author",
  title: "Tác giả",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Tên",
      type: "string",
      validation: (Rule) => Rule.required().min(2).max(100),
    }),
    defineField({ name: "role", title: "Vai trò", type: "string" }),
    defineField({
      name: "avatar",
      title: "Ảnh đại diện",
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
    defineField({ name: "bio", title: "Giới thiệu", type: "text", rows: 3 }),
  ],
  preview: { select: { title: "name", subtitle: "role", media: "avatar" } },
});
