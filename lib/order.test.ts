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
vi.mock("./alert", () => ({ sendAlert: vi.fn(async () => true) }));
vi.mock("./querydr", () => ({ queryVnpayTransaction: vi.fn() }));
vi.mock("./ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ledger")>()),
  ledgerPaidParams: vi.fn(async () => undefined),
}));
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
        count: (key) => s.count(key),
        kvGet: (key) => s.kvGet(key),
        kvSet: (key, value, ttl) => s.kvSet(key, value, ttl),
        kvSetIfAbsent: (key, value, ttl) => s.kvSetIfAbsent(key, value, ttl),
        kvDelete: (key) => s.kvDelete(key),
      };
    },
  };
});

const { getVariantIndex } = await import("./catalog");
const { resolveAddress } = await import("./locations");
const { quoteDiscount } = await import("./discount");
const { SapoApiError, createOrderOnce, fetchOrderDetailByRef } = await import("./sapo");
const { sendAlert } = await import("./alert");
const { queryVnpayTransaction } = await import("./querydr");
const { ledgerPaidParams } = await import("./ledger");
const { SWEEP_ACTIVE_KEY } = await import("./sweep");
const { CheckoutError, _resetStore, getOrder, alertUnsettledPaidReturn, handleIpn, lookupOrder, markPaidReturn, quoteTotals, reconcilePendingPayment, startCheckoutOnce, startCheckout, validateCheckout } =
  await import("./order");

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

  it("answers 01 to a reference it never issued, and tells the owner a payment is unaccounted for", async () => {
    expect((await handleIpn(ipn("20200101000000000000", 378_000))).RspCode).toBe("01");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect(sendAlert).toHaveBeenCalledWith(
      "paid_no_order",
      "20200101000000000000",
      expect.objectContaining({ amountVnd: 378_000, vnpTransactionNo: "15696152" }),
    );
  });

  it("tells the owner the reason is internal, not Sapo, when the failure was not a Sapo error", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new Error("Environment not configured (missing: SAPO_API_KEY)"));
    await handleIpn(ipn(txnRef, amountVnd));
    const reason = vi.mocked(sendAlert).mock.calls[0][2]?.reason ?? "";
    expect(reason).toMatch(/internal/);
    expect(reason).not.toMatch(/SAPO_API_KEY|Sapo answered/);
  });

  it("answers VNPAY exactly as before even if the alert itself blows up", async () => {
    vi.mocked(sendAlert).mockRejectedValue(new Error("mail provider exploded"));
    // unknown reference, successful payment -> 01
    expect((await handleIpn(ipn("20200101000000000002", 378_000))).RspCode).toBe("01");
    // amount mismatch on a real order -> 04
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd + 1))).RspCode).toBe("04");
    // Sapo failure -> 99
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("99");
    // and the alert was really attempted at all three places, not skipped
    expect(sendAlert).toHaveBeenCalledTimes(3);
  });

  it("says plainly when the Sapo order exists and only our own record failed", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    // createOrderOnce succeeds, but the store write that records it fails
    const real = (await vi.importActual<typeof import("./store")>("./store")).getOrderStore();
    const put = real.put.bind(real);
    let writes = 0;
    const spy = vi.spyOn(real, "put").mockImplementation(async (o) => {
      writes += 1;
      if (writes === 2) throw new Error("redis down"); // 1 = processing, 2 = completed
      return put(o);
    });
    await handleIpn(ipn(txnRef, amountVnd));
    spy.mockRestore();
    expect(vi.mocked(sendAlert).mock.calls[0][2]?.reason).toMatch(/WAS created/);
  });

  it("does not alert for an unknown reference whose payment failed or was cancelled", async () => {
    await handleIpn(ipn("20200101000000000001", 378_000, { vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }));
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("answers 04 when the amount is off by one đồng, and alerts because money was taken", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd + 1))).RspCode).toBe("04");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect(sendAlert).toHaveBeenCalledWith("amount_mismatch", txnRef, expect.objectContaining({ amountVnd: amountVnd + 1 }));
  });

  it("creates the Sapo order once for a paid IPN, and answers 02 to the repeat", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    expect(sendAlert).not.toHaveBeenCalled(); // a normal paid order is not an incident
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
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("Sapo POST failed with HTTP 503", 503, "customer@example.com"));
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("99");
    expect((await getOrder(txnRef))?.status).toBe("sapo_error");
    // The owner is told the HTTP status only — never the response body, which can hold customer data.
    expect(sendAlert).toHaveBeenCalledWith(
      "sapo_failed",
      txnRef,
      expect.objectContaining({ amountVnd, reason: "Sapo answered HTTP 503" }),
    );

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

