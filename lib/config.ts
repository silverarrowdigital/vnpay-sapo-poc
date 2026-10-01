/**
 * Server-only configuration. Every secret is read from process.env at call time
 * (never at module load) so a missing variable produces a clear error per request
 * instead of crashing the build. Nothing here may be imported by client components.
 */

export class MissingEnvError extends Error {
  constructor(
    /** Variables that are absent or empty. */
    public readonly missing: string[],
    /** Variables still set to a placeholder copied from .env.example. */
    public readonly placeholder: string[] = [],
  ) {
    const parts = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : undefined,
      placeholder.length > 0 ? `placeholder: ${placeholder.join(", ")}` : undefined,
    ].filter((part) => part !== undefined);
    super(`Environment not configured (${parts.join("; ")})`);
    this.name = "MissingEnvError";
  }
}

/**
 * Literal dummy values shipped in .env.example. They are present but meaningless, so we
 * treat them as unconfigured: otherwise checkout would build a payment URL VNPAY rejects,
 * or take a payment we could never record in Sapo.
 */
const PLACEHOLDER_VALUES = new Set(["https://your-public-url.example.com", "your-store.mysapo.net"]);

function isPlaceholder(value: string): boolean {
  return value.toUpperCase().startsWith("YOUR_") || PLACEHOLDER_VALUES.has(value.toLowerCase());
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function requireAll<K extends string>(names: readonly K[]): Record<K, string> {
  const missing: string[] = [];
  const placeholder: string[] = [];
  for (const name of names) {
    const value = read(name);
    if (value === undefined) missing.push(name);
    else if (isPlaceholder(value)) placeholder.push(name);
  }
  if (missing.length > 0 || placeholder.length > 0) throw new MissingEnvError(missing, placeholder);
  return Object.fromEntries(names.map((n) => [n, read(n) as string])) as Record<K, string>;
}

/** Official VNPAY sandbox payment page (docs: sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html). */
export const VNPAY_SANDBOX_PAYMENT_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";

export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  paymentUrl: string;
  returnUrl: string;
}

export function getVnpayConfig(): VnpayConfig {
  const env = requireAll(["VNPAY_TMN_CODE", "VNPAY_HASH_SECRET", "APP_BASE_URL"] as const);
  const base = env.APP_BASE_URL.replace(/\/+$/, "");
  return {
    tmnCode: env.VNPAY_TMN_CODE,
    hashSecret: env.VNPAY_HASH_SECRET,
    paymentUrl: read("VNPAY_PAYMENT_URL") ?? VNPAY_SANDBOX_PAYMENT_URL,
    returnUrl: `${base}/api/vnpay/return`,
  };
}

export interface SapoConfig {
  /** e.g. "your-store.mysapo.net" — no protocol, no trailing slash */
  storeDomain: string;
  apiKey: string;
  apiSecret: string;
  /**
   * Optional: link the order line to a real Sapo variant instead of a custom line item.
   * When set, buildOrderPayload also sends inventory_behaviour "decrement_ignoring_policy",
   * so a paid order deducts stock and may drive it negative rather than ever being refused.
   * Without this id the line item is custom and no stock moves. See lib/sapo.ts.
   */
  variantId?: number;
}

export function getSapoConfig(): SapoConfig {
  const env = requireAll(["SAPO_STORE_DOMAIN", "SAPO_API_KEY", "SAPO_API_SECRET"] as const);
  const storeDomain = env.SAPO_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const rawVariant = read("SAPO_VARIANT_ID");
  let variantId: number | undefined;
  if (rawVariant !== undefined) {
    variantId = Number(rawVariant);
    if (!Number.isSafeInteger(variantId) || variantId <= 0) {
      throw new MissingEnvError(["SAPO_VARIANT_ID (must be a positive integer if set)"]);
    }
  }
  return { storeDomain, apiKey: env.SAPO_API_KEY, apiSecret: env.SAPO_API_SECRET, variantId };
}

