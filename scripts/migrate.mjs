#!/usr/bin/env node
/**
 * Apply the SQL migrations in drizzle/ to the database in DATABASE_URL_UNPOOLED (or DATABASE_URL).
 * Runs at the start of `npm run build`, so a deploy brings the schema along with the code.
 *
 * **It never fails the build.** Until the ledger is what the shop reads from (T14 PR 6) a database
 * problem must not stop an unrelated deploy: an error is printed and the script exits 0. When PR 6
 * makes the database load-bearing this should become strict, because code that expects a table
 * the build failed to create is worse than a failed deploy.
 *
 * Without a database URL (a fresh clone, CI, a laptop) it does nothing. A migration is applied once
 * (drizzle records it in its own table), so re-running is safe.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, nothing to do");
  process.exit(0);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("migrate: schema is up to date");
} catch (err) {
  console.error("migrate: FAILED, continuing the build:", err instanceof Error ? err.message : err);
} finally {
  await pool.end().catch(() => undefined);
}
