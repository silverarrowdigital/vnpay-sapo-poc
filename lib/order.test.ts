/**
 * The money path, end to end inside lib/: what is charged, what is signed, and what the IPN does
 * with it. Sapo, the catalog and the address tables are mocked; VNPAY signing is real, so an IPN
 * here is checked exactly as a live one would be.
 *
 * The order store is the real in-memory one, wrapped so every put and get goes through JSON. The
 * bare Map keeps live object references, so code that mutated an order and forgot to `put` it would
 * pass here and lose the status on Redis — where a repeat IPN would then create a second Sapo order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "./product";
import type { OrderStore } from "./store";
import { sign, type VnpParams } from "./vnpay";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock("./catalog", () => ({ getVariantIndex: vi.fn() }));
vi.mock("./locations", () => ({ resolveAddress: vi.fn() }));
vi.mock("./discount", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discount")>()),
  quoteDiscount: vi.fn(),
}));
vi.mock("./sapo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sapo")>()),
  createOrderOnce: vi.fn(),
  fetchOrderDetailByRef: vi.fn(),
}));
vi.mock("./store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store")>();
  const roundTrip = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
  return {
    ...real,
    getOrderStore: (): OrderStore => {
      const s = real.getOrderStore();
      return {
        kind: s.kind,
        get: async (txnRef) => roundTrip(await s.get(txnRef)),
        put: (order) => s.put(roundTrip(order)),
        has: (txnRef) => s.has(txnRef),
        claim: (txnRef) => s.claim(txnRef),
        release: (txnRef) => s.release(txnRef),
        hit: (key, windowSeconds) => s.hit(key, windowSeconds),
      };
    },
  };
});

const { getVariantIndex } = await import("./catalog");
const { resolveAddress } = await import("./locations");
const { quoteDiscount } = await import("./discount");
const { createOrderOnce } = await import("./sapo");
const { CheckoutError, _resetStore, getOrder, handleIpn, quoteTotals, startCheckout, validateCheckout } = await import(
  "./order"
);

const SECRET = "TESTSECRETTESTSECRETTESTSECRET12";

const ENV: Record<string, string> = {
  VNPAY_TMN_CODE: "TESTTMN1",
  VNPAY_HASH_SECRET: SECRET,
  APP_BASE_URL: "https://shop.test",
  // `.invalid` is reserved (RFC 2606) and never resolves: if an unmocked path ever tried Sapo, the
  // credentials below could not reach a real store. vitest.setup.ts also makes fetch throw.
  SAPO_STORE_DOMAIN: "shop-test.invalid",
  SAPO_API_KEY: "key",
  SAPO_API_SECRET: "secret",
};
const CLEARED = [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SAPO_VARIANT_ID",
  "DISCOUNTS_ENABLED",
  "VNPAY_PAYMENT_URL",
];

function product(variantId: number, priceVnd: number, stock: number, name = `Trà ${variantId}`): CatalogProduct {
  return { variantId, productId: variantId, name, sku: `SKU-${variantId}`, priceVnd, stock, source: "sapo" };
}

function catalog(...products: CatalogProduct[]) {
  vi.mocked(getVariantIndex).mockResolvedValue(new Map(products.map((p) => [p.variantId, p])));
}

function input(lines: { variantId: number; quantity: number }[], extra: { discountCode?: string } = {}) {
  return {
    name: "Nguyen Van Test",
    phone: "0912345678",
    email: "test@example.com",
    address: "1 Test",
    provinceId: 2,
    districtId: 30,
    wardId: 9219,
    paymentMethod: "vnpay" as const,
    lines,
    ...extra,
  };
}

function signedAmount(paymentUrl: string): number {
  return Number(new URL(paymentUrl).searchParams.get("vnp_Amount"));
}

/** An IPN as VNPAY would send it, signed with the shared secret. */
function ipn(txnRef: string, amountVnd: number, overrides: VnpParams = {}): VnpParams {
  const params: VnpParams = {
    vnp_TmnCode: "TESTTMN1",
    vnp_TxnRef: txnRef,
    vnp_Amount: String(amountVnd * 100),
    vnp_ResponseCode: "00",
    vnp_TransactionStatus: "00",
    vnp_TransactionNo: "15696152",
    vnp_BankCode: "NCB",
    vnp_PayDate: "20261006121031",
    ...overrides,
  };
  return { ...params, vnp_SecureHash: sign(params, SECRET) };
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  for (const k of CLEARED) delete process.env[k];
  _resetStore();
  vi.mocked(resolveAddress).mockResolvedValue({
    province: "TP Hồ Chí Minh",
    provinceCode: "HCM",
    provinceId: 2,
    district: "Quận 1",
    districtCode: "Q1",
    districtId: 30,
    ward: "Phường Bến Nghé",
    wardCode: "BN",
    wardId: 9219,
  });
  vi.mocked(createOrderOnce).mockResolvedValue({ order: { id: 1, name: "#1001" }, created: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("startCheckout — what is charged", () => {
  it("signs goods + delivery, priced from the catalog, never from the browser", async () => {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "203.0.113.7");
    if (started.method !== "vnpay") throw new Error("expected a VNPAY checkout");
    // 348,000 + 30,000 delivery = 378,000 — the amount of the real sandbox order #1035.
    expect(signedAmount(started.paymentUrl)).toBe(378_000 * 100);
    expect((await getOrder(started.txnRef))?.amountVnd).toBe(378_000);
  });

  it("multiplies by quantity and adds lines; delivery is free from 500,000₫", async () => {
    catalog(product(1001, 348_000, 68), product(1002, 50_000, 38));
    const started = await startCheckout(
      input([
        { variantId: 1001, quantity: 2 },
        { variantId: 1002, quantity: 1 },
      ]),
      "203.0.113.7",
    );
    if (started.method !== "vnpay") throw new Error("expected a VNPAY checkout");
    expect(signedAmount(started.paymentUrl)).toBe(746_000 * 100);
  });

  it("takes the discount off the goods, then tests the free-delivery line on what is left", async () => {
    catalog(product(1003, 520_000, 10));
    vi.mocked(quoteDiscount).mockResolvedValue({ code: "TEST10", amountVnd: 52_000, summary: "Giảm 10%", priceRuleId: 1 });
    const started = await startCheckout(input([{ variantId: 1003, quantity: 1 }], { discountCode: "test10" }), "1.2.3.4");
    if (started.method !== "vnpay") throw new Error("expected a VNPAY checkout");
    // The code is priced against the server's own subtotal, not anything the browser said.
    expect(quoteDiscount).toHaveBeenCalledWith(expect.anything(), "test10", { goodsSubtotalVnd: 520_000, totalUnits: 1 });
    // 520,000 − 52,000 = 468,000, below 500,000, so delivery is charged: 498,000.
    expect(signedAmount(started.paymentUrl)).toBe(498_000 * 100);
    const stored = await getOrder(started.txnRef);
    expect(stored?.discount).toMatchObject({ code: "TEST10", amountVnd: 52_000 });
    expect(stored?.shipping?.priceVnd).toBe(30_000);
  });

  it("quotes exactly what checkout charges", async () => {
    catalog(product(1001, 348_000, 68), product(1002, 50_000, 38));
    const lines = [
      { variantId: 1001, quantity: 1 },
      { variantId: 1002, quantity: 3 },
    ];
    const quote = await quoteTotals({ lines, provinceId: 2 });
    const started = await startCheckout(input(lines), "1.2.3.4");
    if (started.method !== "vnpay") throw new Error("expected a VNPAY checkout");
    expect(quote?.totalVnd).toBe(signedAmount(started.paymentUrl) / 100);
  });
});

describe("startCheckout — nothing about money comes from the browser", () => {
  it("drops prices and totals sent with the cart and charges the catalog price", async () => {
    catalog(product(1001, 348_000, 68));
    const v = validateCheckout({
      ...input([{ variantId: 1001, quantity: 1 }]),
      lines: [{ variantId: 1001, quantity: 1, priceVnd: 1, unitPriceVnd: 1 }],
      amountVnd: 1,
      totalVnd: 1,
      discountVnd: 999_999,
    });
    if (!v.ok) throw new Error(`validation failed: ${JSON.stringify(v.errors)}`);
    expect(v.value.lines).toEqual([{ variantId: 1001, quantity: 1 }]);
    expect(Object.keys(v.value)).not.toEqual(expect.arrayContaining(["amountVnd", "totalVnd", "discountVnd"]));
    const started = await startCheckout(v.value, "1.2.3.4");
    if (started.method !== "vnpay") throw new Error("expected a VNPAY checkout");
    expect(signedAmount(started.paymentUrl)).toBe(378_000 * 100);
  });

  it("refuses a discount code while discounts are switched off, rather than charging more silently", async () => {
    process.env.DISCOUNTS_ENABLED = "false";
    catalog(product(1001, 348_000, 68));
    await expect(
      startCheckout(input([{ variantId: 1001, quantity: 1 }], { discountCode: "TEST10" }), "1.2.3.4"),
    ).rejects.toMatchObject({ status: 409, fields: { discountCode: expect.any(String) } });
    expect(quoteDiscount).not.toHaveBeenCalled();
  });
});

describe("startCheckout — what is refused", () => {
  it("refuses a variant that is not in the catalog (withdrawn, combo, unpriced)", async () => {
    catalog(product(1001, 348_000, 68));
    await expect(startCheckout(input([{ variantId: 9999, quantity: 1 }]), "1.2.3.4")).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a sold-out variant and a quantity above stock", async () => {
    catalog(product(1001, 348_000, 0), product(1002, 50_000, 1));
    await expect(startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4")).rejects.toBeInstanceOf(CheckoutError);
    await expect(startCheckout(input([{ variantId: 1002, quantity: 2 }]), "1.2.3.4")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("chỉ còn 1"),
    });
  });

  it("refuses cash on delivery while it is switched off, before reading anything", async () => {
    catalog(product(1001, 348_000, 68));
    await expect(
      startCheckout({ ...input([{ variantId: 1001, quantity: 1 }]), paymentMethod: "cod" }, "1.2.3.4"),
    ).rejects.toMatchObject({ status: 409 });
    expect(getVariantIndex).not.toHaveBeenCalled();
    const v = validateCheckout({ ...input([{ variantId: 1001, quantity: 1 }]), paymentMethod: "cod" });
    expect(v.ok).toBe(false);
  });
});

describe("handleIpn — the only place a paid order is created", () => {
  async function pendingOrder(): Promise<{ txnRef: string; amountVnd: number }> {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4");
    return { txnRef: started.txnRef, amountVnd: 378_000 };
  }

  it("answers 97 to a forged signature and creates nothing", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    const forged = { ...ipn(txnRef, amountVnd), vnp_SecureHash: "a".repeat(128) };
    expect((await handleIpn(forged)).RspCode).toBe("97");
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("answers 01 to a reference it never issued", async () => {
    expect((await handleIpn(ipn("20200101000000000000", 378_000))).RspCode).toBe("01");
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("answers 04 when the amount is off by one đồng", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd + 1))).RspCode).toBe("04");
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("creates the Sapo order once for a paid IPN, and answers 02 to the repeat", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createOrderOnce).mock.calls[0][1]).toMatchObject({ txnRef, totalVnd: 378_000, method: "vnpay" });
    expect((await getOrder(txnRef))?.status).toBe("completed");

    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("02");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });

  it("lets only one of two simultaneous IPNs create the order", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    const answers = await Promise.all([handleIpn(ipn(txnRef, amountVnd)), handleIpn(ipn(txnRef, amountVnd))]);
    expect(answers.filter((a) => a.RspCode === "00")).toHaveLength(1);
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });

  it("answers 99 when Sapo fails after payment, and succeeds on VNPAY's retry", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new Error("Sapo POST failed with HTTP 503"));
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("99");
    expect((await getOrder(txnRef))?.status).toBe("sapo_error");

    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    expect((await getOrder(txnRef))?.status).toBe("completed");
    expect(createOrderOnce).toHaveBeenCalledTimes(2);
  });

  it("records a cancelled payment and creates no order", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd, { vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }))).RspCode).toBe(
      "00",
    );
    expect((await getOrder(txnRef))?.status).toBe("cancelled");
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("does not treat a response code of 00 alone as paid", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd, { vnp_TransactionStatus: "01" }))).RspCode).toBe("00");
    expect((await getOrder(txnRef))?.status).toBe("failed");
    expect(createOrderOnce).not.toHaveBeenCalled();
  });
});
