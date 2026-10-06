import { describe, expect, it, vi } from "vitest";
import type { SapoConfig } from "./config";
import { DiscountRejected, evaluateRule, normaliseCode, quoteDiscount } from "./discount";
import { sapoGet } from "./sapo";

vi.mock("./log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errorMessage: String }));
vi.mock("./sapo", () => ({ sapoGet: vi.fn() }));

type Rule = Parameters<typeof evaluateRule>[0];

const NOW = new Date("2026-10-06T05:00:00Z");
const TEN_PERCENT: Rule = {
  id: 1,
  status: "active",
  value: "-10",
  value_type: "percentage",
  summary: "Giảm 10% cho toàn bộ đơn hàng",
};

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof DiscountRejected) return err.reason;
    throw err;
  }
  return undefined;
}

describe("evaluateRule — amounts", () => {
  it("takes 10% of 268,000₫ as 26,800₫ (the figure Sapo recorded on order #1025)", () => {
    const q = evaluateRule(TEN_PERCENT, "TEST10", { goodsSubtotalVnd: 268_000, totalUnits: 1 }, NOW);
    expect(q.amountVnd).toBe(26_800);
    expect(q.code).toBe("TEST10");
  });

  it("rounds a percentage to whole đồng", () => {
    // 10% of 33,335 is 3,333.5 → 3,334.
    expect(evaluateRule(TEN_PERCENT, "TEST10", { goodsSubtotalVnd: 33_335, totalUnits: 1 }, NOW).amountVnd).toBe(3_334);
  });

  it("caps a percentage at value_limit_amount", () => {
    const rule = { ...TEN_PERCENT, value_limit_amount: "20000" };
    expect(evaluateRule(rule, "C", { goodsSubtotalVnd: 1_000_000, totalUnits: 1 }, NOW).amountVnd).toBe(20_000);
  });

  it("never discounts more than the goods are worth", () => {
    const rule: Rule = { id: 2, status: "active", value: "-500000", value_type: "fixed_amount" };
    expect(evaluateRule(rule, "BIG", { goodsSubtotalVnd: 120_000, totalUnits: 1 }, NOW).amountVnd).toBe(120_000);
  });
});

describe("evaluateRule — refusals", () => {
  const basis = { goodsSubtotalVnd: 268_000, totalUnits: 1 };

  it("refuses an inactive, not-yet-started or expired rule", () => {
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, status: "disabled" }, "C", basis, NOW))).toBe("status");
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, starts_on: "2026-10-07T00:00:00Z" }, "C", basis, NOW))).toBe(
      "not_started",
    );
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, ends_on: "2026-10-05T00:00:00Z" }, "C", basis, NOW))).toBe(
      "expired",
    );
  });

  it("refuses a rule that has used up its usage_limit", () => {
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, usage_limit: 1, times_used: 1 }, "C", basis, NOW))).toBe(
      "usage_limit",
    );
  });

  it("refuses a rule with a condition the site cannot check, instead of guessing", () => {
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, entitled_product_ids: [5] }, "C", basis, NOW))).toBe(
      "unsupported:entitled_product_ids",
    );
  });

  it("refuses below the minimum subtotal", () => {
    const rule = { ...TEN_PERCENT, prerequisite_subtotal_range: { greater_than_or_equal_to: "300000" } };
    expect(reasonOf(() => evaluateRule(rule, "C", basis, NOW))).toBe("min_subtotal");
  });
});

describe("quoteDiscount — the code must match exactly", () => {
  const CFG: SapoConfig = { storeDomain: "shop.invalid", apiKey: "k", apiSecret: "s", sendReceipt: false };
  const basis = { goodsSubtotalVnd: 268_000, totalUnits: 1 };

  // Sapo's `?query=` is a fuzzy substring search (verified 2026-10-02: `?query=T` returns TEST10),
  // so the list returns the TEST10 rule for any of these; only the nested code decides.
  function sapoReturnsTest10() {
    vi.mocked(sapoGet).mockImplementation(async (_cfg, path: string) =>
      path.startsWith("/admin/price_rules.json")
        ? { price_rules: [{ ...TEN_PERCENT, id: 7 }] }
        : { discount_codes: [{ id: 1, code: "TEST10", usage_count: 0 }] },
    );
  }

  it("refuses a one-letter code even though the fuzzy search matched TEST10", async () => {
    sapoReturnsTest10();
    await expect(quoteDiscount(CFG, "T", basis, NOW)).rejects.toMatchObject({ reason: "no_exact_match" });
  });

  it("accepts the code in any case and answers with Sapo's own spelling", async () => {
    sapoReturnsTest10();
    const q = await quoteDiscount(CFG, "test10", basis, NOW);
    expect(q).toMatchObject({ code: "TEST10", amountVnd: 26_800 });
  });

  it("refuses a code whose prefix matches but which is longer", async () => {
    sapoReturnsTest10();
    await expect(quoteDiscount(CFG, "TEST100", basis, NOW)).rejects.toMatchObject({ reason: "no_exact_match" });
  });
});

describe("evaluateRule — every condition the site cannot check is refused", () => {
  const basis = { goodsSubtotalVnd: 268_000, totalUnits: 1 };
  it.each([
    ["entitled_variant_ids", { entitled_variant_ids: [1] }],
    ["entitled_collection_ids", { entitled_collection_ids: [1] }],
    ["entitled_province_ids", { entitled_province_ids: [1] }],
    ["prerequisite_customer_ids", { prerequisite_customer_ids: [1] }],
    ["customer_selection", { customer_selection: "prerequisite" }],
    ["target_type", { target_type: "shipping_line" }],
  ])("%s", (name, extra) => {
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, ...extra } as Rule, "C", basis, NOW))).toBe(`unsupported:${name}`);
  });

  it("refuses an unreadable value and a percentage over 100", () => {
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, value: "abc" }, "C", basis, NOW))).toBe("value_unreadable");
    expect(reasonOf(() => evaluateRule({ ...TEN_PERCENT, value: "-150" }, "C", basis, NOW))).toBe("percentage_over_100");
  });
});

describe("normaliseCode", () => {
  it("trims, and treats empty or oversized input as no code", () => {
    expect(normaliseCode("  test10 ")).toBe("test10");
    expect(normaliseCode("   ")).toBeUndefined();
    expect(normaliseCode("x".repeat(65))).toBeUndefined();
    expect(normaliseCode(42)).toBeUndefined();
  });
});
