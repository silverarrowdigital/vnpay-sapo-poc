/**
 * Sizing for a Sanity asset URL.
 *
 * Sanity's image CDN takes transforms as query parameters on the URL the GROQ projection already
 * returned, so this repo needs no @sanity/image-url: a string is enough. Client-safe — no imports,
 * no secrets, nothing server-only.
 */

/** One sized URL. `auto=format` lets the CDN serve WebP/AVIF to browsers that accept it. */
export function sized(url: string, width: number, quality = 75): string {
  return `${url}?w=${width}&q=${quality}&auto=format&fit=max`;
}

/**
 * A srcset across the widths a slide is actually rendered at, capped at the asset's own width so
 * the CDN is never asked to upscale.
 */
export function srcSet(url: string, intrinsicWidth: number, widths = [480, 768, 1024, 1440]): string {
  const usable = widths.filter((w) => w <= intrinsicWidth);
  if (usable.length === 0) usable.push(intrinsicWidth);
  return usable.map((w) => `${sized(url, w)} ${w}w`).join(", ");
}
