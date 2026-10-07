/**
 * Pending-order storage: the record a checkout writes and the IPN reads back.
 *
 * Two backends behind one interface, picked per process by whether Redis is configured:
 *
 * - **Redis** (Upstash REST via `@upstash/redis`) when the Redis env vars are set. Every instance
 *   shares the state, which is what makes the flow work on serverless: `/api/checkout`,
 *   `/api/vnpay/ipn` and `/success` can each run in a different lambda and still agree.
 * - **In-memory Map** otherwise, so `next dev` needs no extra service. One process only, lost on
 *   restart — fine locally, never reliable on Vercel.
 *
 * The IPN needs one guarantee the Map got for free by being a single process: only one caller may
 * create the Sapo order for a given txnRef. `claim()` provides it with Redis `SET NX EX`, which is
 * atomic across instances. The claim carries a TTL, so a crash between claiming and finishing does
 * not wedge the order forever — the next VNPAY IPN retry re-claims it. Sapo's own lookup in
 * `createOrderOnce` stays the second guard, so even a claim lost to an expiry cannot produce two
 * orders.
 *
 * Framework-independent (no Next.js imports), like the rest of `lib/`.
 */
import { Redis } from "@upstash/redis";
import { getRedisConfig } from "./config";
import { errorMessage, log } from "./log";
import type { SapoOrderRef } from "./sapo";

export type OrderStatus =
  | "pending" // payment URL issued, waiting for VNPAY
  | "processing" // IPN accepted, creating Sapo order
  | "completed" // paid + Sapo order exists
  | "sapo_error" // paid, but Sapo creation failed — will retry on next IPN
  | "cancelled" // customer cancelled at VNPAY
  | "failed"; // payment failed

/**
 * One priced line of an order. Prices are what the server resolved from Sapo at checkout time, so
 * the IPN records what the customer actually saw even if the catalog changed in between.
 */
export interface PendingOrderLine {
  /** Sapo variant id. Absent only for a legacy record written before the cart existed. */
  variantId?: number;
  sku: string;
  productName: string;
  /**
   * The size/option the customer picked ("200g ~ 66 Servings"). **Optional and absent for a
   * single-variant product and for any record written before sizes existed** — readers treat a
   * missing one as "no label", never as an error.
   */
  variantLabel?: string;
  unitPriceVnd: number;
  quantity: number;
}

/**
 * The customer and where the order goes.
 *
 * `address` is the street line the customer typed; the three administrative levels are resolved
 * server-side from Sapo's own tables (see lib/locations.ts) and stored by **name and code**, not
 * by id. The names are what a courier reads and what Sapo records, and they must not change
 * meaning later if Sapo renumbers a ward — the record has to keep saying where this order was
 * actually sent. All six are optional because records written before T7.1 have none of them.
 */
export interface PendingOrderCustomer {
  name: string;
  phone: string;
  email: string;
  address: string;
  ward?: string;
  wardCode?: string;
  district?: string;
  districtCode?: string;
  province?: string;
  provinceCode?: string;
  /** Kept only so the shipping fee can be re-derived from the same province the quote used. */
  provinceId?: number;
}

export interface PendingOrder {
  txnRef: string;
  createdAt: string;
  customer: PendingOrderCustomer;
  lines: PendingOrderLine[];
  /**
   * The total charged: goods − discount + shipping. This is the number the VNPAY URL is signed
   * with and the number the IPN checks `vnp_Amount` against, so its meaning must not drift.
   */
  amountVnd: number;
  /** Goods only, before discount and before shipping. Absent on pre-T7 records. */
  goodsVnd?: number;
  /** A discount the server verified and computed. Never a number the browser sent. */
  discount?: { code: string; amountVnd: number; summary?: string };
  shipping?: { title: string; code: string; priceVnd: number };
  /** Absent means VNPAY: every record written before COD existed was a VNPAY order. */
  paymentMethod?: "vnpay" | "cod";
  status: OrderStatus;
  vnpResponseCode?: string;
  vnpTransactionNo?: string;
  sapoOrder?: SapoOrderRef;
  lastError?: string;
}

/**
 * A pending order outlives the 15-minute VNPAY payment window by a wide margin: seven days (T13.5;
 * it was 24 hours). The long tail is for the IPN that arrives late or has to be recovered by hand —
 * VNPAY itself retries for under an hour, but a reference the shop owner reconciles the next day
 * should still find its record rather than answer `01` for money already taken. Redis refreshes it on
 * every write; the cost is a few kilobytes per order for a week.
 */
const ORDER_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Long enough for the slowest `createOrderOnce` (a Sapo lookup plus a create, 15 s each), short
 * enough to have expired before VNPAY's first IPN retry arrives 5 minutes later.
 */
