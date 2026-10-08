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
 *    `BREAKER_MS`. One IPN makes several ledger calls; without this a dead database would cost it a
 *    timeout for each, and every retry the same.
 * 3. **Never log what the database echoes back.** A failed drizzle query's message carries the whole
 *    SQL and its parameters — for `orders`, the customer's name, phone, email and address.
 *    `describeDbError` keeps the Postgres code and the underlying cause and drops the rest.
 * 4. Every write is idempotent, and a state never moves backwards: a payment that is `paid` is not
 *    set to `failed` by a late or replayed notification, and a Sapo order that is `created` is not set
 *    to `failed` by a stale attempt that landed after a timeout.
 *
 * **One exception since PR 6b:** `ledgerCommitPaid` is what lets the IPN answer `00` before Sapo has the
 * order. It still never throws or blocks — it reports `unavailable` and the IPN falls back to the path it
 * had before — but when it reports `committed` the payment and its Sapo job are durable, together.
 *
 * `ledgerCompare` is the evidence for PR 6: after an order settles it reads the ledger back and logs
 * `ledger.mismatch` if Postgres disagrees with Redis. PR 6 does not start until that line has stayed
 * silent over real orders created after the first deploy of this file.
 *
 * Takes the database as an argument so tests can pass an in-process Postgres (PGlite).
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "./db/client";
import * as schema from "./db/schema";
import { errorMessage, log } from "./log";
import { _keyNamespace, type PendingOrder } from "./store";
import type { VnpParams } from "./vnpay";

export type LedgerDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const { orders, outboxJobs, paymentAttempts, sapoMappings, webhookInbox } = schema;

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
async function guarded<T>(
  what: string,
  txnRef: string | null,
  fallback: T,
  fn: (db: LedgerDb) => Promise<T>,
  db?: LedgerDb,
  /** A read that fails or is slow must not switch off the writes of a payment running at the same moment. */
  opensBreaker = true,
): Promise<T> {
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
    if (opensBreaker) breakerUntil = Date.now() + BREAKER_MS;
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

// ---------------------------------------------------------------------------
// PR 6b: the payment and its Sapo job, committed together before the IPN answers
// ---------------------------------------------------------------------------

export const SAPO_JOB_KIND = "create_sapo_order";
/** After this many failed tries the job is `failed` and the owner is told (lib/order.ts). */
export const SAPO_JOB_MAX_ATTEMPTS = 8;
/**
 * Minutes before the next try after the 1st…7th failure: about 83 minutes in all, inside the two hours
 * a signed-"paid" hint keeps the sweep awake (lib/sweep.ts), which every failure renews.
 */
const SAPO_JOB_BACKOFF_MINUTES = "{1,2,5,10,15,20,30}";

/** The job's unique key: one Sapo order per reference, enforced by the database. */
export function sapoJobKey(txnRef: string): string {
  return `${SAPO_JOB_KIND}:${txnRef}`;
}

/**
 * - `committed`: this call moved the payment to paid and queued the job, atomically.
 * - `already`: the ledger already had the payment as paid (an earlier IPN or retry got here first); the
 *   job is guaranteed to exist, nothing else changed.
 * - `unavailable`: nothing is known to be durable — no database, open breaker, error (rolled back),
 *   timeout, a schema without the dedupe key, or a payment already refunded. The caller must then behave
 *   exactly as before PR 6b.
 */
export type CommitPaidResult = "committed" | "already" | "unavailable";

/**
 * Record a verified successful payment and queue its Sapo order in **one transaction**, so that either
 * both are durable or neither is. The IPN answers VNPAY `00` on the strength of this even when Sapo then
 * fails: the job, not VNPAY's retry, finishes the order (docs/plan/T14-6b-ipn-ghi-so-truoc.md).
 *
 * The order and its attempt are upserted from the Redis record first, so a payment whose checkout write
 * to the ledger was lost (a cold database at checkout) still becomes durable here.
 *
 * On a timeout the transaction may still commit later; the caller then also takes the old path, and the
 * job's dedupe key plus the Sapo tag lookup keep that from making a second order.
 */
export async function ledgerCommitPaid(order: PendingOrder, params: VnpParams, db?: LedgerDb): Promise<CommitPaidResult> {
  const txnRef = order.txnRef;
  const result = await guarded<CommitPaidResult | "refunded">(
    "commit_paid",
    txnRef,
    "unavailable",
    (d) =>
      d.transaction(async (tx) => {
        await tx
          .insert(orders)
          .values({
            webRef: txnRef,
            customer: order.customer,
            lines: order.lines,
            goodsVnd: order.goodsVnd ?? order.amountVnd,
            discount: order.discount ?? null,
            shipping: order.shipping ?? null,
            amountVnd: order.amountVnd,
            paymentMethod: order.paymentMethod ?? "vnpay",
          })
          .onConflictDoNothing({ target: orders.webRef });
        const [o] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.webRef, txnRef));
        if (o === undefined) throw new Error("ledger order row missing after upsert");
        await tx
          .insert(paymentAttempts)
          .values({ orderId: o.id, vnpTxnRef: txnRef, amountVnd: order.amountVnd })
          .onConflictDoNothing({ target: paymentAttempts.vnpTxnRef });
        // Locked until commit: a concurrent commit for the same reference waits here, then sees `paid`.
        const [a] = await tx
          .select({ status: paymentAttempts.status })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.vnpTxnRef, txnRef))
          .for("update");
        if (a === undefined) throw new Error("ledger payment attempt missing after upsert");
        if (a.status === "refunded") return "refunded";
        const already = a.status === "paid";
        if (!already) {
          await tx
            .update(paymentAttempts)
            .set({
              status: "paid",
              vnpTransactionNo: params.vnp_TransactionNo ?? null,
              vnpBankCode: params.vnp_BankCode ?? null,
              vnpPayDate: params.vnp_PayDate ?? null,
              vnpResponseCode: params.vnp_ResponseCode ?? null,
              updatedAt: sql`now()`,
            })
            .where(eq(paymentAttempts.vnpTxnRef, txnRef));
          await tx
            .update(orders)
            .set({ paymentStatus: "paid", orderStatus: "open", updatedAt: sql`now()` })
            .where(eq(orders.id, o.id));
        }
        await tx
          .insert(outboxJobs)
          .values({ kind: SAPO_JOB_KIND, orderId: o.id, dedupeKey: sapoJobKey(txnRef), payload: { txnRef, ns: _keyNamespace() } })
          .onConflictDoNothing({ target: outboxJobs.dedupeKey });
        return already ? "already" : "committed";
      }),
    db,
  );
  if (result === "refunded") {
    log.warn("ledger.commit_refused", { txnRef, reason: "payment already refunded" });
    return "unavailable";
  }
  return result;
}

