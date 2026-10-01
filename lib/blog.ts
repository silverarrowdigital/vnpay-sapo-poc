/**
 * Blog content from Sanity. Server-only.
 *
 * Unlike lib/content.ts, these throw when the CMS cannot answer: a product page degrades to Sapo's
 * own description, but a blog with no fallback must say it is broken rather than look empty.
 *
 * `body` is read with the same BLOCKS_PROJECTION as a product description, so a post and a product
 * render through the same components and the two cannot drift apart.
 */
import { BLOCKS_PROJECTION } from "./content";
import { groqQueryOrThrow } from "./sanity";
import type { ContentBlock } from "./blocks";

export interface PostCover {
  url: string;
  alt: string;
  /** Intrinsic size, so markup can reserve the box and avoid layout shift. */
  w: number;
  h: number;
}

export interface PostSummary {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO datetime. */
  publishedAt: string;
  cover: PostCover | null;
  authorName: string | null;
  tags: string[];
}

export interface Post extends PostSummary {
  body: ContentBlock[];
  seo: { title: string | null; description: string | null } | null;
}

/** Default page size for the index. */
export const POSTS_PER_PAGE = 9;

/**
 * Only published, only due.
 *
 * `publishedAt <= now()` is what makes scheduling work: an editor can set a future date and the
 * post stays invisible until then. Drafts are excluded by `perspective: "published"` in
 * lib/sanity.ts, so they need no filter here.
 */
const PUBLISHED = `_type == "post" && defined(slug.current) && publishedAt <= now()`;

/** Shared so a card on the index and the header of an article cannot disagree. */
const SUMMARY_FIELDS = `
  "slug": slug.current,
  title,
  excerpt,
  publishedAt,
  "tags": coalesce(tags, []),
  "authorName": author->name,
  "cover": select(
    defined(coverImage.asset) => {
      "url": coverImage.asset->url,
      "alt": coalesce(coverImage.alt, ""),
      "w": coverImage.asset->metadata.dimensions.width,
      "h": coverImage.asset->metadata.dimensions.height
    }
  )`;

/** One page of posts, newest first, plus the total so the UI can draw pagination. */
export async function listPosts(opts?: { page?: number; perPage?: number }): Promise<{
  posts: PostSummary[];
  total: number;
}> {
  const perPage = Math.max(1, opts?.perPage ?? POSTS_PER_PAGE);
  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const from = (page - 1) * perPage;

  const result = await groqQueryOrThrow<{ posts: PostSummary[]; total: number } | null>(
    "blog_list",
    `{
      "posts": *[${PUBLISHED}] | order(publishedAt desc) [$from...$to] { ${SUMMARY_FIELDS} },
      "total": count(*[${PUBLISHED}])
    }`,
    { from, to: from + perPage },
  );

  return { posts: result?.posts ?? [], total: result?.total ?? 0 };
}

/** One post, or null when the slug matches nothing (which the page turns into a 404). */
export async function getPostBySlug(slug: string): Promise<Post | null> {
  if (slug.trim() === "") return null;
  const post = await groqQueryOrThrow<Post | null>(
    "blog_post",
    `*[${PUBLISHED} && slug.current == $slug][0]{
      ${SUMMARY_FIELDS},
      "seo": select(defined(seo) => { "title": seo.title, "description": seo.description }),
      "body": body[]${BLOCKS_PROJECTION}
    }`,
    { slug },
  );
  if (post === null) return null;
  // A post with an empty body is still a post; the page renders its header and nothing else.
  return { ...post, body: post.body ?? [] };
}

/** Every slug, for generateStaticParams. */
export async function allPostSlugs(): Promise<string[]> {
  const slugs = await groqQueryOrThrow<string[] | null>(
    "blog_slugs",
    `*[${PUBLISHED}] | order(publishedAt desc).slug.current`,
  );
  return slugs ?? [];
}
