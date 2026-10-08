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
    isActive: async () => true,
    dueJobs: async () => [],
    runJob: vi.fn(async () => "done" as const),
  };
  return { ...base, ...over } as Deps;
}

describe("runSweep", () => {
  it("does nothing when there is nothing to do", async () => {
    const d = deps();
    expect(await runSweep(d.reconcile, d)).toEqual({
      candidates: 0,
      asked: 0,
      settled: 0,
      capped: 0,
      skippedForBudget: 0,
      jobs: 0,
      jobsDone: 0,
    });
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

  it("returns at once, without listing anything, when nothing has happened lately", async () => {
    const candidates = vi.fn(async () => []);
    const d = deps({ candidates, isActive: async () => false });
    const r = await runSweep(d.reconcile, d);
    expect(r.idle).toBe(true);
    expect(candidates).not.toHaveBeenCalled();
    expect(d.reconcile).not.toHaveBeenCalled();
  });

  it("runs the due Sapo jobs before asking VNPAY about anything, and counts what they finished", async () => {
    const order: string[] = [];
    const d = deps({
      dueJobs: async () => ["JOB-1", "JOB-2"],
      runJob: vi.fn(async (ref: string) => {
        order.push(`job:${ref}`);
        return ref === "JOB-1" ? ("done" as const) : ("retry" as const);
      }),
      candidates: async () => [cand("PENDING-1", "pending")],
      reconcile: vi.fn(async (ref: string) => {
        order.push(`ask:${ref}`);
        return "no_answer";
      }),
    });
    const r = await runSweep(d.reconcile, d);
    expect(order).toEqual(["job:JOB-1", "job:JOB-2", "ask:PENDING-1"]);
    expect(r).toMatchObject({ jobs: 2, jobsDone: 1, asked: 1 });
  });

  it("does not hand a reference to reconcile in the same run its job already handled", async () => {
    const d = deps({
      dueJobs: async () => ["BOTH"],
      candidates: async () => [cand("BOTH", "unsynced")],
    });
    await runSweep(d.reconcile, d);
    expect(d.runJob).toHaveBeenCalledWith("BOTH");
    expect(d.reconcile).not.toHaveBeenCalled();
  });

  it("runs at most MAX_PER_RUN jobs, keeps going past one that throws, and still asks VNPAY afterwards", async () => {
    const refs = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => `J${i}`);
    const runJob = vi.fn(async (ref: string) => {
      if (ref === "J0") throw new Error("boom");
      return "done" as const;
    });
    const d = deps({ dueJobs: async () => refs, runJob, candidates: async () => [cand("P", "pending")] });
    const r = await runSweep(d.reconcile, d);
    expect(runJob).toHaveBeenCalledTimes(MAX_PER_RUN);
    expect(r.jobsDone).toBe(MAX_PER_RUN - 1);
    expect(d.reconcile).toHaveBeenCalledWith("P");
  });

  it("still asks VNPAY when the job list cannot be read", async () => {
    const d = deps({
      dueJobs: async () => {
        throw new Error("db down");
      },
      candidates: async () => [cand("P", "pending")],
    });
    const r = await runSweep(d.reconcile, d);
    expect(r.jobs).toBe(0);
    expect(d.reconcile).toHaveBeenCalledWith("P");
  });

  it("runs no job while idle", async () => {
    const dueJobs = vi.fn(async () => ["X"]);
    const d = deps({ dueJobs, isActive: async () => false });
    await runSweep(d.reconcile, d);
    expect(dueJobs).not.toHaveBeenCalled();
  });
});
