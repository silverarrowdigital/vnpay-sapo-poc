import { isValidSignature, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { getSanityWebhookSecret } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sanity calls this when content is published, and we drop the matching cache tag.
 *
 * This endpoint is what makes the long cache windows affordable. Blog queries are cached for an
 * hour and product content for five minutes; without a way to invalidate, those windows would have
 * to be short, and short windows mean many more requests to Sanity — the limit the free plan hits
 * first. With this, the windows can be long and publishing is still immediate.
 *
 * **Every request is signature-checked**, and an unset secret refuses everything. An open
 * revalidate endpoint is both a way in and a way to empty the cache in a loop, which would turn
 * the quota protection into its opposite.
 *
 * Signature verification uses Sanity's own `@sanity/webhook` rather than a hand-rolled HMAC: this
 * repo hand-rolls VNPAY's because that scheme is documented and verified here, while getting
 * Sanity's subtly wrong would leave a check that looks present and is not.
 */
export async function POST(request: NextRequest) {
  const secret = getSanityWebhookSecret();
  if (secret === undefined) {
    log.error("revalidate.no_secret", {});
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const signature = request.headers.get(SIGNATURE_HEADER_NAME);
  if (signature === null) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // The raw text is what was signed, so it must be read before anything parses it.
  const body = await request.text();

  let valid: boolean;
  try {
    valid = await isValidSignature(body, signature, secret);
  } catch (err) {
    // A malformed header is a failed check, not a server error.
    log.warn("revalidate.signature_error", { error: errorMessage(err) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!valid) {
    log.warn("revalidate.signature_invalid", {});
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let documentType: string | undefined;
  try {
    const payload: unknown = JSON.parse(body);
    if (typeof payload === "object" && payload !== null) {
      const type = (payload as { _type?: unknown })._type;
      if (typeof type === "string") documentType = type;
    }
  } catch {
    // Signature was valid, so the body came from Sanity; an unreadable one just means we cannot
    // narrow the tag and clear both instead.
  }

  // `post` and `author` both change what the blog renders, because a post shows its author's name.
  const tags =
    documentType === "productContent"
      ? ["product-content"]
      : documentType === "post" || documentType === "author"
        ? ["blog"]
        : ["blog", "product-content"];

  // Next 16 requires a cache-life profile; the one-argument form is deprecated. "max" expires the
  // entry as aggressively as the profile allows, which is what a "this just changed" signal means.
  for (const tag of tags) revalidateTag(tag, "max");
  log.info("revalidate.done", { documentType: documentType ?? "unknown", tags });

  return NextResponse.json({ revalidated: tags });
}