const CLAIM_TTL_SECONDS = 120;

const ORDER_KEY = "vnpay-sapo:order:";
const CLAIM_KEY = "vnpay-sapo:claim:";
const RATE_KEY = "vnpay-sapo:rate:";
const KV_KEY = "vnpay-sapo:kv:";

/**
 * Key namespace, inserted after the fixed prefix.
 *
 * One Redis database is attached to every Vercel environment at once, so a preview deployment of a
 * branch that changed `PendingOrder` would otherwise write records straight into the set that
 * production reads — and production, running older code, would mis-read them for a real customer.
 * Namespacing by environment keeps them apart.
 *
 * **Production deliberately keeps the unprefixed keys** it has always used, so shipping this
 * change cannot orphan an order that is mid-payment. Everything else gets its own space: a preview
 * is keyed by branch (`VERCEL_GIT_COMMIT_REF`) rather than by deployment, so redeploying a branch
 * keeps its orders, and a local server is `local`.
 *
 * `ORDER_STORE_NAMESPACE` overrides all of it. Setting it to an empty string selects production's
 * namespace, which is how a local server can finish an order whose IPN VNPAY delivers to the
 * production deployment (the portal holds one IPN URL). That is only safe while the local code
 * still agrees with production about the shape of a `PendingOrder`.
 */