/** The Sapo order exists: the job is done. Never moves a job that is already done. */
export async function ledgerFinishSapoJob(txnRef: string, db?: LedgerDb): Promise<void> {
  await guarded(
    "job_done",
    txnRef,
    undefined,
    async (d) => {
      await d
        .update(outboxJobs)
        .set({ state: "done", doneAt: sql`now()`, lockedUntil: null })
        .where(and(eq(outboxJobs.dedupeKey, sapoJobKey(txnRef)), ne(outboxJobs.state, "done")));
    },
    db,
  );
}

/**
 * A try at the Sapo order failed. Counts it, stores `reason` (a label such as "Sapo answered HTTP 503" —
 * never a response body, which can carry the customer's details) and sets the next try; the last allowed
 * failure makes the job `failed`. `undefined` when there is no waiting job (none, already done, already
 * failed) or the ledger cannot be written.
 */
export async function ledgerFailSapoJob(
  txnRef: string,
  reason: string,
  db?: LedgerDb,
): Promise<{ attempts: number; gaveUp: boolean } | undefined> {
  return guarded(
    "job_failed",
    txnRef,
    undefined as { attempts: number; gaveUp: boolean } | undefined,
    async (d) => {
      const [row] = await d
        .update(outboxJobs)
        .set({
          attempts: sql`${outboxJobs.attempts} + 1`,
          lastError: reason.slice(0, 200),
          state: sql`case when ${outboxJobs.attempts} + 1 >= ${SAPO_JOB_MAX_ATTEMPTS} then 'failed' else 'pending' end`,
          runAfter: sql`now() + (${SAPO_JOB_BACKOFF_MINUTES}::int[])[least(${outboxJobs.attempts} + 1, 7)] * interval '1 minute'`,
        })
        .where(and(eq(outboxJobs.dedupeKey, sapoJobKey(txnRef)), eq(outboxJobs.state, "pending")))
        .returning({ attempts: outboxJobs.attempts, state: outboxJobs.state });
      return row === undefined ? undefined : { attempts: row.attempts, gaveUp: row.state === "failed" };
    },
    db,
  );
}

/** References whose Sapo job is waiting and due, the longest-waiting first. An unreadable ledger yields none. */
export async function ledgerDueSapoJobs(limit: number, db?: LedgerDb): Promise<string[]> {
  return guarded(
    "jobs_due",
    null,
    [] as string[],
    async (d) => {
      const rows = await d
        .select({ key: outboxJobs.dedupeKey })
        .from(outboxJobs)
        .where(
          and(
            eq(outboxJobs.kind, SAPO_JOB_KIND),
            eq(outboxJobs.state, "pending"),
            sql`${outboxJobs.runAfter} <= now()`,
            // Production and Preview share this database but not Redis: a job belongs to the deployment
            // whose Redis holds the order it needs, and another one's would only fail and alarm.
            sql`coalesce(${outboxJobs.payload}->>'ns', '') = ${_keyNamespace()}`,
          ),
        )
        .orderBy(outboxJobs.runAfter)
        .limit(limit);
      const prefix = `${SAPO_JOB_KIND}:`;
      return rows.flatMap((r) => (r.key?.startsWith(prefix) ? [r.key.slice(prefix.length)] : []));
    },
    db,
    false,
  );
}

