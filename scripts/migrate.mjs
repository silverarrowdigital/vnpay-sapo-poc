#!/usr/bin/env node
/**
 * Apply the SQL migrations in drizzle/ to the database in DATABASE_URL_UNPOOLED (or DATABASE_URL).
 * Runs at the start of `npm run build`, so a deploy brings the schema along with the code.
 *
 * - **It never fails the build.** Until the ledger is what the shop reads from (T14 PR 6) a database
 *   problem must not stop an unrelated deploy: an error is printed and the script exits 0. When PR 6
 *   makes the database load-bearing this should become strict.
 * - **It cannot hang the build.** The connection times out after 10 s and the whole run is abandoned
 *   after 60 s.
 * - **Production only.** Preview deployments share this database today (the Neon variables are the
 *   same for Production and Preview), so a migration on an unmerged branch would change the schema
 *   production runs on. A preview skips it until each preview gets its own database branch (PR 10).
 * - Without a database URL (a fresh clone, CI, a laptop) it does nothing. A migration is applied once
 *   (drizzle records it in its own table), so re-running is safe.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, nothing to do");
  process.exit(0);
}
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`migrate: skipped on a ${process.env.VERCEL_ENV} build (it shares the production database)`);
  process.exit(0);
}

const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error("gave up after 60 s")), 60_000).unref());
try {
  await Promise.race([migrate(drizzle(pool), { migrationsFolder: "./drizzle" }), deadline]);
  console.log("migrate: schema is up to date");
} catch (err) {
  console.error("migrate: FAILED, continuing the build:", err instanceof Error ? err.message : err);
} finally {
  await Promise.race([pool.end().catch(() => undefined), new Promise((r) => setTimeout(r, 3_000).unref())]);
  process.exit(0);
}
