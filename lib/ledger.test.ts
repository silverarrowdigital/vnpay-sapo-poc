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
  ledgerPaidParams,
  ledgerSweepCandidates,
  ledgerCommitPaid,
  ledgerDueSapoJobs,
  ledgerFailSapoJob,
  ledgerFinishSapoJob,
  SAPO_JOB_MAX_ATTEMPTS,
  sapoJobKey,
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

describe("the sweep's candidate list", () => {
  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
  const backdate = (ref: string, seconds: number) => db.update(schema.orders).set({ createdAt: ago(seconds) }).where(eq(schema.orders.webRef, ref));

  it("lists a VNPAY payment still pending after a minute, a paid order Sapo has not taken, and nothing else", async () => {
    for (const r of ["W-FRESH", "W-PENDING", "W-OLD", "W-PAID-OK", "W-PAID-NOSAPO", "W-FAILED"]) await ledgerRecordCheckout(pending(r), db);
    await backdate("W-PENDING", 200);
    await backdate("W-OLD", 3 * 3600); // over two hours: no longer worth asking
    await backdate("W-PAID-OK", 300);
    await backdate("W-PAID-NOSAPO", 300);
    await backdate("W-FAILED", 300);
    await ledgerRecordPayment("W-PAID-OK", "paid", PAID, db);
    await ledgerRecordSapo("W-PAID-OK", { ok: true, id: 1, name: "#1" }, db);
    await ledgerRecordPayment("W-PAID-NOSAPO", "paid", PAID, db);
    await ledgerRecordPayment("W-FAILED", "failed", PAID, db);

    const got = await ledgerSweepCandidates(50, db);
    const mine = got
      .filter((c) => c.txnRef.startsWith("W-"))
      .map((c) => ({ txnRef: c.txnRef, kind: c.kind }))
      .sort((x, y) => x.txnRef.localeCompare(y.txnRef));
    expect(mine).toEqual([
      { txnRef: "W-PAID-NOSAPO", kind: "unsynced" },
      { txnRef: "W-PENDING", kind: "pending" },
    ]);
  });

  it("returns nothing, rather than throwing, when the ledger is unreachable", async () => {
    const broken = {
      select: () => {
        throw new Error("down");
      },
    } as never;
    expect(await ledgerSweepCandidates(10, broken)).toEqual([]);
  });
});

describe("ledgerPaidParams — what a Sapo retry is built from", () => {
  it("gives the recorded transaction, bank, date and amount of a paid attempt, with response code 00", async () => {
    await ledgerRecordCheckout(pending("PP-1"), db);
    await ledgerRecordPayment("PP-1", "paid", PAID, db);
    expect(await ledgerPaidParams("PP-1", db)).toEqual({
      vnp_TxnRef: "PP-1",
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_Amount: "8000000",
      vnp_TransactionNo: "15697481",
      vnp_BankCode: "NCB",
      vnp_PayDate: "20261007134156",
    });
  });

  it("gives nothing for an attempt that is pending, failed, cancelled, unknown, or paid without a transaction number", async () => {
    await ledgerRecordCheckout(pending("PP-2"), db);
    expect(await ledgerPaidParams("PP-2", db)).toBeUndefined(); // pending
    await ledgerRecordPayment("PP-2", "failed", PAID, db);
    expect(await ledgerPaidParams("PP-2", db)).toBeUndefined(); // failed
    await ledgerRecordCheckout(pending("PP-3"), db);
    await ledgerRecordPayment("PP-3", "cancelled", PAID, db);
    expect(await ledgerPaidParams("PP-3", db)).toBeUndefined(); // cancelled
    expect(await ledgerPaidParams("PP-NEVER", db)).toBeUndefined();
    await ledgerRecordCheckout(pending("PP-4"), db);
    await ledgerRecordPayment("PP-4", "paid", { vnp_ResponseCode: "00" }, db); // no transaction number
    expect(await ledgerPaidParams("PP-4", db)).toBeUndefined();
  });
});

