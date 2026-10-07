/**
 * Writing what happens to an order into the Postgres ledger, in parallel with Redis (T14 PR 5).
 * Server-only.
 *
 * **Redis is still the source of truth.** The shop reads its orders from Redis and an IPN is answered
 * from Redis; this module only *also* records the same facts in Postgres so that PR 6 can switch the
 * source over once the two have agreed for a while. Hence the rules:
 *
 * 1. Nothing here may stop, delay for long, or fail a payment. Every function — reads included —
 *    runs inside `guarded`: errors are caught and logged, and a call that has not answered in
 *    `LEDGER_TIMEOUT_MS` is abandoned. No database configured is a quiet no-op.
 * 2. After the database fails or times out once, further calls in this process are skipped for
 *    `BREAKER_MS`. One IPN makes four ledger calls; without this a dead database would cost it four
 *    timeouts, and every retry the same.
 * 3. **Never log what the database echoes back.** A failed drizzle query's message carries the whole
 *    SQL and its parameters — for `orders`, the customer's name, phone, email and address.
 *    `describeDbError` keeps the Postgres code and the underlying cause and drops the rest.
 * 4. Every write is idempotent, and a state never moves backwards: a payment that is `paid` is not
 *    set to `failed` by a late or replayed notification, and a Sapo order that is `created` is not set
 *    to `failed` by a stale attempt that landed after a timeout.
 *
 * `ledgerCompare` is the evidence for PR 6: after an order settles it reads the ledger back and logs
 * `ledger.mismatch` if Postgres disagrees with Redis. PR 6 does not start until that line has stayed
 * silent over real orders created after the first deploy of this file.
 *
 * Takes the database as an argument so tests can pass an in-process Postgres (PGlite).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "./db/client";
import * as schema from "./db/schema";
import { errorMessage, log } from "./log";
import type { PendingOrder } from "./store";
import type { VnpParams } from "./vnpay";

export type LedgerDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const { orders, paymentAttempts, sapoMappings, webhookInbox } = schema;

/**
 * Longest a ledger call may hold up a payment. A cold Neon compute wakes in a few hundred ms; this is
 * for the day it does not answer at all. On timeout the caller moves on (the query may still land).
 */
export const LEDGER_TIMEOUT_MS = 4_000;
/** After a failure or timeout, how long this process leaves the ledger alone. */
export const BREAKER_MS = 30_000;

let breakerUntil = 0;
/** Test hook. */
export function _resetLedgerBreaker(): void {
  breakerUntil = 0;
}

/** The cause of a database failure without the query text or its parameters (rule 3). */
export function describeDbError(err: unknown): string {
  const e = err as { message?: string; code?: string; cause?: { message?: string; code?: string } } | null;
  const message = typeof e?.message === "string" ? e.message : String(err);
  if (message.startsWith("Failed query")) {
    const cause = e?.cause;
    return `query failed: ${cause?.code ? `[${cause.code}] ` : ""}${cause?.message ?? "no cause given"}`;
  }
  return errorMessage(err);
}

/**
 * Runs `fn` against the ledger and returns its result, or `fallback` on any failure, timeout,
 * missing database or open breaker. Never throws.
 */
