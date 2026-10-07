import { defineConfig } from "drizzle-kit";

/**
 * `npx drizzle-kit generate` turns lib/db/schema.ts into a SQL migration under drizzle/ (no database
 * needed). Migrations are applied by scripts/migrate.mjs, which runs at build time on Vercel.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
