/**
 * The sweep (T14 PR 6): finds payments nobody is looking at and finishes them. Server-only.
 *
 * The gap it closes: on 2026-10-07 VNPAY took 361,200 VND and never sent the IPN. `reconcilePendingPayment`
 * (T13.0) asks VNPAY and settles the order, but only when someone opens the result page; a customer
 * who closes the tab leaves it unasked. Redis cannot list "orders still waiting" (no key scan), the
 * Postgres ledger can — that is the point of having it. This module lists the candidates from the
 * ledger and hands each to the **same** reconcile code, so there is still exactly one way a paid
 * order is created (security rule 2).
 *
 * Two kinds of candidate:
 * - a VNPAY payment still `pending` after a minute (the IPN did not come);
 * - a payment that is `paid` but whose Sapo order is not `created` (Sapo failed, and with no IPN
 *   there is no VNPAY retry to try again).
 *
 * It is driven from outside (QStash every five minutes; a daily Vercel cron also calls it, but it only
 * sees the last two hours, so that is a heartbeat, not a substitute if QStash stops),
 * and is bounded on every axis so a bad day cannot turn it into a loop that hammers VNPAY or Sapo:
 * at most `MAX_PER_RUN` references a run, each asked about at most `MAX_ASKS_*` times in total (the
 * counter lives in the shared store), and a wall-clock budget for the whole run.
 */
import { ledgerSweepCandidates, type SweepCandidate } from "./ledger";
import { errorMessage, log } from "./log";
import { getOrderStore } from "./store";

export const MAX_PER_RUN = 10;
/** A checkout nobody pays is asked about this many times (about 25 minutes at a five-minute cadence) and then left. */
export const MAX_ASKS_PENDING = 5;
/** A paid order Sapo would not take is retried this many times (about 40 minutes) before it is left to the owner's alert. */
export const MAX_ASKS_UNSYNCED = 8;
/**
 * No new item is started after this. One item can take close to a minute (querydr 6 s, three Sapo
 * lookups, a Sapo create, ledger calls), and the route allows 120 s, so an item started at the budget
 * still finishes instead of being killed mid-order.
 */
const RUN_BUDGET_MS = 20_000;
/** A signed-"paid" order this old and still unconfirmed is mailed about whatever its ask count, before the 2 h window closes on it. */
const ALERT_AGE_MS = 105 * 60 * 1000;
const COUNTER_WINDOW_SECONDS = 2 * 60 * 60;

export interface SweepDeps {
  candidates: () => Promise<SweepCandidate[]>;
  /** `reconcilePendingPayment` in production; injected so the bounds can be tested. */
  reconcile: (txnRef: string) => Promise<string>;
  /** How many times this reference has been asked about so far. */
  askCount: (txnRef: string) => Promise<number>;
  /** Records one ask. */
  recordAsk: (txnRef: string) => Promise<void>;
  /** Did VNPAY's signed browser return say "paid" for this reference? Those are asked about first. */
  hasPaidReturn: (txnRef: string) => Promise<boolean>;
  /** A reference whose browser was told "paid" is being given up on: tell the owner. */
  onGiveUp: (txnRef: string) => Promise<void>;
  now: () => number;
}

export interface SweepResult {
  candidates: number;
  asked: number;
  settled: number;
  capped: number;
  skippedForBudget: number;
}

const defaultDeps = (reconcile: SweepDeps["reconcile"]): SweepDeps => ({
  candidates: () => ledgerSweepCandidates(MAX_PER_RUN * 4),
  reconcile,
  askCount: (txnRef) => getOrderStore().count(`sweep:${txnRef}`),
  recordAsk: async (txnRef) => {
    await getOrderStore().hit(`sweep:${txnRef}`, COUNTER_WINDOW_SECONDS);
  },
  hasPaidReturn: async () => false,
  onGiveUp: async () => undefined,
  now: () => Date.now(),
});

export async function runSweep(
  reconcile: SweepDeps["reconcile"],
  overrides: Partial<SweepDeps> = {},
): Promise<SweepResult> {
  const deps: SweepDeps = { ...defaultDeps(reconcile), ...overrides };
  const result: SweepResult = { candidates: 0, asked: 0, settled: 0, capped: 0, skippedForBudget: 0 };
  const started = deps.now();
  let list: SweepCandidate[];
  try {
    list = await deps.candidates();
  } catch (err) {
    log.error("sweep.candidates_failed", { error: errorMessage(err) });
    return result;
  }
  result.candidates = list.length;

  // The terminal allows about one querydr every five minutes (lib/querydr.ts), so the order matters more
  // than the count: an order whose browser VNPAY told "paid" goes first, then the newest. Otherwise a
  // trickle of abandoned checkouts could use every slot until a real payment ages out unasked.
  const returned = new Set<string>();
  for (const c of list) if (await deps.hasPaidReturn(c.txnRef).catch(() => false)) returned.add(c.txnRef);
  // Within each group, the least-asked first (then newest, the order the list came in): every candidate
  // gets a first ask before any gets a second, so an unmarked payment — the customer closed the tab
  // before VNPAY redirected back — waits at most one slot per candidate, never behind five asks each.
  const asked = new Map<string, number>();
  for (const c of list) asked.set(c.txnRef, await deps.askCount(c.txnRef).catch(() => 0));
  list = [...list].sort(
    (a, b) =>
      Number(returned.has(b.txnRef)) - Number(returned.has(a.txnRef)) || (asked.get(a.txnRef) ?? 0) - (asked.get(b.txnRef) ?? 0),
  );

  for (const c of list) {
    // A reference already asked about as often as it is allowed takes no slot: abandoned checkouts
    // pile up and must not crowd out a payment that came in a minute ago.
    if (result.asked >= MAX_PER_RUN) break;
    if (deps.now() - started > RUN_BUDGET_MS) {
      result.skippedForBudget++;
      continue;
    }
    try {
      // Close to leaving the window, and the customer was told "paid": speak now, however many asks it had
      // (a result page or another process may have used the slots the sweep's count never saw).
      if (returned.has(c.txnRef) && deps.now() - c.createdAt.getTime() > ALERT_AGE_MS) await deps.onGiveUp(c.txnRef);
      const cap = c.kind === "unsynced" ? MAX_ASKS_UNSYNCED : MAX_ASKS_PENDING;
      if ((await deps.askCount(c.txnRef)) >= cap) {
        result.capped++;
        // The customer was told "paid" and nothing confirmed it: this is the case worth a human.
        if (returned.has(c.txnRef)) await deps.onGiveUp(c.txnRef);
        continue;
      }
      const outcome = await deps.reconcile(c.txnRef);
      // "throttled" did not reach VNPAY (the terminal is cooling down): not an ask, and it must not use up
      // the allowance. "skipped" is a row this deployment cannot act on at all (another environment's
      // checkout in the shared database, a COD order, one already finished): counted, so it drops off
      // after a few runs instead of filling the list for two hours.
      if (outcome === "throttled") continue;
      if (outcome === "skipped") {
        await deps.recordAsk(c.txnRef);
        continue;
      }
      result.asked++;
      await deps.recordAsk(c.txnRef);
      if (outcome === "settled") {
        result.settled++;
        log.warn("sweep.settled", { txnRef: c.txnRef, kind: c.kind });
      }
    } catch (err) {
      // One bad reference must not stop the others.
      log.error("sweep.item_failed", { txnRef: c.txnRef, error: errorMessage(err) });
    }
  }
  log.info("sweep.run", { ...result });
  return result;
}
