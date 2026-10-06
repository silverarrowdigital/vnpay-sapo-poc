import { defineConfig } from "vitest/config";

/**
 * Unit tests for the money path: pricing, signing, the Sapo payload, the IPN state machine.
 * `lib/` is framework-independent on purpose (CLAUDE.md), which is what lets these run in plain
 * Node with no Next.js, no network and no credentials. Sapo, the catalog and the address tables are
 * mocked per test file; the order store falls back to its in-memory implementation because no Redis
 * variable is set. Needs Node ^22.12 or 24+ (Vitest 5's own engine range).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Each file sets its own process.env; isolation keeps one file's variables out of another's.
    isolate: true,
    // A mock's return value set in one test must not leak into the next.
    mockReset: true,
  },
});
