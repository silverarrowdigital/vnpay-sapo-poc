/**
 * Sanity CLI configuration — used by `npm run studio:dev` and `npm run studio:deploy`.
 *
 * `studioHost` is what the hosted Studio's address is built from (<studioHost>.sanity.studio).
 * Left to the CLI to prompt for on the first deploy, which then writes it here.
 */
import { defineCliConfig } from "sanity/cli";

/**
 * Both prefixes are accepted, SANITY_STUDIO_ first.
 *
 * Only SANITY_STUDIO_* reaches the Studio *bundle*, but this file runs in Node, where the app's
 * own SANITY_PROJECT_ID is just as readable — and the CLI loads .env.local, so one pair is
 * enough. Without this fallback a project that had only the app's pair failed with
 * "sanity.cli.ts does not contain a project identifier", which says nothing about which variable
 * to set.
 */
export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_STUDIO_DATASET ?? process.env.SANITY_DATASET ?? "production",
  },
  /**
   * Address of the hosted Studio: vnpay-sapo-poc.sanity.studio. Pinned here rather than left to
   * the CLI's first-deploy prompt, so `npm run studio:deploy` never needs a terminal that can
   * answer questions. Deliberately not the brand name — this is a public URL for a PoC.
   */
  studioHost: "vnpay-sapo-poc",
  /**
   * Assigned by Sanity on the first deploy. Pinned for the same reason as studioHost: without it
   * the next deploy prompts for the application id, which a non-interactive run cannot answer.
   */
  deployment: {
    appId: "njkcqle8oi68j8cjkve6yj86",
  },
});