describe("lookupOrder — reference plus phone, and nothing else", () => {
  const REF = "20261006120921K3M9Q7TXA2B4C6DE";
  const detail = { id: 1, name: "#1", phoneDigits: "0912345678", totalVnd: 80_000, shippingVnd: 30_000, discountVnd: 0, lines: [] };

  beforeEach(() => {
    vi.mocked(fetchOrderDetailByRef).mockResolvedValue(detail as never);
  });

  it("finds the order for the right phone in any prefix form, with the reference typed in lower case", async () => {
    const r = await lookupOrder(REF.toLowerCase(), "+84 912 345 678", "203.0.113.7");
    expect(r.outcome).toBe("found");
    expect(vi.mocked(fetchOrderDetailByRef).mock.calls[0][1]).toBe(REF);
  });

  it("answers a wrong phone exactly like a missing order", async () => {
    const wrong = await lookupOrder(REF, "0900000000", "203.0.113.7");
    vi.mocked(fetchOrderDetailByRef).mockResolvedValue(null);
    const missing = await lookupOrder(REF, "0912345678", "203.0.113.8");
    expect(wrong).toEqual({ outcome: "not_found" });
    expect(missing).toEqual(wrong);
  });

  it("does not call Sapo, or count a try, for a malformed reference", async () => {
    expect(await lookupOrder("abc 123", "0912345678", "203.0.113.7")).toEqual({ outcome: "not_found" });
    expect(fetchOrderDetailByRef).not.toHaveBeenCalled();
    const { getOrderStore } = await import("./store");
    expect(await getOrderStore().count("lookupPhone:912345678")).toBe(0);
  });

  it("stops after five tries an hour on one phone number, from a different IP every time", async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push((await lookupOrder(REF, i % 2 ? "0912345678" : "+84912345678", `198.51.100.${i}`)).outcome);
    }
    expect(outcomes).toEqual(["found", "found", "found", "found", "found", "rate_limited"]);
  });
});

describe("reconcilePendingPayment — VNPAY took the money and never sent the IPN", () => {
  const MINUTE = 60_000;

  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  /** First sight of the order on the result page records the time and waits. */
  async function firstSight(txnRef: string): Promise<void> {
    expect(await reconcilePendingPayment(txnRef)).toBe("skipped");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
  }

  async function pending(): Promise<{ txnRef: string; amountVnd: number }> {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4");
    // The browser return was signed "paid": what lets the result page ask VNPAY about this order.
    await markPaidReturn(started.txnRef);
    return { txnRef: started.txnRef, amountVnd: 378_000 };
  }

  /** What lib/querydr.ts hands back for a verified answer. */
  function answer(txnRef: string, amountVnd: number, overrides: Record<string, string> = {}) {
    return {
      ok: true as const,
      params: {
        vnp_TmnCode: "TESTTMN1",
        vnp_TxnRef: txnRef,
        vnp_Amount: String(amountVnd * 100),
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
        vnp_TransactionNo: "15697481",
        vnp_BankCode: "NCB",
        vnp_PayDate: "20261007134156",
        ...overrides,
      },
    };
  }

  it("creates the order once from VNPAY's answer, and the late IPN then gets 02", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(answer(txnRef, amountVnd));

    await firstSight(txnRef);
    vi.advanceTimersByTime(61_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("settled");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createOrderOnce).mock.calls[0][1]).toMatchObject({ txnRef, totalVnd: amountVnd, method: "vnpay" });
    expect((await getOrder(txnRef))?.status).toBe("completed");

    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("02");
    expect(await reconcilePendingPayment(txnRef)).toBe("skipped");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });

  it("does not ask during the first minute after the browser came back, even for an old checkout", async () => {
    const { txnRef } = await pending();
    vi.advanceTimersByTime(20 * MINUTE); // the customer spent twenty minutes on VNPAY's pages
    await firstSight(txnRef);
    vi.advanceTimersByTime(30_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("skipped");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
  });

  it("also retries an order a settle left in sapo_error, since no IPN is coming to do it", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(answer(txnRef, amountVnd));
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    await firstSight(txnRef);
    vi.advanceTimersByTime(61_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("no_answer"); // Sapo failed: 99
    expect((await getOrder(txnRef))?.status).toBe("sapo_error");

    vi.advanceTimersByTime(291_000); // past the five-minute cool-down VNPAY forces on querydr
    expect(await reconcilePendingPayment(txnRef)).toBe("settled");
    expect((await getOrder(txnRef))?.status).toBe("completed");
  });

  it("asks at most once a minute for one reference", async () => {
    const { txnRef } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "network" });
    await firstSight(txnRef);
    vi.advanceTimersByTime(61_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("no_answer");
    expect(await reconcilePendingPayment(txnRef)).toBe("throttled");
    expect(queryVnpayTransaction).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when VNPAY says the payment did not succeed", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(answer(txnRef, amountVnd, { vnp_TransactionStatus: "02" }));
    await firstSight(txnRef);
    vi.advanceTimersByTime(61_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("not_paid");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect((await getOrder(txnRef))?.status).toBe("pending");
  });

  it("creates nothing when the amount VNPAY reports is not the amount we asked for", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(answer(txnRef, amountVnd - 1));
    await firstSight(txnRef);
    vi.advanceTimersByTime(61_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("no_answer");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect(sendAlert).toHaveBeenCalledWith("amount_mismatch", txnRef, expect.anything());
  });

  it("creates nothing when VNPAY cannot be reached", async () => {
    const { txnRef } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "network" });
    await firstSight(txnRef);
    vi.advanceTimersByTime(61_000);
    expect(await reconcilePendingPayment(txnRef)).toBe("no_answer");
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("leaves alone a reference it never issued, an order past two hours, and one already finished", async () => {
    expect(await reconcilePendingPayment("20200101000000ABCDEFGHJKMNPQRST")).toBe("skipped");
    const { txnRef, amountVnd } = await pending();
    expect(await reconcilePendingPayment(txnRef, Date.now() + 3 * 60 * MINUTE)).toBe("skipped"); // older than two hours
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    vi.advanceTimersByTime(2 * MINUTE);
    expect(await reconcilePendingPayment(txnRef)).toBe("skipped");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
  });
});

