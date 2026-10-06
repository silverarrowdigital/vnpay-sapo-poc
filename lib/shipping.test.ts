import { describe, expect, it } from "vitest";
import { FREE_SHIPPING_THRESHOLD_VND, quoteShipping, shippingZoneOf } from "./shipping";

describe("quoteShipping", () => {
  it("charges the flat 30,000₫ below the threshold", () => {
    const q = quoteShipping(2, 348_000);
    expect(q.feeVnd).toBe(30_000);
    expect(q.isFree).toBe(false);
  });

  it("is free exactly at the threshold, not one đồng below it", () => {
    expect(FREE_SHIPPING_THRESHOLD_VND).toBe(500_000);
    expect(quoteShipping(2, 499_999).feeVnd).toBe(30_000);
    expect(quoteShipping(2, 500_000).feeVnd).toBe(0);
  });

  it("keeps the list fee so the summary can show what was waived", () => {
    const q = quoteShipping(2, 696_000);
    expect(q).toMatchObject({ feeVnd: 0, listFeeVnd: 30_000, isFree: true });
  });
});

describe("shippingZoneOf", () => {
  it("puts the two metros first and an unknown province in the last zone", () => {
    expect(shippingZoneOf(1)).toBe("metro");
    expect(shippingZoneOf(2)).toBe("metro");
    expect(shippingZoneOf(10)).toBe("zone1");
    expect(shippingZoneOf(99_999)).toBe("zone2");
  });
});
