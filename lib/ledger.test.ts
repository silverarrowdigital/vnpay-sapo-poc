/**
 * The parallel write (T14 PR 5) against a real in-process Postgres: the migration is applied as
 * shipped, then the same calls the payment path makes are replayed, including the repeats VNPAY and a
 * double click produce — and a database that fails or never answers.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "./db/schema";
import type { PendingOrder } from "./store";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const {
  BREAKER_MS,
  LEDGER_TIMEOUT_MS,
  _resetLedgerBreaker,
  describeDbError,
  ledgerCompare,
  ledgerPurgeCustomers,
  ledgerRecordCheckout,
  ledgerRecordPayment,
  ledgerRecordSapo,
  ledgerRecordWebhook,
} = await import("./ledger");
const { log } = await import("./log");

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => client.close());
beforeEach(() => _resetLedgerBreaker());

function pending(txnRef: string, status: PendingOrder["status"] = "pending"): PendingOrder {
  return {
    txnRef,
    createdAt: new Date().toISOString(),
    customer: { name: "Nguyen Van A", phone: "0912345678", email: "a@example.com", address: "1 Test" },
    lines: [{ variantId: 1, sku: "SKU", productName: "Trà", unitPriceVnd: 50_000, quantity: 1 }],
    goodsVnd: 50_000,
    shipping: { title: "Giao hàng", code: "std", priceVnd: 30_000 },
    amountVnd: 80_000,
    paymentMethod: "vnpay",
    status,
  };
}
const PAID = { vnp_TxnRef: "x", vnp_ResponseCode: "00", vnp_TransactionNo: "15697481", vnp_BankCode: "NCB", vnp_PayDate: "20261007134156" };
const orderOf = async (ref: string) => (await db.select().from(schema.orders).where(eq(schema.orders.webRef, ref)))[0];

describe("the ledger follows an order from checkout to Sapo", () => {
  it("records the order and its first attempt once, however often the checkout is replayed", async () => {
    await ledgerRecordCheckout(pending("L-1"), db);
    await ledgerRecordCheckout(pending("L-1"), db);
    const rows = await db.select().from(schema.orders).where(eq(schema.orders.webRef, "L-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountVnd: 80_000, paymentStatus: "pending", integrationStatus: "none" });
    expect(await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.vnpTxnRef, "L-1"))).toHaveLength(1);
  });

  it("marks the payment paid with VNPAY's details, then the Sapo order created; a repeat changes nothing", async () => {
    await ledgerRecordCheckout(pending("L-2"), db);
    for (let i = 0; i < 2; i++) {
      await ledgerRecordPayment("L-2", "paid", PAID, db);
      await ledgerRecordSapo("L-2", { ok: true, id: 338201572, name: "#1039" }, db);
    }
    const o = await orderOf("L-2");
    expect(o).toMatchObject({ paymentStatus: "paid", integrationStatus: "created" });
    const [a] = await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.vnpTxnRef, "L-2"));
    expect(a).toMatchObject({ status: "paid", vnpTransactionNo: "15697481", vnpBankCode: "NCB" });
    expect(await db.select().from(schema.sapoMappings).where(eq(schema.sapoMappings.orderId, o.id))).toHaveLength(1);
  });

  it("keeps payment and Sapo apart: paid with a failed Sapo order is paid + integration failed", async () => {
    await ledgerRecordCheckout(pending("L-3"), db);
    await ledgerRecordPayment("L-3", "paid", PAID, db);
    await ledgerRecordSapo("L-3", { ok: false }, db);
    expect(await orderOf("L-3")).toMatchObject({ paymentStatus: "paid", integrationStatus: "failed" });
  });

  it("stores the webhook without its signature", async () => {
    await ledgerRecordWebhook("querydr", { ...PAID, vnp_TxnRef: "L-4", vnp_SecureHash: "deadbeef" }, "00", db);
    const [w] = await db.select().from(schema.webhookInbox).where(eq(schema.webhookInbox.txnRef, "L-4"));
    expect(w.source).toBe("querydr");
    expect(JSON.stringify(w.params)).not.toContain("deadbeef");
  });

  it("does nothing, and does not throw, for an order the ledger never saw", async () => {
    await expect(ledgerRecordPayment("NEVER-SEEN", "paid", PAID, db)).resolves.toBeUndefined();
    await expect(ledgerRecordSapo("NEVER-SEEN", { ok: true, id: 1, name: "#1" }, db)).resolves.toBeUndefined();
  });
});

describe("ledgerCompare — the evidence PR 6 waits for", () => {
  it("agrees when Redis and the ledger tell the same story", async () => {
    await ledgerRecordCheckout(pending("C-1"), db);
    await ledgerRecordPayment("C-1", "paid", PAID, db);
    await ledgerRecordSapo("C-1", { ok: true, id: 1, name: "#1" }, db);
    expect(await ledgerCompare(pending("C-1", "completed"), db)).toBe(true);
    expect(log.warn).not.toHaveBeenCalledWith("ledger.mismatch", expect.anything());
  });

  it("says so when the ledger is behind Redis or the order is missing, with the order's age so old ones can be filtered", async () => {
    await ledgerRecordCheckout(pending("C-2"), db); // never marked paid
    expect(await ledgerCompare(pending("C-2", "completed"), db)).toBe(false);
    expect(await ledgerCompare(pending("C-MISSING", "completed"), db)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith("ledger.mismatch", expect.objectContaining({ txnRef: "C-2", createdAt: expect.any(String) }));
    expect(log.warn).toHaveBeenCalledWith(
      "ledger.mismatch",
      expect.objectContaining({ txnRef: "C-MISSING", reason: "no ledger row", createdAt: expect.any(String) }),
    );
  });

  it("has nothing to compare for an order still pending", async () => {
    expect(await ledgerCompare(pending("C-3", "pending"), db)).toBe(true);
  });
});

describe("a broken database never breaks the caller", () => {
  afterEach(() => vi.useRealTimers());

  it("swallows an immediate failure and logs it", async () => {
    const broken = {
      insert: () => {
        throw new Error("connection refused");
      },
    } as never;
    await expect(ledgerRecordCheckout(pending("B-1"), broken)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith("ledger.write_failed", expect.objectContaining({ what: "checkout", txnRef: "B-1" }));
  });

  it("gives up on a database that never answers — reads included — instead of hanging the payment", async () => {
    vi.useFakeTimers();
    const never = () => new Promise(() => {});
    const hangs = { insert: never, update: never, select: never } as never;
    const write = ledgerRecordPayment("H-1", "paid", PAID, hangs);
    await vi.advanceTimersByTimeAsync(LEDGER_TIMEOUT_MS + 10);
    await expect(write).resolves.toBeUndefined();

    _resetLedgerBreaker();
    const compare = ledgerCompare(pending("H-2", "completed"), hangs);
    await vi.advanceTimersByTimeAsync(LEDGER_TIMEOUT_MS + 10);
    await expect(compare).resolves.toBe(true); // an unreadable ledger is not evidence of a mismatch
  });

  it("after one failure, skips the ledger for a while instead of paying a timeout on every call", async () => {
    vi.useFakeTimers();
    const calls = vi.fn(() => {
      throw new Error("down");
    });
    const broken = { insert: calls, update: calls, select: calls } as never;
    await ledgerRecordCheckout(pending("K-1"), broken);
    await ledgerRecordPayment("K-1", "paid", PAID, broken);
    await ledgerRecordSapo("K-1", { ok: false }, broken);
    expect(calls).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BREAKER_MS + 1);
    await ledgerRecordCheckout(pending("K-2"), broken);
    expect(calls).toHaveBeenCalledTimes(2);
  });
});

describe("what the log may contain", () => {
  it("drops the SQL and its parameters from a failed query, keeping the Postgres cause", () => {
    const err = Object.assign(new Error('Failed query: insert into "orders" ...\nparams: {"name":"Nguyen Van A","phone":"0912345678"}'), {
      cause: { code: "42P01", message: 'relation "orders" does not exist' },
    });
    const text = describeDbError(err);
    expect(text).toContain("42P01");
    expect(text).toContain("does not exist");
    expect(text).not.toMatch(/Nguyen|0912345678|params/);
  });

  it("does not leak customer data into the log when a real insert fails", async () => {
    const broken = {
      insert: () => {
        throw Object.assign(new Error('Failed query: params: ["Nguyen Van A"]'), { cause: { message: "boom" } });
      },
    } as never;
    await ledgerRecordCheckout(pending("P-1"), broken);
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain("Nguyen");
  });
});

describe("a state never moves backwards", () => {
  it("keeps a paid payment paid when a failed or cancelled notification arrives afterwards", async () => {
    await ledgerRecordCheckout(pending("S-1"), db);
    await ledgerRecordPayment("S-1", "paid", PAID, db);
    await ledgerRecordPayment("S-1", "failed", { ...PAID, vnp_ResponseCode: "24" }, db);
    await ledgerRecordPayment("S-1", "cancelled", { ...PAID, vnp_ResponseCode: "24" }, db);
    expect(await orderOf("S-1")).toMatchObject({ paymentStatus: "paid", orderStatus: "open" });
    const [a] = await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.vnpTxnRef, "S-1"));
    expect(a.status).toBe("paid");
  });

  it("lets a payment that failed be paid by a retry, but never marks a created Sapo order failed", async () => {
    await ledgerRecordCheckout(pending("S-2"), db);
    await ledgerRecordPayment("S-2", "failed", PAID, db);
    await ledgerRecordPayment("S-2", "paid", PAID, db);
    await ledgerRecordSapo("S-2", { ok: true, id: 7, name: "#7" }, db);
    await ledgerRecordSapo("S-2", { ok: false }, db); // a stale attempt landing late
    expect(await orderOf("S-2")).toMatchObject({ paymentStatus: "paid", integrationStatus: "created" });
  });

  it("completes the order/attempt pair when an earlier checkout write died between the two inserts", async () => {
    await db.insert(schema.orders).values({ webRef: "S-3", lines: [], goodsVnd: 1, amountVnd: 1 }); // the orphan
    await ledgerRecordCheckout(pending("S-3"), db);
    expect(await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.vnpTxnRef, "S-3"))).toHaveLength(1);
  });
});

describe("the 90-day purge", () => {
  it("empties the customer of orders past their purge date and leaves younger ones and the money alone", async () => {
    await ledgerRecordCheckout(pending("U-OLD"), db);
    await ledgerRecordCheckout(pending("U-NEW"), db);
    await db.update(schema.orders).set({ purgeAfter: new Date(Date.now() - 1000) }).where(eq(schema.orders.webRef, "U-OLD"));
    expect(await ledgerPurgeCustomers(db)).toBeGreaterThanOrEqual(1);
    const old = await orderOf("U-OLD");
    const young = await orderOf("U-NEW");
    expect(old.customer).toBeNull();
    expect(old.customerPurgedAt).not.toBeNull();
    expect(old.amountVnd).toBe(80_000);
    expect(young.customer).not.toBeNull();
    expect(await ledgerPurgeCustomers(db)).toBe(0); // nothing left to empty
  });
});