describe("startCheckoutOnce — one request, one order (T13.4)", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  const cart = () => input([{ variantId: 1001, quantity: 1 }]);

  it("returns the same payment URL for a repeat of the same form, and creates one pending order", async () => {
    catalog(product(1001, 348_000, 68));
    const first = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
    const again = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
    expect(again).toEqual(first);
    expect(getVariantIndexCalls()).toBe(1); // the second call never priced anything
  });

  it("starts a new checkout when the same key arrives with a different cart", async () => {
    catalog(product(1001, 348_000, 68));
    const first = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
    const changed = await startCheckoutOnce(input([{ variantId: 1001, quantity: 2 }]), "1.2.3.4", KEY);
    expect(changed.txnRef).not.toBe(first.txnRef);
    expect(signedAmount((changed as { paymentUrl: string }).paymentUrl)).not.toBe(signedAmount((first as { paymentUrl: string }).paymentUrl));
  });

  it("treats a missing or malformed key as no key at all", async () => {
    catalog(product(1001, 348_000, 68));
    const a = await startCheckoutOnce(cart(), "1.2.3.4", undefined);
    const b = await startCheckoutOnce(cart(), "1.2.3.4", "short");
    expect(a.txnRef).not.toBe(b.txnRef);
  });

  it("lets the loser of two simultaneous submits wait instead of creating a second order", async () => {
    catalog(product(1001, 348_000, 68));
    const results = await Promise.allSettled([startCheckoutOnce(cart(), "1.2.3.4", KEY), startCheckoutOnce(cart(), "1.2.3.4", KEY)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBeInstanceOf(CheckoutError);
    expect((refused[0].reason as InstanceType<typeof CheckoutError>).status).toBe(409);
  });

  it("forgets the key when the first attempt is refused, so the corrected form can be resubmitted", async () => {
    catalog(product(1001, 348_000, 0)); // sold out → 409
    await expect(startCheckoutOnce(cart(), "1.2.3.4", KEY)).rejects.toBeInstanceOf(CheckoutError);
    catalog(product(1001, 348_000, 68));
    const ok = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
    expect(ok.method).toBe("vnpay");
  });

  it("does not replay after two minutes: a slow retry is a new checkout", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      catalog(product(1001, 348_000, 68));
      const first = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
      vi.advanceTimersByTime(3 * 60 * 1000);
      const later = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
      expect(later.txnRef).not.toBe(first.txnRef);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not replay a payment URL for an order that is no longer pending", async () => {
    catalog(product(1001, 348_000, 68));
    const first = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
    expect((await handleIpn(ipn(first.txnRef, 378_000))).RspCode).toBe("00"); // paid
    const again = await startCheckoutOnce(cart(), "1.2.3.4", KEY);
    expect(again.txnRef).not.toBe(first.txnRef);
  });
});

