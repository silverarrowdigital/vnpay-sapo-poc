/**
 * Sanity Studio configuration.
 *
 * The Studio is **hosted** (`npm run studio:deploy` → <name>.sanity.studio), not embedded in the
 * Next app. That keeps the heavy `sanity` package a devDependency, out of the Next build, and
 * lets CLAUDE.md's "no NEXT_PUBLIC_ env vars" rule stand: nothing here reaches the storefront.
 *
 * This file sits at the repo root because the Sanity CLI resolves it from the working directory;
 * putting it under sanity/ would make every CLI call need a `cd`. The schemas themselves live in
 * sanity/schemas/.
 *
 * It reads SANITY_STUDIO_* rather than the app's SANITY_* pair: only the SANITY_STUDIO_ prefix is
 * exposed to the Studio bundle by the Sanity CLI, the same way NEXT_PUBLIC_ works in Next. Both
 * pairs are documented in .env.example and hold the same two values.
 */
import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./sanity/schemas";

// SANITY_STUDIO_* is what the CLI exposes to the bundle; the app's own pair is accepted as a
// fallback so .env.local only has to carry one set. See sanity.cli.ts.
const projectId = process.env.SANITY_STUDIO_PROJECT_ID ?? process.env.SANITY_PROJECT_ID ?? "";
const dataset = process.env.SANITY_STUDIO_DATASET ?? process.env.SANITY_DATASET ?? "production";

export default defineConfig({
  name: "default",
  title: "VNPAY → Sapo PoC",
  projectId,
  dataset,
  // visionTool is the GROQ playground. It is the fastest way to check that a query in
  // lib/content.ts returns what the components expect before wiring it up.
  plugins: [structureTool(), visionTool({ defaultApiVersion: "2026-10-01" })],
  schema: { types: schemaTypes },
});
