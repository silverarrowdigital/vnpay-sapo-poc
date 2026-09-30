"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server component every few seconds while we wait for the IPN. */
export default function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
