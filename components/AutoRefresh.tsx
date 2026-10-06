"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the server component while we wait for the IPN: every `fastMs` for the first
 * `fastForMs`, then every `slowMs`.
 *
 * The back-off exists because every tick is a real request to /success, and that page is
 * rate-limited per IP (lib/order.ts `RATE_POLICIES.result`). Polling every 3 s for ever spent the
 * whole allowance in about six minutes, and a customer who never touched the page was then shown
 * "too many requests" at exactly the moment they were wondering whether their money went through.
 * An IPN usually lands within seconds (8 s measured live), so the first minute stays fast; past that
 * the IPN is being retried by VNPAY every 5 minutes and polling faster than 15 s gains nothing.
 *
 * `router.refresh()` keeps client state, so this component stays mounted and the clock keeps
 * running across refreshes.
 */
export default function AutoRefresh({
  fastMs = 3_000,
  fastForMs = 60_000,
  slowMs = 15_000,
}: {
  fastMs?: number;
  fastForMs?: number;
  slowMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const startedAt = Date.now();
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      router.refresh();
      schedule();
    };
    const schedule = () => {
      id = setTimeout(tick, Date.now() - startedAt < fastForMs ? fastMs : slowMs);
    };
    schedule();
    return () => clearTimeout(id);
  }, [router, fastMs, fastForMs, slowMs]);
  return null;
}
