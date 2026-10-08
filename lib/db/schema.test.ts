/**
 * The ledger schema against a real Postgres: PGlite runs Postgres itself inside the test process, so
 * constraints, defaults and foreign keys behave as they will on Neon, with no network and no
 * credentials (the Neon variables are secrets and cannot even be pulled to a laptop).
 *
 * It applies the generated migration in drizzle/ — not the TypeScript schema — so a schema edit that
 * was never turned into a migration fails here instead of on the first deploy.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orders, outboxJobs, paymentAttempts, sapoMappings, webhookInbox } from "./schema";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await client.close();
});

const baseOrder = (webRef: string) => ({
  webRef,
  lines: [{ variantId: 1, sku: "SKU", unitPriceVnd: 50_000, quantity: 1 }],
  goodsVnd: 50_000,
  amountVnd: 80_000,
});

describe("ledger schema", () => {
  it("gives an order its defaults: four separate statuses, vnpay, and a purge date 90 days out", async () => {
    const [o] = await db.insert(orders).values(baseOrder("REF-DEFAULTS")).returning();
    expect(o).toMatchObject({
      paymentMethod: "vnpay",
      orderStatus: "open",
      paymentStatus: "pending",
      integrationStatus: "none",
      fulfillmentStatus: "none",
      customerPurgedAt: null,
    });
    const days = (o.purgeAfter.getTime() - o.createdAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it("refuses a second order with the same web reference", async () => {
    await db.insert(orders).values(baseOrder("REF-DUP"));
    await expect(db.insert(orders).values(baseOrder("REF-DUP"))).rejects.toThrow();
  });

  it("refuses the same VNPAY reference on two payment attempts, even for different orders", async () => {
    const [a] = await db.insert(orders).values(baseOrder("REF-A")).returning();
    const [b] = await db.insert(orders).values(baseOrder("REF-B")).returning();
    await db.insert(paymentAttempts).values({ orderId: a.id, vnpTxnRef: "VNP-1", amountVnd: 80_000 });
    await expect(db.insert(paymentAttempts).values({ orderId: b.id, vnpTxnRef: "VNP-1", amountVnd: 80_000 })).rejects.toThrow();
  });

  it("allows several attempts for one order, and refuses an attempt for an order that does not exist", async () => {
    const [o] = await db.insert(orders).values(baseOrder("REF-MANY")).returning();
    await db.insert(paymentAttempts).values({ orderId: o.id, vnpTxnRef: "VNP-M1", amountVnd: 80_000 });
    await db.insert(paymentAttempts).values({ orderId: o.id, vnpTxnRef: "VNP-M2", amountVnd: 80_000 });
    expect(await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, o.id))).toHaveLength(2);
    await expect(
      db.insert(paymentAttempts).values({ orderId: "00000000-0000-4000-8000-000000000000", vnpTxnRef: "VNP-X", amountVnd: 1 }),
    ).rejects.toThrow();
  });

  it("maps an order to at most one Sapo order", async () => {
    const [o] = await db.insert(orders).values(baseOrder("REF-SAPO")).returning();
    await db.insert(sapoMappings).values({ orderId: o.id, sapoOrderId: 338201572, sapoOrderName: "#1039" });
    await expect(db.insert(sapoMappings).values({ orderId: o.id, sapoOrderId: 1, sapoOrderName: "#2" })).rejects.toThrow();
  });

  it("keeps outbox jobs due-able: pending by default, runnable now, zero attempts", async () => {
    const [o] = await db.insert(orders).values(baseOrder("REF-JOB")).returning();
    const [j] = await db.insert(outboxJobs).values({ kind: "create_sapo_order", orderId: o.id }).returning();
    expect(j).toMatchObject({ state: "pending", attempts: 0, lockedUntil: null, doneAt: null });
    expect(j.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("refuses a second job with the same dedupe key, but allows any number without one", async () => {
    const [o] = await db.insert(orders).values(baseOrder("REF-DEDUPE")).returning();
    await db.insert(outboxJobs).values({ kind: "create_sapo_order", orderId: o.id, dedupeKey: "create_sapo_order:REF-DEDUPE" });
    await expect(
      db.insert(outboxJobs).values({ kind: "create_sapo_order", orderId: o.id, dedupeKey: "create_sapo_order:REF-DEDUPE" }),
    ).rejects.toThrow();
    await db.insert(outboxJobs).values({ kind: "query_vnpay", orderId: o.id });
    await db.insert(outboxJobs).values({ kind: "query_vnpay", orderId: o.id });
  });

  it("records an inbox row with its parameters as JSON", async () => {
    await db.insert(webhookInbox).values({ source: "ipn", txnRef: "VNP-1", params: { vnp_ResponseCode: "00" }, rspCode: "00" });
    const [row] = await db.select().from(webhookInbox).where(eq(webhookInbox.txnRef, "VNP-1"));
    expect(row.params).toEqual({ vnp_ResponseCode: "00" });
  });
});
