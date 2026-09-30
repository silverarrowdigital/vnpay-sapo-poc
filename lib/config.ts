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
