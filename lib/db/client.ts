/**
 * The Postgres connection (T14). Server-only.
 *
 * Neon's serverless driver over WebSockets, not its HTTP one: the HTTP driver cannot run a
 * transaction, and PR 6 depends on one ("record the payment and the job, then answer VNPAY").
 * Node 22+ has a global `WebSocket`, which is what the driver uses (Vercel runs Node 24; on Node 20
 * every query would fail, which `lib/ledger.ts` tolerates).
 *
 * The pool is small and impatient on purpose: a connection that cannot be had in 2 s is an error, not
 * a wait, and at most 3 are held. Without a connect timeout a stuck Neon would let queries queue
 * behind a full pool for as long as the function lives.
 *
 * `getDb()` is `undefined` when `DATABASE_URL` is not set (a fresh clone, CI, `next dev` without a
 * database). Every caller must treat the database as **optional** until PR 6: Redis is still where
 * the shop reads its orders from, and a database problem must never stop a customer paying.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema>;

let cached: Db | undefined;

export function getDb(): Db | undefined {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") return undefined;
  cached = drizzle(new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000 }), { schema });
  return cached;
}
