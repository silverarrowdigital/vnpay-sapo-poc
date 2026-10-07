import { describe, expect, it } from "vitest";
import { isTestProduct } from "./product";

describe("isTestProduct", () => {
  it("recognises the shop's own test products", () => {
    for (const name of ["TEST Size Picker", "Test Product 1", "test product 4", "  Test Product 2 ", "Test"]) {
      expect(isTestProduct(name), name).toBe(true);
    }
  });

  it("does not hide a real product whose name merely contains or starts like 'test'", () => {
    for (const name of ["Hồng Trà Shan Tuyết 60g", "Trà Lài Nguyên Lá", "Testament Tea", "Contest Blend", "Latest Harvest"]) {
      expect(isTestProduct(name), name).toBe(false);
    }
  });
});
