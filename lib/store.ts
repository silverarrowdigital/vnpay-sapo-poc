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

export interface PendingOrder {
  txnRef: string;
  createdAt: string;
  customer: { name: string; phone: string; email: string; address: string };
  sku: string;
  productName: string;
  unitPriceVnd: number;
  quantity: number;
  amountVnd: number;
  status: OrderStatus;
  vnpResponseCode?: string;
  vnpTransactionNo?: string;
  sapoOrder?: SapoOrderRef;
  lastError?: string;
}

/** A pending order outlives the 15-minute VNPAY payment window by a wide margin. */
const ORDER_TTL_SECONDS = 24 * 60 * 60;

/**
 * Long enough for the slowest `createOrderOnce` (a Sapo lookup plus a create, 15 s each), short
 * enough to have expired before VNPAY's first IPN retry arrives 5 minutes later.
 */
const CLAIM_TTL_SECONDS = 120;

const ORDER_KEY = "vnpay-sapo:order:";
const CLAIM_KEY = "vnpay-sapo:claim:";

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
  return value as PendingOrder;
}

// ---------------------------------------------------------------------------
// In-memory backend (local development)
// ---------------------------------------------------------------------------

interface MemoryState {
  orders: Map<string, PendingOrder>;
  /** txnRef → epoch ms when the claim expires. */
  claims: Map<string, number>;
}

/** Kept on globalThis so `next dev`'s module reloads do not drop live orders. */
const g = globalThis as typeof globalThis & { __vnpaySapoStore?: MemoryState };
const memoryState: MemoryState = (g.__vnpaySapoStore ??= { orders: new Map(), claims: new Map() });

class MemoryOrderStore implements OrderStore {
  readonly kind = "memory" as const;

  private prune(): void {
    const now = Date.now();
    const cutoff = now - ORDER_TTL_SECONDS * 1000;
    for (const [k, v] of memoryState.orders) if (Date.parse(v.createdAt) < cutoff) memoryState.orders.delete(k);
    for (const [k, expiresAt] of memoryState.claims) if (expiresAt <= now) memoryState.claims.delete(k);
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
    // Refreshes the TTL on every write, so an order stays readable for 24 h after its last change.
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

/** Test helper: the resolved key namespace, so the environment rules can be asserted. */
export const _keyNamespace = keyNamespace;

/** Test helper: drop the in-memory state and force the backend to be chosen again. */
export function _resetStore(): void {
  memoryState.orders.clear();
  memoryState.claims.clear();
  cached = undefined;
}