/**
 * What happened in Sapo: the order exists there (which also finishes its Sapo job), or creating it
 * failed (never undoing a created one).
 */
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
      if (result.ok) {
        // One statement, one round trip to the database: the IPN waits for this before answering VNPAY,
        // and a cold Neon makes every round trip count. Mark the order created, record which Sapo order
        // it became, and finish its Sapo job (PR 6b). Data-modifying CTEs all run, referenced or not.
        await d.execute(sql`
          with o as (
            update ${orders} set integration_status = 'created', updated_at = now()
            where ${orders.webRef} = ${txnRef} returning id
          ), m as (
            insert into ${sapoMappings} (order_id, sapo_order_id, sapo_order_name)
            select id, ${result.id}, ${result.name} from o
            on conflict (order_id) do nothing
          ), j as (
            update ${outboxJobs} set state = 'done', done_at = now(), locked_until = null
            where ${outboxJobs.dedupeKey} = ${sapoJobKey(txnRef)} and ${outboxJobs.state} <> 'done'
          )
          select 1`);
        return;
      }
      // A failure never undoes a created order (a stale attempt landing after a timeout).
      await d
        .update(orders)
        .set({ integrationStatus: "failed", updatedAt: sql`now()` })
        .where(and(eq(orders.webRef, txnRef), ne(orders.integrationStatus, "created")));
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
    false,
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

export interface SweepCandidate {
  txnRef: string;
  createdAt: Date;
  /** "pending": VNPAY has not reported yet. "unsynced": paid, but Sapo has no order. */
  kind: "pending" | "unsynced";
}

/**
 * The payments worth asking about (T14 PR 6, lib/sweep.ts): VNPAY orders still `pending` between one
 * minute and two hours old, and paid orders from the last two hours whose Sapo order is not
 * `created` (two hours is how long `reconcilePendingPayment` is willing to act on an order, so a
 * longer list would only fill slots with rows it then skips). **Newest first**: a payment that just
 * came in is the one worth asking about, and abandoned checkouts, which stay `pending` for ever, are
 * the oldest. A ledger that cannot be read yields none — the sweep then does nothing rather than guess.
 */
export async function ledgerSweepCandidates(limit: number, db?: LedgerDb): Promise<SweepCandidate[]> {
  return guarded(
    "sweep",
    null,
    [] as SweepCandidate[],
    async (d) => {
      const rows = await d
        .select({ ref: orders.webRef, payment: orders.paymentStatus, createdAt: orders.createdAt })
        .from(orders)
        .where(
          sql`(${orders.paymentMethod} = 'vnpay' and ${orders.paymentStatus} = 'pending'
               and ${orders.createdAt} < now() - interval '60 seconds' and ${orders.createdAt} > now() - interval '2 hours')
              or (${orders.paymentStatus} = 'paid' and ${orders.integrationStatus} <> 'created'
               and ${orders.createdAt} < now() - interval '60 seconds' and ${orders.createdAt} > now() - interval '2 hours'
               and not exists (select 1 from ${outboxJobs} where ${outboxJobs.orderId} = ${orders.id}
                               and ${outboxJobs.kind} = ${SAPO_JOB_KIND}))`,
        )
        .orderBy(desc(orders.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        txnRef: r.ref,
        createdAt: r.createdAt,
        kind: r.payment === "paid" ? ("unsynced" as const) : ("pending" as const),
      }));
    },
    db,
    false,
  );
}

/**
 * The parameters of a payment the ledger already knows is paid, for retrying the Sapo order of an
 * order that was paid and then refused by Sapo without asking VNPAY again. `undefined` if the ledger
 * has no paid attempt for the reference (or cannot be read), in which case the caller asks VNPAY.
 */
export async function ledgerPaidParams(txnRef: string, db?: LedgerDb): Promise<VnpParams | undefined> {
  return guarded(
    "paid_params",
    txnRef,
    undefined as VnpParams | undefined,
    async (d) => {
      const [a] = await d
        .select({
          no: paymentAttempts.vnpTransactionNo,
          bank: paymentAttempts.vnpBankCode,
          date: paymentAttempts.vnpPayDate,
          amount: paymentAttempts.amountVnd,
          status: paymentAttempts.status,
        })
        .from(paymentAttempts)
        .where(and(eq(paymentAttempts.vnpTxnRef, txnRef), eq(paymentAttempts.status, "paid")));
      if (a === undefined || a.no === null) return undefined;
      return {
        vnp_TxnRef: txnRef,
        // "00" by construction: the row is `paid`, which only a verified success writes.
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
        vnp_Amount: String(a.amount * 100),
        vnp_TransactionNo: a.no,
        ...(a.bank ? { vnp_BankCode: a.bank } : {}),
        ...(a.date ? { vnp_PayDate: a.date } : {}),
      };
    },
    db,
    false,
  );
}