async function guarded<T>(what: string, txnRef: string | null, fallback: T, fn: (db: LedgerDb) => Promise<T>, db?: LedgerDb): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const target = db ?? getDb();
    if (target === undefined) return fallback;
    if (Date.now() < breakerUntil) return fallback;
    const result = await Promise.race([
      fn(target),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${LEDGER_TIMEOUT_MS} ms`)), LEDGER_TIMEOUT_MS);
      }),
    ]);
    // Positive evidence for PR 6: the ledger really was written (the log has no other trace of it).
    log.info("ledger.ok", { what, txnRef });
    return result;
  } catch (err) {
    breakerUntil = Date.now() + BREAKER_MS;
    log.error("ledger.write_failed", { what, txnRef, error: describeDbError(err) });
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A checkout started: the order and its first payment attempt. Safe to repeat. */
export async function ledgerRecordCheckout(order: PendingOrder, db?: LedgerDb): Promise<void> {
  await guarded(
    "checkout",
    order.txnRef,
    undefined,
    async (d) => {
      await d
        .insert(orders)
        .values({
          webRef: order.txnRef,
          customer: order.customer,
          lines: order.lines,
          goodsVnd: order.goodsVnd ?? order.amountVnd,
          discount: order.discount ?? null,
          shipping: order.shipping ?? null,
          amountVnd: order.amountVnd,
          paymentMethod: order.paymentMethod ?? "vnpay",
        })
        .onConflictDoNothing({ target: orders.webRef });
      // Looked up rather than taken from the insert's RETURNING: if an earlier attempt wrote the order
      // and then died before writing the attempt, this repeat still completes the pair.
      const [row] = await d.select({ id: orders.id }).from(orders).where(eq(orders.webRef, order.txnRef));
      if (row === undefined) return;
      await d
        .insert(paymentAttempts)
        .values({ orderId: row.id, vnpTxnRef: order.txnRef, amountVnd: order.amountVnd })
        .onConflictDoNothing({ target: paymentAttempts.vnpTxnRef });
    },
    db,
  );
}

/** What VNPAY told us, as evidence. The signature is dropped: a stored signature is a replayable one. */
export async function ledgerRecordWebhook(
  source: "ipn" | "querydr",
  params: VnpParams,
  rspCode: string,
  db?: LedgerDb,
): Promise<void> {
  const { vnp_SecureHash: _signature, ...safe } = params;
  void _signature;
  await guarded(
    "webhook",
    params.vnp_TxnRef ?? null,
    undefined,
    async (d) => {
      await d.insert(webhookInbox).values({ source, txnRef: params.vnp_TxnRef ?? null, params: safe, rspCode });
    },
    db,
  );
}

/**
 * The payment's outcome. `paid` always wins; `failed` and `cancelled` are recorded only for a payment
 * that is not already paid or refunded, so a late or replayed non-success notification cannot undo it.
 */
export async function ledgerRecordPayment(
  txnRef: string,
  outcome: "paid" | "failed" | "cancelled",
  params: VnpParams,
  db?: LedgerDb,
): Promise<void> {
  await guarded(
    "payment",
    txnRef,
    undefined,
    async (d) => {
      const updatable = outcome === "paid" ? ne(paymentAttempts.status, "refunded") : inArray(paymentAttempts.status, ["pending", "failed", "cancelled"]);
      const [attempt] = await d
        .update(paymentAttempts)
        .set({
          status: outcome,
          vnpTransactionNo: params.vnp_TransactionNo ?? null,
          vnpBankCode: params.vnp_BankCode ?? null,
          vnpPayDate: params.vnp_PayDate ?? null,
          vnpResponseCode: params.vnp_ResponseCode ?? null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(paymentAttempts.vnpTxnRef, txnRef), updatable))
        .returning({ orderId: paymentAttempts.orderId });
      if (attempt === undefined) return; // not found, or already beyond this outcome: nothing to move
      await d
        .update(orders)
        .set({
          paymentStatus: outcome,
          orderStatus: outcome === "paid" ? "open" : "closed",
          updatedAt: sql`now()`,
        })
        .where(eq(orders.id, attempt.orderId));
    },
    db,
  );
}

/** What happened in Sapo: the order exists there, or creating it failed (never undoing a created one). */
export async function ledgerRecordSapo(
  txnRef: string,
  result: { ok: true; id: number; name: string } | { ok: false },
  db?: LedgerDb,
): Promise<void> {
  await guarded(
    "sapo",
    txnRef,
    undefined,
    async (d) => {
      const [order] = await d.select({ id: orders.id }).from(orders).where(eq(orders.webRef, txnRef));
      if (order === undefined) return;
      await d
        .update(orders)
        .set({ integrationStatus: result.ok ? "created" : "failed", updatedAt: sql`now()` })
        .where(result.ok ? eq(orders.id, order.id) : and(eq(orders.id, order.id), ne(orders.integrationStatus, "created")));
      if (result.ok) {
        await d
          .insert(sapoMappings)
          .values({ orderId: order.id, sapoOrderId: result.id, sapoOrderName: result.name })
          .onConflictDoNothing({ target: sapoMappings.orderId });
      }
    },
    db,
  );
}

/** What Redis's single status means in the ledger's separate ones. */
export function expectedLedgerState(status: PendingOrder["status"]): { payment: string; integration: string } | undefined {
  switch (status) {
    case "completed":
      return { payment: "paid", integration: "created" };
    case "sapo_error":
      return { payment: "paid", integration: "failed" };
    case "cancelled":
      return { payment: "cancelled", integration: "none" };
    case "failed":
      return { payment: "failed", integration: "none" };
    default:
      return undefined; // pending / processing: nothing settled yet to compare
  }
}

/**
 * Read the ledger back and say so if it disagrees with the Redis record. `true` when they agree,
 * when there is nothing to compare, or when the ledger could not be read (not evidence of anything);
 * `false` on a mismatch, which is also logged. Both log lines carry the order's `createdAt`: an order
 * created before the ledger existed has no row and must be filterable from a real failure.
 */
export async function ledgerCompare(order: PendingOrder, db?: LedgerDb): Promise<boolean> {
  const expected = expectedLedgerState(order.status);
  if (expected === undefined) return true;
  return guarded(
    "compare",
    order.txnRef,
    true,
    async (d) => {
      const [row] = await d
        .select({ payment: orders.paymentStatus, integration: orders.integrationStatus })
        .from(orders)
        .where(eq(orders.webRef, order.txnRef));
      if (row === undefined) {
        log.warn("ledger.mismatch", { txnRef: order.txnRef, reason: "no ledger row", redis: order.status, createdAt: order.createdAt });
        return false;
      }
      if (row.payment !== expected.payment || row.integration !== expected.integration) {
        log.warn("ledger.mismatch", {
          txnRef: order.txnRef,
          redis: order.status,
          ledgerPayment: row.payment,
          ledgerIntegration: row.integration,
          createdAt: order.createdAt,
        });
        return false;
      }
      return true;
    },
    db,
  );
}

/**
 * Empty the personal data of every order past its `purge_after` (90 days), keeping the order's money
 * and Sapo links. Returns how many rows were emptied. Called by the daily cron (app/api/cron/purge).
 */
export async function ledgerPurgeCustomers(db?: LedgerDb): Promise<number> {
  return guarded(
    "purge",
    null,
    0,
    async (d) => {
      const rows = await d
        .update(orders)
        .set({ customer: null, customerPurgedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(sql`${orders.purgeAfter} < now()`, sql`${orders.customer} is not null`))
        .returning({ id: orders.id });
      return rows.length;
    },
    db,
  );
}
