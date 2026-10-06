import { vi } from "vitest";

/**
 * Unit tests never touch the network. Today every Sapo and Sanity call is mocked per file, but a
 * future code path that slipped past the mocks would otherwise send test credentials somewhere —
 * this makes that fail loudly instead.
 */
vi.stubGlobal("fetch", () => {
  throw new Error("Network access in a unit test: mock the module that called fetch.");
});