function getVariantIndexCalls(): number {
  return vi.mocked(getVariantIndex).mock.calls.length;
}

describe("reconcilePendingPayment with skipWait — what the sweep uses", () => {
  async function pending(): Promise<{ txnRef: string; amountVnd: number }> {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4");
    return { txnRef: started.txnRef, amountVnd: 378_000 };
  }
  const paidAnswer = (txnRef: string, amountVnd: number, overrides: Record<string, string> = {}) => ({
    ok: true as const,
    params: {
      vnp_TmnCode: "TESTTMN1",
      vnp_TxnRef: txnRef,
      vnp_Amount: String(amountVnd * 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "15697481",
      vnp_BankCode: "NCB",
      vnp_PayDate: "20261007134156",
      ...overrides,
    },
  });

  it("asks at once, without the first-sight wait, and settles the order exactly once", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(paidAnswer(txnRef, amountVnd));
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("settled");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("skipped"); // now completed
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });

  it("still asks VNPAY at most once a minute for one reference", async () => {
    const { txnRef } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "network" });
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("no_answer");
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("throttled");
    expect(queryVnpayTransaction).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when VNPAY says the payment did not succeed", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(paidAnswer(txnRef, amountVnd, { vnp_TransactionStatus: "11" }));
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("not_paid");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect((await getOrder(txnRef))?.status).toBe("pending");
  });

  it("still leaves alone an order older than two hours, one already finished, and a reference it never issued", async () => {
    const { txnRef, amountVnd } = await pending();
    expect(await reconcilePendingPayment(txnRef, Date.now() + 3 * 60 * 60 * 1000, { skipWait: true })).toBe("skipped");
    expect(await reconcilePendingPayment("20200101000000ABCDEFGHJKMNPQRST", Date.now(), { skipWait: true })).toBe("skipped");
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("skipped");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
  });

  it("retries a paid order Sapo refused, since no IPN is coming to do it", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue(paidAnswer(txnRef, amountVnd));
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("no_answer");
    expect((await getOrder(txnRef))?.status).toBe("sapo_error");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.advanceTimersByTime(291_000); // past the five-minute cool-down
      expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("settled");
    } finally {
      vi.useRealTimers();
    }
    expect((await getOrder(txnRef))?.status).toBe("completed");
  });
});

