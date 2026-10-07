import { afterEach, describe, expect, it, vi } from "vitest";
import { showTestProducts } from "./config";

describe("showTestProducts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless asked for", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SHOW_TEST_PRODUCTS", "");
    expect(showTestProducts()).toBe(false);
  });

  it("is on in development when SHOW_TEST_PRODUCTS is true", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SHOW_TEST_PRODUCTS", "true");
    expect(showTestProducts()).toBe(true);
  });

  it("is ignored in production, however the variable is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const v of ["true", "1", "TRUE"]) {
      vi.stubEnv("SHOW_TEST_PRODUCTS", v);
      expect(showTestProducts()).toBe(false);
    }
  });
});
