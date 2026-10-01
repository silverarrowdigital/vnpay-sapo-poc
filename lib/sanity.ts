/**
 * Sanity read client — server-only. Never import this from a "use client" file.
 *
 * Deliberately `@sanity/client` and not `next-sanity`: lib/* stays framework-independent
 * (CLAUDE.md), and next-sanity's main value is its wrapper around Next's cache, which belongs
 * at the app layer rather than here. The product page owns the caching decision.
 *
 * Every failure is swallowed into `undefined`. Sanity holds presentation only, so an outage has
 * to degrade a page, never break it — the opposite of Sapo, which holds price and stock. See
 * getSanityConfig() and CLAUDE.md "Sanity lỗi ≠ Sapo lỗi".
 */
import { createClient, type SanityClient } from "@sanity/client";
import { getSanityConfig } from "./config";
import { errorMessage, log } from "./log";

/**
 * How long a CMS read may hold a render. Short on purpose: the product page already waits on
 * Sapo for price and stock, and a slow CMS must not add to that wait.
 */
const TIMEOUT_MS = 5_000;

/**
 * Memoised across requests. The client holds no per-request state, and building one parses
 * config and sets up an HTTP agent. A changed SANITY_* value needs a restart to take effect,
 * which is how `next dev` already behaves on an .env change.
 */
let client: SanityClient | undefined;

/** The shared client, or `undefined` when Sanity is not configured. */
export function sanityClient(): SanityClient | undefined {
  const cfg = getSanityConfig();
  if (cfg === undefined) return undefined;
  client ??= createClient({
    projectId: cfg.projectId,
    dataset: cfg.dataset,
    apiVersion: cfg.apiVersion,
    // Read-only, and only when the project needs one — see SanityConfig.readToken for why a
    // "public" dataset can still hide documents from an anonymous read.
    token: cfg.readToken,
    // Read through Sanity's CDN: this is public, published content and the CDN is far closer to
    // the reader than the API origin is.
    useCdn: true,
    // Never serve drafts on the storefront. An editor's unfinished copy is not a product page.
    perspective: "published",
    timeout: TIMEOUT_MS,
  });
  return client;
}

/**
 * Run one GROQ query. Returns `undefined` when Sanity is unconfigured, unreachable, slow, or
 * the query errored — callers treat all four the same way and fall back.
 *
 * `label` names the call site in the log; the query itself is not logged because it is long and
 * tells us nothing a label does not.
 */
export async function groqQuery<T>(
  label: string,
  query: string,
  params: Record<string, unknown> = {},
): Promise<T | undefined> {
  const sanity = sanityClient();
  if (sanity === undefined) return undefined;
  try {
    return await sanity.fetch<T>(query, params);
  } catch (err) {
    log.warn("sanity.query_failed", { label, error: errorMessage(err) });
    return undefined;
  }
}

/** Thrown by groqQueryOrThrow when the CMS cannot answer. */
export class SanityUnavailableError extends Error {
  constructor(label: string, cause?: unknown) {
    super(`Sanity query "${label}" failed`);
    this.name = "SanityUnavailableError";
    this.cause = cause;
  }
}

/**
 * Same query, but failure is an error rather than silence.
 *
 * The product page swallows CMS failures because it has Sapo's own description to fall back on —
 * a shop that stops selling because the marketing copy did not load is worse than terse copy. The
 * blog has no fallback: an empty page there is a lie, so its pages report the outage instead and
 * let the reader retry. Both behaviours are deliberate; see CLAUDE.md.
 */
export async function groqQueryOrThrow<T>(
  label: string,
  query: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const sanity = sanityClient();
  if (sanity === undefined) throw new SanityUnavailableError(`${label} (not configured)`);
  try {
    return await sanity.fetch<T>(query, params);
  } catch (err) {
    log.warn("sanity.query_failed", { label, error: errorMessage(err) });
    throw new SanityUnavailableError(label, err);
  }
}
