/**
 * The durable ledger (T14, docs/plan/T14-so-giao-dich-postgres.md). Server-only.
 *
 * Today everything about a payment lives in one JSON record in Redis (`lib/store.ts`). These tables
 * are what replaces it, in three steps: this schema (PR 4, nothing reads or writes it yet), a parallel
 * write alongside Redis (PR 5), then the IPN recording its result and a job in one transaction
 * before it answers VNPAY (PR 6).
 *
 * Money is whole đồng in `integer` columns — the largest amount this shop can charge is far below
 * 2^31 — never a float. Times are `timestamptz`.
 *
 * **Four statuses, kept apart on purpose.** The Redis enum mixes them
 * (pending/processing/completed/sapo_error/cancelled/failed), so "VNPAY has our money" cannot be told
 * from "Sapo has our order". Here `payment_status` says what VNPAY said, `integration_status` says
 * what happened in Sapo, `fulfillment_status` is the courier's side (empty until a source exists) and
 * `order_status` is the order's own life.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The reference the customer sees: the first payment attempt's VNPAY reference. Unique. */
    webRef: text("web_ref").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Name, phone, email, address and the three administrative levels. **Personal data**: see `purgeAfter`. */
    customer: jsonb("customer"),
    /** Lines with the price they were sold at (a snapshot, never re-read from Sapo). */
    lines: jsonb("lines").notNull(),
    goodsVnd: integer("goods_vnd").notNull(),
    discount: jsonb("discount"),
    shipping: jsonb("shipping"),
    /** goods − discount + shipping: the amount VNPAY is asked for. */
    amountVnd: integer("amount_vnd").notNull(),
    paymentMethod: text("payment_method").notNull().default("vnpay"),
    orderStatus: text("order_status").notNull().default("open"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    integrationStatus: text("integration_status").notNull().default("none"),
    fulfillmentStatus: text("fulfillment_status").notNull().default("none"),
    /** From this moment the `customer` column may be emptied (the privacy policy promises 90 days). */
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull().default(sql`now() + interval '90 days'`),
    customerPurgedAt: timestamp("customer_purged_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("orders_web_ref_unique").on(t.webRef), index("orders_purge_idx").on(t.purgeAfter)],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /** Unique across the whole ledger: a reference can never belong to two attempts. */
    vnpTxnRef: text("vnp_txn_ref").notNull(),
    amountVnd: integer("amount_vnd").notNull(),
    /** pending | paid | failed | cancelled | refunded */
    status: text("status").notNull().default("pending"),
    vnpTransactionNo: text("vnp_transaction_no"),
    vnpBankCode: text("vnp_bank_code"),
    vnpPayDate: text("vnp_pay_date"),
    vnpResponseCode: text("vnp_response_code"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_attempts_txn_ref_unique").on(t.vnpTxnRef), index("payment_attempts_order_idx").on(t.orderId)],
);

/** Every IPN and querydr answer received, for reconciliation. Evidence, never a decision. */
export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** "ipn" | "querydr" */
    source: text("source").notNull(),
    txnRef: text("txn_ref"),
    /** The vnp_* parameters **without** the signature. */
    params: jsonb("params").notNull(),
    rspCode: text("rsp_code"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_inbox_txn_ref_idx").on(t.txnRef)],
);

/** Work that must happen after a payment is recorded, and must survive a crash: `create_sapo_order`, `query_vnpay`. */
export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    payload: jsonb("payload"),
    /**
     * One job per piece of work, enforced by the database: `create_sapo_order:<txnRef>`. A repeated IPN
     * inserts with ON CONFLICT DO NOTHING on this, so it can never queue a second Sapo order (PR 6b).
     */
    dedupeKey: text("dedupe_key"),
    /** pending | done | failed (`running` and `locked_until` are unused: the Redis claim serialises the work) */
    state: text("state").notNull().default("pending"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** A worker holds the job until this time; a crashed worker's hold simply expires. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: now(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [index("outbox_jobs_due_idx").on(t.state, t.runAfter), uniqueIndex("outbox_jobs_dedupe_key_unique").on(t.dedupeKey)],
);

/** Which Sapo order a ledger order became. One order, one Sapo order: the primary key enforces it. */
export const sapoMappings = pgTable("sapo_mappings", {
  orderId: uuid("order_id")
    .primaryKey()
    .references(() => orders.id),
  sapoOrderId: bigint("sapo_order_id", { mode: "number" }).notNull(),
  sapoOrderName: text("sapo_order_name").notNull(),
  createdAt: now(),
});