function keyNamespace(): string {
  const override = process.env.ORDER_STORE_NAMESPACE;
  if (override !== undefined) {
    const trimmed = override.trim();
    return trimmed === "" ? "" : `${trimmed}:`;
  }
  const env = process.env.VERCEL_ENV?.trim();
  if (env === undefined || env === "") return "local:";
  if (env === "production") return "";
  // Branch names allow characters Redis keys are better off without.
  const ref = process.env.VERCEL_GIT_COMMIT_REF?.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${env}-${ref || "unknown"}:`;
}

export interface OrderStore {
  /** Which backend is in use, for logging and for the result page's wording. */
  readonly kind: "redis" | "memory";
  get(txnRef: string): Promise<PendingOrder | undefined>;
  /** Create or overwrite the record. */
  put(order: PendingOrder): Promise<void>;
  has(txnRef: string): Promise<boolean>;
  /**
   * Try to become the single caller allowed to process this txnRef.
   * `true` means the caller owns it, `false` that someone else already does.
   */
  claim(txnRef: string): Promise<boolean>;
  release(txnRef: string): Promise<void>;
  /**
   * Count one hit against `key` and return the running total inside the current window.
   *
   * A counter, not a verdict: the caller owns the limit, because "5 checkouts a minute" and "10
   * lookup attempts an hour" are different policies over the same primitive. The window starts at
   * the first hit and the key disappears when it ends, so a quiet caller is never penalised for
   * what it did an hour ago.
   *
   * On Redis this is shared across instances, which is the only way a rate limit means anything on
   * serverless. On the Map it is per-process — the same caveat as everything else in that backend.
   */
  hit(key: string, windowSeconds: number): Promise<number>;
  /**
   * The running total for `key` **without counting a hit** (0 when there is none or its window has
   * ended). It exists for "has this already been done?" checks that must only be recorded after the
   * thing succeeded — see lib/alert.ts, where counting before sending would let one failed email
   * silence an incident for an hour.
   */
  count(key: string): Promise<number>;
  /**
   * A short string kept under `key` for `ttlSeconds` (T13.4: "this checkout request already
   * produced that payment URL"). `kvSetIfAbsent` is atomic — exactly one concurrent caller gets
   * `true` — and is what makes two simultaneous submits of one form into one order.
   */
  kvGet(key: string): Promise<string | undefined>;
  kvSet(key: string, value: string, ttlSeconds: number): Promise<void>;
  kvSetIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  kvDelete(key: string): Promise<void>;
}

/**
 * Records come back from Redis as whatever was stored, so treat them as untrusted shape rather
 * than casting. A record we cannot read is reported as absent, which makes the IPN answer `01`
 * and VNPAY retry — never invent an order out of a bad row.
 */
function toPendingOrder(raw: unknown): PendingOrder | undefined {
  if (raw === null || raw === undefined) return undefined;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      log.warn("store.unparseable_order");
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const o = value as Partial<PendingOrder>;
  if (typeof o.txnRef !== "string" || typeof o.amountVnd !== "number" || typeof o.status !== "string") {
    log.warn("store.malformed_order", { txnRef: typeof o.txnRef === "string" ? o.txnRef : undefined });
    return undefined;
  }
  const lines = normaliseLines(value);
  if (lines === undefined) {
    log.warn("store.order_without_lines", { txnRef: o.txnRef });
    return undefined;
  }
  return { ...(value as PendingOrder), lines };
}

/** The single-product record this code wrote before carts existed. */
interface LegacyOrderFields {
  sku?: unknown;
  productName?: unknown;
  unitPriceVnd?: unknown;
  quantity?: unknown;
}

/**
 * Reads the lines of a stored order, accepting the pre-cart shape.
 *
 * Production shares one key namespace across deploys of `main`, so the first deploy that
 * understands carts will read records the previous deploy wrote for orders that were mid-payment.
 * Those carry `sku`/`quantity` at the top level instead of `lines`; folding them into a single line
 * here is what keeps such an order from being dropped at the moment its IPN arrives.
 */
function normaliseLines(value: unknown): PendingOrderLine[] | undefined {
  const o = value as { lines?: unknown } & LegacyOrderFields;
  if (Array.isArray(o.lines)) {
    const lines = o.lines.filter(isPendingOrderLine);
    return lines.length === o.lines.length && lines.length > 0 ? lines : undefined;
  }
  if (typeof o.sku === "string" && typeof o.unitPriceVnd === "number" && typeof o.quantity === "number") {
    return [
      {
        sku: o.sku,
        productName: typeof o.productName === "string" ? o.productName : o.sku,
        unitPriceVnd: o.unitPriceVnd,
        quantity: o.quantity,
      },
    ];
  }
  return undefined;
}

function isPendingOrderLine(line: unknown): line is PendingOrderLine {
  if (typeof line !== "object" || line === null) return false;
  const l = line as Partial<PendingOrderLine>;
  return (
    typeof l.sku === "string" &&
    typeof l.productName === "string" &&
    typeof l.unitPriceVnd === "number" &&
    typeof l.quantity === "number"
  );
}

// ---------------------------------------------------------------------------
// In-memory backend (local development)
// ---------------------------------------------------------------------------

interface MemoryState {
  orders: Map<string, PendingOrder>;
  /** txnRef → epoch ms when the claim expires. */
  claims: Map<string, number>;
  /** rate-limit key → running count and when the window ends. */
  hits: Map<string, { count: number; expiresAt: number }>;
  /** kv key → value and when it expires. */
  kv: Map<string, { value: string; expiresAt: number }>;
}

/** Kept on globalThis so `next dev`'s module reloads do not drop live orders. */
const g = globalThis as typeof globalThis & { __vnpaySapoStore?: MemoryState };
const memoryState: MemoryState = (g.__vnpaySapoStore ??= { orders: new Map(), claims: new Map(), hits: new Map(), kv: new Map() });
// A process that was running before `hits` existed keeps its state object, so make sure the new
// map is there rather than trusting the `??=` above to have built it.
memoryState.hits ??= new Map();
memoryState.kv ??= new Map();

class MemoryOrderStore implements OrderStore {
  readonly kind = "memory" as const;

  private prune(): void {
    const now = Date.now();
    const cutoff = now - ORDER_TTL_SECONDS * 1000;
    for (const [k, v] of memoryState.orders) if (Date.parse(v.createdAt) < cutoff) memoryState.orders.delete(k);
    for (const [k, expiresAt] of memoryState.claims) if (expiresAt <= now) memoryState.claims.delete(k);
    for (const [k, h] of memoryState.hits) if (h.expiresAt <= now) memoryState.hits.delete(k);
    for (const [k, v] of memoryState.kv) if (v.expiresAt <= now) memoryState.kv.delete(k);
  }

  async get(txnRef: string): Promise<PendingOrder | undefined> {
    return memoryState.orders.get(txnRef);
  }

  async put(order: PendingOrder): Promise<void> {
    this.prune();
    memoryState.orders.set(order.txnRef, order);
  }

  async has(txnRef: string): Promise<boolean> {
    return memoryState.orders.has(txnRef);
  }

  async claim(txnRef: string): Promise<boolean> {
    const now = Date.now();
    const expiresAt = memoryState.claims.get(txnRef);
    if (expiresAt !== undefined && expiresAt > now) return false;
    memoryState.claims.set(txnRef, now + CLAIM_TTL_SECONDS * 1000);
    return true;
  }

  async release(txnRef: string): Promise<void> {
    memoryState.claims.delete(txnRef);
  }

  async hit(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const current = memoryState.hits.get(key);
    if (current === undefined || current.expiresAt <= now) {
      memoryState.hits.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  async count(key: string): Promise<number> {
    const current = memoryState.hits.get(key);
    return current !== undefined && current.expiresAt > Date.now() ? current.count : 0;
  }

  async kvGet(key: string): Promise<string | undefined> {
    const v = memoryState.kv.get(key);
    return v !== undefined && v.expiresAt > Date.now() ? v.value : undefined;
  }

  async kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    memoryState.kv.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async kvSetIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    // No await between the check and the write: that gap is what makes a test-and-set atomic here.
    const current = memoryState.kv.get(key);
    if (current !== undefined && current.expiresAt > Date.now()) return false;
    memoryState.kv.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async kvDelete(key: string): Promise<void> {
    memoryState.kv.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Redis backend (serverless-safe)
// ---------------------------------------------------------------------------

class RedisOrderStore implements OrderStore {
  readonly kind = "redis" as const;

  constructor(
    private readonly redis: Redis,
    /** Resolved once when the store is built; see keyNamespace(). */
    private readonly namespace: string,
  ) {}

  private orderKey(txnRef: string): string {
    return ORDER_KEY + this.namespace + txnRef;
  }

  private claimKey(txnRef: string): string {
    return CLAIM_KEY + this.namespace + txnRef;
  }

  async get(txnRef: string): Promise<PendingOrder | undefined> {
    return toPendingOrder(await this.redis.get<unknown>(this.orderKey(txnRef)));
  }

  async put(order: PendingOrder): Promise<void> {
    // Refreshes the TTL on every write, so an order stays readable for 7 days after its last change.
    await this.redis.set(this.orderKey(order.txnRef), order, { ex: ORDER_TTL_SECONDS });
  }

  async has(txnRef: string): Promise<boolean> {
    return (await this.redis.get<unknown>(this.orderKey(txnRef))) !== null;
  }

  async claim(txnRef: string): Promise<boolean> {
    // SET NX EX is the atomic part: exactly one concurrent caller gets "OK", the rest get null.
    const result = await this.redis.set(this.claimKey(txnRef), new Date().toISOString(), {
      nx: true,
      ex: CLAIM_TTL_SECONDS,
    });
    return result === "OK";
  }

  async release(txnRef: string): Promise<void> {
    await this.redis.del(this.claimKey(txnRef));
  }

  async hit(key: string, windowSeconds: number): Promise<number> {
    const k = RATE_KEY + this.namespace + key;
    const count = await this.redis.incr(k);
    // Only the caller that created the key sets its lifetime, so the window measures from the
    // first hit. Setting it on every hit would turn a steady stream into a window that never ends.
    if (count === 1) await this.redis.expire(k, windowSeconds);
    return count;
  }

  async count(key: string): Promise<number> {
    const n = await this.redis.get<number>(RATE_KEY + this.namespace + key);
    return typeof n === "number" ? n : Number(n ?? 0) || 0;
  }

  async kvGet(key: string): Promise<string | undefined> {
    const v = await this.redis.get<unknown>(KV_KEY + this.namespace + key);
    return typeof v === "string" ? v : v === null || v === undefined ? undefined : JSON.stringify(v);
  }

  async kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(KV_KEY + this.namespace + key, value, { ex: ttlSeconds });
  }

  async kvSetIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(KV_KEY + this.namespace + key, value, { nx: true, ex: ttlSeconds })) === "OK";
  }

  async kvDelete(key: string): Promise<void> {
    await this.redis.del(KV_KEY + this.namespace + key);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: OrderStore | undefined;

/**
 * The store for this process. Redis when configured, otherwise the in-memory Map.
 * Cached because building the Upstash client per request is pointless — it is a REST client
 * with no connection to keep open.
 */
export function getOrderStore(): OrderStore {
  if (cached !== undefined) return cached;
  const redis = getRedisConfig();
  if (redis === undefined) {
    log.warn("store.in_memory", { reason: "Redis env vars not set; state is per-process and lost on restart" });
    cached = new MemoryOrderStore();
    return cached;
  }
  try {
    const namespace = keyNamespace();
    cached = new RedisOrderStore(new Redis({ url: redis.url, token: redis.token }), namespace);
    // The namespace is not a secret and knowing it is what makes a cross-environment mix-up
    // diagnosable from the logs alone.
    log.info("store.redis", { namespace: namespace === "" ? "(production)" : namespace.replace(/:$/, "") });
  } catch (err) {
    // A malformed URL is the only realistic failure here; the client itself makes no request.
    log.error("store.redis_init_failed", { error: errorMessage(err) });
    throw err;
  }
  return cached;
}

/** Test helper: reading a stored record, so the legacy-shape fallback can be asserted. */
export const _toPendingOrder = toPendingOrder;

/** Test helper: the resolved key namespace, so the environment rules can be asserted. */
export const _keyNamespace = keyNamespace;

/** Test helper: drop the in-memory state and force the backend to be chosen again. */
export function _resetStore(): void {
  memoryState.orders.clear();
  memoryState.claims.clear();
  memoryState.hits.clear();
  memoryState.kv.clear();
  cached = undefined;
}