describe("ledgerCommitPaid — the payment and its Sapo job in one transaction (PR 6b)", () => {
  const jobsOf = (ref: string) => db.select().from(schema.outboxJobs).where(eq(schema.outboxJobs.dedupeKey, sapoJobKey(ref)));
  const attemptOf = async (ref: string) =>
    (await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.vnpTxnRef, ref)))[0];

  it("marks the attempt and the order paid and queues exactly one Sapo job", async () => {
    await ledgerRecordCheckout(pending("T-1"), db);
    expect(await ledgerCommitPaid(pending("T-1", "processing"), PAID, db)).toBe("committed");
    expect(await attemptOf("T-1")).toMatchObject({ status: "paid", vnpTransactionNo: "15697481", vnpBankCode: "NCB" });
    expect(await orderOf("T-1")).toMatchObject({ paymentStatus: "paid", orderStatus: "open" });
    const jobs = await jobsOf("T-1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "create_sapo_order", state: "pending", attempts: 0, payload: { txnRef: "T-1" } });
  });

  it("answers 'already' to a repeat and never queues a second job", async () => {
    await ledgerRecordCheckout(pending("T-2"), db);
    expect(await ledgerCommitPaid(pending("T-2"), PAID, db)).toBe("committed");
    expect(await ledgerCommitPaid(pending("T-2"), PAID, db)).toBe("already");
    expect(await ledgerCommitPaid(pending("T-2"), PAID, db)).toBe("already");
    expect(await jobsOf("T-2")).toHaveLength(1);
  });

  it("records an order whose checkout write was lost, from the Redis record it is given", async () => {
    expect(await ledgerCommitPaid(pending("T-3"), PAID, db)).toBe("committed");
    expect(await orderOf("T-3")).toMatchObject({ paymentStatus: "paid", amountVnd: 80_000 });
    expect(await jobsOf("T-3")).toHaveLength(1);
  });

  it("rolls everything back when the database fails half-way: no paid attempt, no job", async () => {
    await ledgerRecordCheckout(pending("T-BOOM"), db);
    await client.exec(`
      CREATE FUNCTION refuse_boom_job() RETURNS trigger AS $$
      BEGIN IF NEW.dedupe_key LIKE '%T-BOOM' THEN RAISE EXCEPTION 'disk full'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER refuse_boom_job BEFORE INSERT ON outbox_jobs FOR EACH ROW EXECUTE FUNCTION refuse_boom_job();
    `);
    try {
      expect(await ledgerCommitPaid(pending("T-BOOM"), PAID, db)).toBe("unavailable");
    } finally {
      await client.exec("DROP TRIGGER refuse_boom_job ON outbox_jobs; DROP FUNCTION refuse_boom_job();");
    }
    // The update of the attempt ran before the job insert failed; it must not have survived.
    expect(await attemptOf("T-BOOM")).toMatchObject({ status: "pending", vnpTransactionNo: null });
    expect(await orderOf("T-BOOM")).toMatchObject({ paymentStatus: "pending" });
    expect(await jobsOf("T-BOOM")).toHaveLength(0);
  });

  it("does not turn a refunded payment back into a paid one", async () => {
    await ledgerRecordCheckout(pending("T-REF"), db);
    await db.update(schema.paymentAttempts).set({ status: "refunded" }).where(eq(schema.paymentAttempts.vnpTxnRef, "T-REF"));
    expect(await ledgerCommitPaid(pending("T-REF"), PAID, db)).toBe("unavailable");
    expect((await attemptOf("T-REF")).status).toBe("refunded");
    expect(await jobsOf("T-REF")).toHaveLength(0);
  });

  it("is 'unavailable', never a throw, with no database, a broken one, or one that never answers", async () => {
    // No DATABASE_URL in tests, so the default database is absent.
    expect(await ledgerCommitPaid(pending("T-NODB"), PAID)).toBe("unavailable");
    const broken = {
      transaction: () => {
        throw new Error("connection refused");
      },
    } as never;
    expect(await ledgerCommitPaid(pending("T-BROKEN"), PAID, broken)).toBe("unavailable");
    _resetLedgerBreaker();
    vi.useFakeTimers();
    try {
      const hangs = { transaction: () => new Promise(() => {}) } as never;
      const commit = ledgerCommitPaid(pending("T-HANG"), PAID, hangs);
      await vi.advanceTimersByTimeAsync(LEDGER_TIMEOUT_MS + 10);
      await expect(commit).resolves.toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is 'unavailable' on a database migrated before the dedupe key existed (a preview ahead of production)", async () => {
    const old = new PGlite();
    try {
      const { readFileSync } = await import("node:fs");
      for (const stmt of readFileSync("./drizzle/0000_ledger.sql", "utf8").split("--> statement-breakpoint")) await old.exec(stmt);
      const oldDb = drizzle(old, { schema });
      await ledgerRecordCheckout(pending("T-OLD"), oldDb);
      expect(await ledgerCommitPaid(pending("T-OLD"), PAID, oldDb)).toBe("unavailable");
    } finally {
      await old.close();
    }
  });
});