export interface SanityConfig {
  projectId: string;
  dataset: string;
  /** Pinned API date. Sanity treats an unpinned version as "whatever is current", which can change under us. */
  apiVersion: string;
  /**
   * Optional read token. **Normally unset, and should stay that way.**
   *
   * A token forces reads past Sanity's CDN to the origin, which is slower and counts against the
   * costlier request quota — on the free plan that is the limit you hit first. Published content
   * is public anyway, so there is nothing for a token to protect here.
   *
   * It stays supported for one future case: reading drafts for a preview mode. That would also
   * mean relaxing `perspective: "published"` in lib/sanity.ts, which currently hides drafts
   * whether or not a token is present.
   *
   * See CLAUDE.md "Document ids must not contain a dot" for why anonymous reads once appeared to
   * be blocked, and why the answer was an id, not a credential.
   */
  readToken?: string;
}

/** Default when SANITY_API_VERSION is unset. A date, never "v1" or "X". */
export const SANITY_DEFAULT_API_VERSION = "2026-10-01";

/**
 * Optional CMS for product descriptions and the blog.
 *
 * Returns `undefined` rather than throwing, which is the opposite of getSapoConfig() and is
 * deliberate: Sapo holds price and stock, so charging against stale or absent Sapo data is a
 * money problem and must block checkout. Sanity only holds presentation, so an unconfigured or
 * unreachable CMS has to degrade to the plain-text description instead of taking the product
 * page down. See lib/content.ts and CLAUDE.md.
 */
export function getSanityConfig(): SanityConfig | undefined {
  const projectId = read("SANITY_PROJECT_ID");
  if (projectId === undefined || isPlaceholder(projectId)) return undefined;
  const dataset = read("SANITY_DATASET");
  const readToken = read("SANITY_READ_TOKEN");
  return {
    projectId,
    dataset: dataset !== undefined && !isPlaceholder(dataset) ? dataset : "production",
    apiVersion: read("SANITY_API_VERSION") ?? SANITY_DEFAULT_API_VERSION,
    readToken: readToken !== undefined && !isPlaceholder(readToken) ? readToken : undefined,
  };
}

/**
 * Public base URL of this deployment, without a trailing slash, or `undefined` when unset.
 *
 * `getVnpayConfig()` demands it because a payment cannot be started without a return URL. The
 * sitemap only wants it, and does without rather than failing a build over it.
 */
export function getAppBaseUrl(): string | undefined {
  const base = read("APP_BASE_URL");
  if (base === undefined || isPlaceholder(base)) return undefined;
  return base.replace(/\/+$/, "");
}

/**
 * Shared secret for Sanity's content webhook, which tells us to drop cached content.
 *
 * `undefined` means the route refuses every request. That is the right default: without
 * verification anyone could call the endpoint in a loop to clear the cache, which is both a way in
 * and a way to burn the free plan's request quota — the very thing the long cache windows exist to
 * protect. See app/api/revalidate/route.ts.
 */
export function getSanityWebhookSecret(): string | undefined {
  const secret = read("SANITY_WEBHOOK_SECRET");
  if (secret === undefined || isPlaceholder(secret)) return undefined;
  return secret;
}

export interface RedisConfig {
  url: string;
  token: string;
}

/**
 * Optional shared store for pending orders. Without it the app falls back to an in-memory Map,
 * which only works when checkout and the IPN reach the same process (see lib/store.ts).
 *
 * Two naming conventions exist and both are accepted: Vercel's Marketplace Redis integration
 * injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`, while a database created directly at Upstash
 * gives `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. The UPSTASH_* pair wins when both
 * are present, matching Redis.fromEnv() in @upstash/redis.
 */
export function getRedisConfig(): RedisConfig | undefined {
  const url = read("UPSTASH_REDIS_REST_URL") ?? read("KV_REST_API_URL");
  const token = read("UPSTASH_REDIS_REST_TOKEN") ?? read("KV_REST_API_TOKEN");
  if (url === undefined || token === undefined) return undefined;
  if (isPlaceholder(url) || isPlaceholder(token)) return undefined;
  return { url, token };
}
