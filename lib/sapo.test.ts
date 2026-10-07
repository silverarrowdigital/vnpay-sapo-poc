/**
 * The third place the money has to agree: the order Sapo is told about. The amount VNPAY was signed
 * for is pinned in order.test.ts; this pins that the payload adds up to the same number, and that
 * security rule 2 holds in the payload itself — only a VNPAY order is ever "paid".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SapoConfig } from "./config";
import { buildOrderPayload, createOrderOnce, findOrderByTxnRef, type SapoOrderInput } from "./sapo";

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

describe("finding an order that already exists for a payment (T13.2)", () => {
  const REF = "20261006120921603450";
  const row = { id: 77, name: "#1077", tags: `headless-poc, vnpay, vnpay-${REF}`, note_attributes: [] };
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  /** Sapo as the three status listings: the order sits in exactly one of them. */
  function sapoHolds(where: "open" | "closed" | "cancelled" | "nowhere", failing?: "open" | "closed" | "cancelled") {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ order: { id: 99, name: "#1099" } }), { status: 200 });
      const status = new URL(url).searchParams.get("status");
      if (status === failing) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ orders: status === where ? [row] : [] }), { status: 200 });
    });
  }

  it("asks for open, closed and cancelled orders explicitly, never status=any", async () => {
    sapoHolds("nowhere");
    await findOrderByTxnRef(CFG, REF, "vnpay");
    const statuses = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get("status")).sort();
    expect(statuses).toEqual(["cancelled", "closed", "open"]);
  });

  it.each(["open", "closed", "cancelled"] as const)("finds the order when it is %s", async (where) => {
    sapoHolds(where);
    expect(await findOrderByTxnRef(CFG, REF, "vnpay")).toEqual({ id: 77, name: "#1077" });
  });

  it("does not create a second order when the first was already closed", async () => {
    sapoHolds("closed");
    const r = await createOrderOnce(CFG, orderInput("vnpay"));
    expect(r.created).toBe(false);
    expect(fetchMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === "POST")).toBe(false);
  });

  it("answers none only when every status was actually searched", async () => {
    sapoHolds("nowhere");
    expect(await findOrderByTxnRef(CFG, REF, "vnpay")).toBeNull();
  });

  it("refuses to say 'none' — and so to create — when one status could not be searched", async () => {
    sapoHolds("nowhere", "closed");
    await expect(findOrderByTxnRef(CFG, REF, "vnpay")).rejects.toThrow(/503/);
    sapoHolds("nowhere", "closed");
    await expect(createOrderOnce(CFG, orderInput("vnpay"))).rejects.toThrow();
    expect(fetchMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === "POST")).toBe(false);
  });

  it("still finds the order when another status failed but the order was in a status that answered", async () => {
    sapoHolds("open", "cancelled");
    expect(await findOrderByTxnRef(CFG, REF, "vnpay")).toEqual({ id: 77, name: "#1077" });
  });
});

describe("a create whose answer is lost (T13.3)", () => {
  const fetchMock = vi.fn();
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("is found by its tag on the retry and never created twice", async () => {
    // Sapo's side: the first POST is accepted and stored, but the answer never reaches us.
    const stored: { id: number; name: string; tags: string; note_attributes: never[] }[] = [];
    let posts = 0;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        posts++;
        const sent = JSON.parse(init.body as string).order as { tags: string };
        stored.push({ id: 500 + posts, name: `#${1500 + posts}`, tags: sent.tags, note_attributes: [] });
        throw new Error("socket hang up"); // the lost answer
      }
      const status = new URL(url).searchParams.get("status");
      return new Response(JSON.stringify({ orders: status === "open" ? stored : [] }), { status: 200 });
    });

    const input = orderInput("vnpay");
    await expect(createOrderOnce(CFG, input)).rejects.toThrow(/Network error/); // what the IPN sees → answers 99, VNPAY retries
    expect(posts).toBe(1);

    const retry = await createOrderOnce(CFG, input); // VNPAY's retry
    expect(retry.created).toBe(false);
    expect(retry.order).toEqual({ id: 501, name: "#1501" });
    expect(posts).toBe(1); // no second order
  });
});
