/**
 * The third place the money has to agree: the order Sapo is told about. The amount VNPAY was signed
 * for is pinned in order.test.ts; this pins that the payload adds up to the same number, and that
 * security rule 2 holds in the payload itself — only a VNPAY order is ever "paid".
 */
import { describe, expect, it } from "vitest";
import type { SapoConfig } from "./config";
import { buildOrderPayload, type SapoOrderInput } from "./sapo";

const CFG: SapoConfig = { storeDomain: "shop.invalid", apiKey: "k", apiSecret: "s", sendReceipt: false };

function orderInput(method: "vnpay" | "cod"): SapoOrderInput {
  return {
    txnRef: "20261006120921603450",
    method,
    vnpTransactionNo: method === "vnpay" ? "15696152" : undefined,
    vnpBankCode: method === "vnpay" ? "NCB" : undefined,
    vnpPayDate: method === "vnpay" ? "20261006121031" : undefined,
    customer: { name: "Nguyễn Văn Test", phone: "0912345678", email: "test@example.com", address1: "1 Test" },
    lines: [
      { variantId: 1001, sku: "TEST-0071", productName: "Trà", unitPriceVnd: 348_000, quantity: 1 },
      { variantId: 1002, sku: "TEST-0002", productName: "Trà 2", unitPriceVnd: 50_000, quantity: 3 },
    ],
    shipping: { title: "Giao hàng tiêu chuẩn", code: "standard", priceVnd: 30_000 },
    discount: { code: "TEST10", amountVnd: 49_800 },
    // 348,000 + 150,000 − 49,800 + 30,000
    totalVnd: 478_200,
  };
}

describe("buildOrderPayload", () => {
  it("adds up to the total VNPAY charged: lines − discount + shipping", () => {
    const { order } = buildOrderPayload(CFG, orderInput("vnpay"));
    const goods = order.line_items.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const discount = order.discount_codes?.[0].amount ?? 0;
    const shipping = order.shipping_lines?.[0].price ?? 0;
    expect(goods - discount + shipping).toBe(478_200);
  });

  it("records the discount as the fixed amount we charged, never as a rule Sapo would recompute", () => {
    const { order } = buildOrderPayload(CFG, orderInput("vnpay"));
    expect(order.discount_codes).toEqual([{ code: "TEST10", amount: 49_800, type: "fixed_amount" }]);
    expect(order.shipping_lines?.[0]).toMatchObject({ price: 30_000, code: "standard" });
  });

  it("marks a VNPAY order paid, with one transaction for exactly the total", () => {
    const { order } = buildOrderPayload(CFG, orderInput("vnpay"));
    expect(order.financial_status).toBe("paid");
    expect(order.transactions).toEqual([{ kind: "sale", status: "success", amount: 478_200, gateway: "VNPAY" }]);
    expect(order.tags).toContain("vnpay-20261006120921603450");
  });

  it("never marks a COD order paid and sends it no transaction (security rule 2)", () => {
    const { order } = buildOrderPayload(CFG, orderInput("cod"));
    expect(order.financial_status).toBe("pending");
    expect("transactions" in order).toBe(false);
    expect(order.tags).toContain("cod-20261006120921603450");
  });

  it("deducts stock only for lines linked to a variant", () => {
    expect(buildOrderPayload(CFG, orderInput("vnpay")).order.inventory_behaviour).toBe("decrement_ignoring_policy");
  });
});