describe("the Sapo job's life after the commit", () => {
  const jobOf = async (ref: string) =>
    (await db.select().from(schema.outboxJobs).where(eq(schema.outboxJobs.dedupeKey, sapoJobKey(ref))))[0];

  it("is done once the Sapo order exists, and then no longer due", async () => {
    await ledgerCommitPaid(pending("J-1"), PAID, db);
    expect(await ledgerDueSapoJobs(50, db)).toContain("J-1");
    await ledgerFinishSapoJob("J-1", db);
    expect(await jobOf("J-1")).toMatchObject({ state: "done" });
    expect((await jobOf("J-1")).doneAt).not.toBeNull();
    expect(await ledgerDueSapoJobs(50, db)).not.toContain("J-1");
  });

  it("backs off after each failure, keeps only a reason label, and gives up after the last attempt", async () => {
    await ledgerCommitPaid(pending("J-2"), PAID, db);
    const first = await ledgerFailSapoJob("J-2", "Sapo answered HTTP 503", db);
    expect(first).toEqual({ attempts: 1, gaveUp: false });
    const j = await jobOf("J-2");
    expect(j).toMatchObject({ state: "pending", attempts: 1, lastError: "Sapo answered HTTP 503" });
    expect(j.runAfter.getTime()).toBeGreaterThan(Date.now() + 30_000); // not due again at once
    expect(await ledgerDueSapoJobs(50, db)).not.toContain("J-2");

    let last: Awaited<ReturnType<typeof ledgerFailSapoJob>>;
    for (let i = 1; i < SAPO_JOB_MAX_ATTEMPTS; i++) last = await ledgerFailSapoJob("J-2", "Sapo answered HTTP 503", db);
    expect(last!).toEqual({ attempts: SAPO_JOB_MAX_ATTEMPTS, gaveUp: true });
    expect(await jobOf("J-2")).toMatchObject({ state: "failed" });
  });

  it("lists a due job by its reference, and a job that has come due again after its back-off", async () => {
    await ledgerCommitPaid(pending("J-3"), PAID, db);
    await ledgerFailSapoJob("J-3", "x", db);
    await db
      .update(schema.outboxJobs)
      .set({ runAfter: new Date(Date.now() - 1000) })
      .where(eq(schema.outboxJobs.dedupeKey, sapoJobKey("J-3")));
    expect(await ledgerDueSapoJobs(50, db)).toContain("J-3");
  });

  it("does not move a finished job back, and does nothing for a reference with no job", async () => {
    await ledgerCommitPaid(pending("J-4"), PAID, db);
    await ledgerFinishSapoJob("J-4", db);
    expect(await ledgerFailSapoJob("J-4", "late", db)).toBeUndefined();
    expect(await jobOf("J-4")).toMatchObject({ state: "done", attempts: 0 });
    expect(await ledgerFailSapoJob("J-NONE", "x", db)).toBeUndefined();
    await expect(ledgerFinishSapoJob("J-NONE", db)).resolves.toBeUndefined();
  });

  it("lists only the jobs of this deployment's Redis namespace, not a preview's in the shared database", async () => {
    await ledgerCommitPaid(pending("J-MINE"), PAID, db);
    await ledgerCommitPaid(pending("J-PREVIEW"), PAID, db);
    await db
      .update(schema.outboxJobs)
      .set({ payload: { txnRef: "J-PREVIEW", ns: "preview-some-branch:" } })
      .where(eq(schema.outboxJobs.dedupeKey, sapoJobKey("J-PREVIEW")));
    const due = await ledgerDueSapoJobs(50, db);
    expect(due).toContain("J-MINE");
    expect(due).not.toContain("J-PREVIEW");
  });

  it("takes a paid order with a job off the sweep's 'unsynced' list: the job owns its retries", async () => {
    await ledgerCommitPaid(pending("J-5"), PAID, db);
    await db.update(schema.orders).set({ createdAt: new Date(Date.now() - 300_000) }).where(eq(schema.orders.webRef, "J-5"));
    expect((await ledgerSweepCandidates(50, db)).map((c) => c.txnRef)).not.toContain("J-5");
  });
});

describe("the sweep list's lower bound and order", () => {
  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

  it("leaves out a paid order younger than a minute (its IPN is still being processed) and lists newest first", async () => {
    for (const r of ["Q-PAID-FRESH", "Q-PAID-OLD", "Q-PEND-OLDER", "Q-PEND-NEWER"]) await ledgerRecordCheckout(pending(r), db);
    await db.update(schema.orders).set({ createdAt: ago(30) }).where(eq(schema.orders.webRef, "Q-PAID-FRESH"));
    await db.update(schema.orders).set({ createdAt: ago(600) }).where(eq(schema.orders.webRef, "Q-PAID-OLD"));
    await db.update(schema.orders).set({ createdAt: ago(900) }).where(eq(schema.orders.webRef, "Q-PEND-OLDER"));
    await db.update(schema.orders).set({ createdAt: ago(120) }).where(eq(schema.orders.webRef, "Q-PEND-NEWER"));
    await ledgerRecordPayment("Q-PAID-FRESH", "paid", PAID, db);
    await ledgerRecordPayment("Q-PAID-OLD", "paid", PAID, db);
    const mine = (await ledgerSweepCandidates(50, db)).filter((c) => c.txnRef.startsWith("Q-")).map((c) => c.txnRef);
    expect(mine).toEqual(["Q-PEND-NEWER", "Q-PAID-OLD", "Q-PEND-OLDER"]); // newest first; the 30 s-old paid order is not listed
  });
});
