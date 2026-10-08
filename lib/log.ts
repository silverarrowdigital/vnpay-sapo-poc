/** Minimal structured logger. Never pass secrets or full customer records to it. */
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};

/**
 * An error's message, safe to log and to store as an order's `lastError`.
 *
 * `@upstash/redis` throws `"<reason>, command was: <the whole command as JSON>"` on any non-2xx answer
 * (quota, auth, size). That command can be `SET order:<ref>` with the customer's name, phone, email and
 * address, a rate-limit key holding an IP or phone digits, and — with auto-pipelining — commands of
 * other requests batched into the same call. Everything from that marker on is cut.
 */
export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const marker = message.indexOf(", command was:");
  return marker === -1 ? message : `${message.slice(0, marker)} (Redis command omitted)`;
}
