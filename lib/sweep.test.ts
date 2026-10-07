import { describe, expect, it, vi } from "vitest";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { MAX_ASKS_PENDING, MAX_ASKS_UNSYNCED, MAX_PER_RUN, runSweep } = await import("./sweep");
import type { SweepDeps } from "./sweep";
type Deps = SweepDeps;
const cand = (txnRef: string, kind: "pending" | "unsynced", createdAt = new Date()) => ({ txnRef, kind, createdAt });

function deps(over: Partial<Deps> = {}): Deps {
  const asks = new Map<string, number>();
  const base: Deps = {
    candidates: async () => [],
    reconcile: vi.fn(async () => "no_answer"),
    askCount: async (ref: string) => asks.get(ref) ?? 0,
    recordAsk: async (ref: string) => {
      asks.set(ref, (asks.get(ref) ?? 0) + 1);
    },
    hasPaidReturn: async () => false,
    onGiveUp: async () => undefined,
    now: () => Date.now(),
  };
  return { ...base, ...over } as Deps;
}

describe("runSweep", () => {
  it("does nothing when there is nothing to do", async () => {
    const d = deps();
    expect(await runSweep(d.reconcile, d)).toEqual({ candidates: 0, asked: 0, settled: 0, capped: 0, skippedForBudget: 0 });
    expect(d.reconcile).not.toHaveBeenCalled();
  });

  it("hands each candidate to reconcile and counts what it settled", async () => {
    const d = deps({
      candidates: async () => [
        cand("A", "pending"),
        cand("B", "unsynced"),
      ],
      reconcile: vi.fn(async (ref: string) => (ref === "A" ? "settled" : "no_answer")),
    });
    const r = await runSweep(d.reconcile, d);
    expect(d.reconcile).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ candidates: 2, asked: 2, settled: 1 });
  });

  it("handles at most MAX_PER_RUN references in one run", async () => {
    const many = Array.from({ length: MAX_PER_RUN + 5 }, (_, i) => (cand(`R${i}`, "pending")));
    const d = deps({ candidates: async () => many });
    const r = await runSweep(d.reconcile, d);
    expect(d.reconcile).toHaveBeenCalledTimes(MAX_PER_RUN);
    expect(r.asked).toBe(MAX_PER_RUN);
  });

  it("stops asking about a payment nobody finishes, after MAX_ASKS_PENDING asks", async () => {
    const d = deps({ candidates: async () => [cand("ABANDONED", "pending")] });
    let capped = 0;
    for (let i = 0; i < MAX_ASKS_PENDING + 3; i++) capped += (await runSweep(d.reconcile, d)).capped;
    expect(d.reconcile).toHaveBeenCalledTimes(MAX_ASKS_PENDING);
    expect(capped).toBe(3);
  });

  it("retries a paid order Sapo would not take more often than an abandoned checkout, but not for ever", async () => {
    expect(MAX_ASKS_UNSYNCED).toBeGreaterThan(MAX_ASKS_PENDING);
    const d = deps({ candidates: async () => [cand("PAID", "unsynced")] });
    for (let i = 0; i < MAX_ASKS_UNSYNCED + 2; i++) await runSweep(d.reconcile, d);
    expect(d.reconcile).toHaveBeenCalledTimes(MAX_ASKS_UNSYNCED);
  });

  it("does not let abandoned checkouts crowd out a fresh payment", async () => {
    const stale = Array.from({ length: MAX_PER_RUN + 4 }, (_, i) => (cand(`OLD${i}`, "pending")));
    const d = deps({ candidates: async () => [...stale, cand("FRESH", "pending")] });
    // The stale ones have used up their asks already.
    for (const c of stale) for (let i = 0; i < MAX_ASKS_PENDING; i++) await d.recordAsk(c.txnRef);
    const r = await runSweep(d.reconcile, d);
    expect(d.reconcile).toHaveBeenCalledTimes(1);
    expect(d.reconcile).toHaveBeenCalledWith("FRESH");
    expect(r.capped).toBe(stale.length);
  });

  it("does not count an ask that never reached VNPAY", async () => {
    const d = deps({
      candidates: async () => [cand("BUSY", "pending")],
      reconcile: vi.fn(async () => "throttled"),
    });
    for (let i = 0; i < MAX_ASKS_PENDING + 3; i++) await runSweep(d.reconcile, d);
    expect(d.reconcile).toHaveBeenCalledTimes(MAX_ASKS_PENDING + 3); // never capped: none of them counted
  });

  it("one failing reference does not stop the rest", async () => {
    const d = deps({
      candidates: async () => [
        cand("BAD", "pending"),
        cand("GOOD", "pending"),
      ],
      reconcile: vi.fn(async (ref: string) => {
        if (ref === "BAD") throw new Error("boom");
        return "settled";
      }),
    });
    const r = await runSweep(d.reconcile, d);
    expect(r.settled).toBe(1);
  });

  it("gives up on the rest of the list when its time budget is spent", async () => {
    let t = 0;
    const d = deps({
      candidates: async () => [
        cand("A", "pending"),
        cand("B", "pending"),
      ],
      now: () => (t += 30_000), // each look at the clock is thirty seconds later
    });
    const r = await runSweep(d.reconcile, d);
    expect(r.skippedForBudget).toBeGreaterThan(0);
  });

  it("does nothing if the candidates cannot be listed", async () => {
    const d = deps({
      candidates: async () => {
        throw new Error("db down");
      },
    });
    expect(await runSweep(d.reconcile, d)).toMatchObject({ candidates: 0, asked: 0 });
  });

  it("asks first about an order whose signed browser return said paid, ahead of newer abandoned ones", async () => {
    const order: string[] = [];
    const d = deps({
      candidates: async () => [
        cand("NEW-ABANDONED", "pending"),
        cand("OLDER-PAID-RETURN", "pending"),
      ],
      hasPaidReturn: async (ref: string) => ref === "OLDER-PAID-RETURN",
      reconcile: vi.fn(async (ref: string) => {
        order.push(ref);
        return "no_answer";
      }),
    });
    await runSweep(d.reconcile, d);
    expect(order).toEqual(["OLDER-PAID-RETURN", "NEW-ABANDONED"]);
  });

  it("tells the owner when it gives up on an order the customer was told was paid — and only then", async () => {
    const onGiveUp = vi.fn(async () => undefined);
    const d = deps({
      candidates: async () => [
        cand("PAID-NEVER-CONFIRMED", "pending"),
        cand("JUST-ABANDONED", "pending"),
      ],
      hasPaidReturn: async (ref: string) => ref === "PAID-NEVER-CONFIRMED",
      onGiveUp,
    });
    for (const ref of ["PAID-NEVER-CONFIRMED", "JUST-ABANDONED"]) for (let i = 0; i < MAX_ASKS_PENDING; i++) await d.recordAsk(ref);
    await runSweep(d.reconcile, d);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith("PAID-NEVER-CONFIRMED");
  });

  it("counts a row this deployment cannot act on, so another environment's checkouts drop off the list", async () => {
    const d = deps({
      candidates: async () => [cand("FOREIGN", "pending")],
      reconcile: vi.fn(async () => "skipped"),
    });
    for (let i = 0; i < MAX_ASKS_PENDING + 2; i++) await runSweep(d.reconcile, d);
    expect(d.reconcile).toHaveBeenCalledTimes(MAX_ASKS_PENDING);
  });

  it("asks every candidate once before asking any a second time, so an unmarked payment is not starved", async () => {
    const asked: string[] = [];
    const d = deps({
      candidates: async () => [cand("ABANDONED-1", "pending"), cand("ABANDONED-2", "pending"), cand("REAL-UNMARKED", "pending")],
      reconcile: vi.fn(async (ref: string) => {
        asked.push(ref);
        return "no_answer";
      }),
    });
    await d.recordAsk("ABANDONED-1"); // already asked once before
    await d.recordAsk("ABANDONED-1");
    await d.recordAsk("ABANDONED-2");
    await runSweep(d.reconcile, d);
    expect(asked.indexOf("REAL-UNMARKED")).toBeLessThan(asked.indexOf("ABANDONED-1"));
    expect(asked.indexOf("ABANDONED-2")).toBeLessThan(asked.indexOf("ABANDONED-1"));
  });

  it("mails about an order told 'paid' that is close to leaving the window, whatever its ask count", async () => {
    const onGiveUp = vi.fn(async () => undefined);
    const old = new Date(Date.now() - 110 * 60 * 1000);
    const d = deps({
      candidates: async () => [cand("OLD-MARKED", "pending", old), cand("NEW-MARKED", "pending")],
      hasPaidReturn: async () => true,
      onGiveUp,
    });
    await runSweep(d.reconcile, d);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith("OLD-MARKED");
  });
});