describe("VNPAY's one-querydr-per-five-minutes limit", () => {
  async function pending(): Promise<{ txnRef: string; amountVnd: number }> {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4");
    return { txnRef: started.txnRef, amountVnd: 378_000 };
  }

  it("does not ask for a second order inside the cool-down that the first answer started", async () => {
    const a = await pending();
    const b = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "network" });
    expect(await reconcilePendingPayment(a.txnRef, Date.now(), { skipWait: true })).toBe("no_answer");
    expect(await reconcilePendingPayment(b.txnRef, Date.now(), { skipWait: true })).toBe("throttled");
    expect(queryVnpayTransaction).toHaveBeenCalledTimes(1);
  });

  it("treats VNPAY's 94 as 'ask later', not as an answer about the payment", async () => {
    const { txnRef } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("throttled");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect((await getOrder(txnRef))?.status).toBe("pending");
  });

  it("retries Sapo for an order VNPAY already confirmed from what the ledger recorded, without asking VNPAY", async () => {
    const { txnRef, amountVnd } = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({
      ok: true as const,
      params: {
        vnp_TmnCode: "TESTTMN1",
        vnp_TxnRef: txnRef,
        vnp_Amount: String(amountVnd * 100),
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
        vnp_TransactionNo: "15697481",
        vnp_BankCode: "NCB",
        vnp_PayDate: "20261007134156",
      },
    });
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("no_answer"); // paid, Sapo refused
      expect((await getOrder(txnRef))?.status).toBe("sapo_error");
      vi.mocked(queryVnpayTransaction).mockClear();

      vi.advanceTimersByTime(61_000); // inside the cool-down: querydr would be refused, but the ledger knows
      vi.mocked(ledgerPaidParams).mockResolvedValueOnce({
        vnp_TxnRef: txnRef,
        vnp_Amount: String(amountVnd * 100),
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
        vnp_TransactionNo: "15697481",
        vnp_BankCode: "NCB",
        vnp_PayDate: "20261007134156",
      });
      expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("settled");
      expect(queryVnpayTransaction).not.toHaveBeenCalled();
      expect((await getOrder(txnRef))?.status).toBe("completed");
      const last = vi.mocked(createOrderOnce).mock.calls.at(-1)![1];
      expect(last).toMatchObject({ txnRef, vnpTransactionNo: "15697481", vnpBankCode: "NCB", vnpPayDate: "20261007134156" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let the result page spend the terminal's querydr slot on an order VNPAY never signed as paid", async () => {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4"); // no markPaidReturn
    expect(await reconcilePendingPayment(started.txnRef)).toBe("skipped");
    expect(await reconcilePendingPayment(started.txnRef, Date.now(), { skipWait: false })).toBe("skipped");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous callers take the terminal's querydr slot", async () => {
    const a = await pending();
    const b = await pending();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "network" });
    const results = await Promise.all([
      reconcilePendingPayment(a.txnRef, Date.now(), { skipWait: true }),
      reconcilePendingPayment(b.txnRef, Date.now(), { skipWait: true }),
    ]);
    expect(results.sort()).toEqual(["no_answer", "throttled"]);
    expect(queryVnpayTransaction).toHaveBeenCalledTimes(1);
  });

  it("after a 94 asks again in a minute, not in five", async () => {
    const a = await pending();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.mocked(queryVnpayTransaction).mockResolvedValueOnce({ ok: false, reason: "rate_limited" });
      expect(await reconcilePendingPayment(a.txnRef, Date.now(), { skipWait: true })).toBe("throttled");
      vi.advanceTimersByTime(61_000);
      vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: false, reason: "network" });
      expect(await reconcilePendingPayment(a.txnRef, Date.now(), { skipWait: true })).toBe("no_answer"); // asked again
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries Sapo from the ledger for an order left in 'processing' too", async () => {
    const { txnRef, amountVnd } = await pending();
    // A render killed mid-settle leaves Redis at 'processing'.
    const order = (await getOrder(txnRef))!;
    const { getOrderStore } = await import("./store");
    await getOrderStore().put({ ...order, status: "processing" });
    vi.mocked(ledgerPaidParams).mockResolvedValueOnce({
      vnp_TxnRef: txnRef,
      vnp_Amount: String(amountVnd * 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "15697481",
    });
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("settled");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
    expect((await getOrder(txnRef))?.status).toBe("completed");
  });

  it("does not mail 'paid, no order' about an order an IPN has since completed", async () => {
    const { txnRef, amountVnd } = await pending();
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    vi.mocked(sendAlert).mockClear();
    await alertUnsettledPaidReturn(txnRef);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("mails 'paid, no order' for a still-pending order and 'Sapo failed' for one Sapo refused", async () => {
    const a = await pending();
    await alertUnsettledPaidReturn(a.txnRef);
    expect(sendAlert).toHaveBeenCalledWith("paid_no_order", a.txnRef, expect.objectContaining({ amountVnd: a.amountVnd }));

    const b = await pending();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    await handleIpn(ipn(b.txnRef, b.amountVnd)); // paid, Sapo refused → sapo_error
    vi.mocked(sendAlert).mockClear();
    await alertUnsettledPaidReturn(b.txnRef);
    expect(sendAlert).toHaveBeenCalledWith("sapo_failed", b.txnRef, expect.anything());
    expect(sendAlert).not.toHaveBeenCalledWith("paid_no_order", b.txnRef, expect.anything());
  });

  it("wakes the sweep for half an hour after a checkout, and for two hours after a signed 'paid' return", async () => {
    const { getOrderStore } = await import("./store");
    expect(await getOrderStore().kvGet(SWEEP_ACTIVE_KEY)).toBeUndefined();
    const { txnRef } = await pending();
    expect(await getOrderStore().kvGet(SWEEP_ACTIVE_KEY)).toBe("1");
    await markPaidReturn(txnRef);
    expect(await getOrderStore().kvGet(SWEEP_ACTIVE_KEY)).toBe("1");
  });
});
