/**
 * The money path, end to end inside lib/: what is charged, what is signed, and what the IPN does
 * with it. Sapo, the catalog and the address tables are mocked; VNPAY signing is real, so an IPN
 * here is checked exactly as a live one would be.
 *
 * The order store is the real in-memory one, wrapped so every put and get goes through JSON. The
 * bare Map keeps live object references, so code that mutated an order and forgot to `put` it would
 * pass here and lose the status on Redis — where a repeat IPN would then create a second Sapo order.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "./product";
import type { OrderStore } from "./store";
import { sign, type VnpParams } from "./vnpay";

vi.mock("./log", async (importOriginal) => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // The real one: what it cuts out of an error is part of what these tests check.
  errorMessage: (await importOriginal<typeof import("./log")>()).errorMessage,
}));
vi.mock("./catalog", () => ({ getVariantIndex: vi.fn() }));
vi.mock("./alert", () => ({ sendAlert: vi.fn(async () => true) }));
vi.mock("./querydr", () => ({ queryVnpayTransaction: vi.fn() }));
vi.mock("./ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ledger")>()),
  ledgerPaidParams: vi.fn(async () => undefined),
}));
// No database by default, which is every test above PR 6b's: the ledger is a no-op and the IPN takes
// the path it always took. The "PR 6b" block below hands the ledger an in-process Postgres.
vi.mock("./db/client", () => ({ getDb: vi.fn() }));
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
const { getDb } = await import("./db/client");
const { sapoErrorFields } = await import("./order");

describe("sapoErrorFields — what of a Sapo error may reach the log", () => {
  it("keeps the names of the rejected fields and none of their values", () => {
    const body = JSON.stringify({ errors: { source_name: ["cannot be set"], "customer.phone": ["0912345678 is invalid"] } });
    const out = sapoErrorFields(body);
    expect(out).toEqual(["source_name", "customer.phone"]);
    expect(JSON.stringify(out)).not.toContain("0912345678");
  });

  it("gives only a length for anything else, so an echoed order never reaches the log", () => {
    const echoed = JSON.stringify({ order: { customer: { first_name: "A", phone: "0912345678" } } });
    expect(sapoErrorFields(echoed)).toEqual({ bodyLength: echoed.length });
    expect(sapoErrorFields("<html>Bad gateway, Nguyen Van A</html>")).toEqual({ bodyLength: 38 });
    expect(sapoErrorFields(undefined)).toBeUndefined();
  });
});
const { CheckoutError, _resetStore, getOrder, alertUnsettledPaidReturn, handleIpn, lookupOrder, markPaidReturn, quoteTotals, reconcilePendingPayment, runSapoJob, startCheckoutOnce, startCheckout, validateCheckout } =
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

  it("answers 01 to a correctly signed notification about another terminal, and creates nothing", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    expect((await handleIpn(ipn(txnRef, amountVnd, { vnp_TmnCode: "OTHERTMN" }))).RspCode).toBe("01");
    // …and one that names no terminal at all, also signed with our secret.
    const noTerminal: VnpParams = { vnp_TxnRef: txnRef, vnp_Amount: String(amountVnd * 100), vnp_ResponseCode: "00", vnp_TransactionStatus: "00" };
    expect((await handleIpn({ ...noTerminal, vnp_SecureHash: sign(noTerminal, SECRET) })).RspCode).toBe("01");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect((await getOrder(txnRef))?.status).toBe("pending");
    // Never silent: a mistyped VNPAY_TMN_CODE would refuse every paid IPN, so a successful one is mailed.
    expect(sendAlert).toHaveBeenCalledWith("paid_no_order", txnRef, expect.objectContaining({ reason: expect.stringMatching(/OTHERTMN.*VNPAY_TMN_CODE/) }));
    // A failed payment for another terminal is not worth a mail.
    vi.mocked(sendAlert).mockClear();
    await handleIpn(ipn(txnRef, amountVnd, { vnp_TmnCode: "OTHERTMN", vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }));
    expect(sendAlert).not.toHaveBeenCalled();
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

  it("keeps a Redis error's embedded command — the customer's record — out of lastError and the log", async () => {
    const { txnRef, amountVnd } = await pendingOrder();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(
      new Error('ERR max requests limit exceeded, command was: [["set","order:x",{"customer":{"name":"Nguyen Van Test","phone":"0912345678"}}]]'),
    );
    await handleIpn(ipn(txnRef, amountVnd));
    const stored = await getOrder(txnRef);
    expect(stored?.lastError).toBe("ERR max requests limit exceeded (Redis command omitted)");
    const { log } = await import("./log");
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toMatch(/0912345678|Nguyen Van Test/);
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

const { PGlite } = await import("@electric-sql/pglite");
const { drizzle } = await import("drizzle-orm/pglite");
const { migrate } = await import("drizzle-orm/pglite/migrator");
const { eq } = await import("drizzle-orm");
const schema = await import("./db/schema");
const real = await vi.importActual<typeof import("./ledger")>("./ledger");
const { getOrderStore } = await import("./store");

describe("PR 6b — the IPN records the payment and its Sapo job in one transaction before it answers", () => {
  let client: InstanceType<typeof PGlite>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => client.close());
  beforeEach(() => {
    real._resetLedgerBreaker();
    vi.mocked(getDb).mockReturnValue(db as never);
    // The Sapo retry is built from what the ledger really recorded, not from a canned answer.
    vi.mocked(ledgerPaidParams).mockImplementation((ref) => real.ledgerPaidParams(ref));
  });

  async function paidCheckout(): Promise<{ txnRef: string; amountVnd: number }> {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4");
    return { txnRef: started.txnRef, amountVnd: 378_000 };
  }
  const jobsOf = (ref: string) => db.select().from(schema.outboxJobs).where(eq(schema.outboxJobs.dedupeKey, real.sapoJobKey(ref)));
  const attemptOf = async (ref: string) =>
    (await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.vnpTxnRef, ref)))[0];

  it("answers 00 for a paid order, with the payment recorded, one job, and the job done once Sapo has the order", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    expect(await handleIpn(ipn(txnRef, amountVnd))).toEqual({ RspCode: "00", Message: "Confirm Success" });
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(await attemptOf(txnRef)).toMatchObject({ status: "paid", vnpTransactionNo: "15696152" });
    const jobs = await jobsOf(txnRef);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe("done");
    expect((await getOrder(txnRef))?.status).toBe("completed");
  });

  it("answers 00 when Sapo fails after the commit, leaving the job to retry and waking the sweep (D1)", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    await getOrderStore().kvDelete(SWEEP_ACTIVE_KEY);
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    expect((await getOrder(txnRef))?.status).toBe("sapo_error");
    const [job] = await jobsOf(txnRef);
    expect(job).toMatchObject({ state: "pending", attempts: 1, lastError: "Sapo answered HTTP 503" });
    expect(sendAlert).toHaveBeenCalledWith("sapo_failed", txnRef, expect.objectContaining({ reason: "Sapo answered HTTP 503" }));
    expect(await getOrderStore().kvGet(SWEEP_ACTIVE_KEY)).toBe("1");
  });

  it("answers 02 to a replay of that IPN, adds no job, and finishes the order then", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    await handleIpn(ipn(txnRef, amountVnd));
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("02");
    expect(await jobsOf(txnRef)).toHaveLength(1);
    expect((await jobsOf(txnRef))[0].state).toBe("done");
    expect((await getOrder(txnRef))?.status).toBe("completed");
    expect(createOrderOnce).toHaveBeenCalledTimes(2);
  });

  it("answers 02, with one job and one Sapo order, when an earlier IPN committed and died before answering", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    // The earlier IPN: committed, then the server died — Redis never left 'pending'.
    expect(await real.ledgerCommitPaid((await getOrder(txnRef))!, ipn(txnRef, amountVnd))).toBe("committed");
    expect((await getOrder(txnRef))?.status).toBe("pending");
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("02");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(await jobsOf(txnRef)).toHaveLength(1);
    expect((await getOrder(txnRef))?.status).toBe("completed");
  });

  it("falls back to the old answers when the database is down: 00 if Sapo took the order, 99 if not (D3)", async () => {
    const down = {
      transaction: () => {
        throw new Error("connection refused");
      },
      insert: () => {
        throw new Error("connection refused");
      },
      update: () => {
        throw new Error("connection refused");
      },
      select: () => {
        throw new Error("connection refused");
      },
    };
    const a = await paidCheckout();
    const b = await paidCheckout();
    vi.mocked(getDb).mockReturnValue(down as never);
    expect((await handleIpn(ipn(a.txnRef, a.amountVnd))).RspCode).toBe("00");
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect((await handleIpn(ipn(b.txnRef, b.amountVnd))).RspCode).toBe("99");
    expect((await getOrder(b.txnRef))?.status).toBe("sapo_error");
  });

  it("opens no transaction for a forged signature, a wrong amount or an unknown reference", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    expect((await handleIpn({ ...ipn(txnRef, amountVnd), vnp_SecureHash: "a".repeat(128) })).RspCode).toBe("97");
    expect((await handleIpn(ipn(txnRef, amountVnd + 1))).RspCode).toBe("04");
    expect((await handleIpn(ipn("20200101000000000009", amountVnd))).RspCode).toBe("01");
    expect((await attemptOf(txnRef)).status).toBe("pending");
    expect(await jobsOf(txnRef)).toHaveLength(0);
    expect(await jobsOf("20200101000000000009")).toHaveLength(0);
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("queues no job for a cancelled payment", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    expect((await handleIpn(ipn(txnRef, amountVnd, { vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }))).RspCode).toBe("00");
    expect(await jobsOf(txnRef)).toHaveLength(0);
    expect((await attemptOf(txnRef)).status).toBe("cancelled");
  });

  it("lets only one of two simultaneous IPNs through, with one job and one Sapo order", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const answers = await Promise.all([handleIpn(ipn(txnRef, amountVnd)), handleIpn(ipn(txnRef, amountVnd))]);
    expect(answers.map((a) => a.RspCode).sort()).toEqual(["00", "99"]);
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(await jobsOf(txnRef)).toHaveLength(1);
  });

  it("answers 00 when Redis cannot be written after the commit, because the job already holds the payment", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const store = (await vi.importActual<typeof import("./store")>("./store")).getOrderStore();
    const put = store.put.bind(store);
    let writes = 0;
    const spy = vi.spyOn(store, "put").mockImplementation(async (o) => {
      writes += 1;
      if (writes === 1) throw new Error("redis down"); // the 'processing' write
      return put(o);
    });
    try {
      expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    } finally {
      spy.mockRestore();
    }
    expect(await jobsOf(txnRef)).toHaveLength(1);
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });

  it("queues the job through the querydr door too, which is the same settle", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: true as const, params: ipn(txnRef, amountVnd) });
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("settled");
    expect((await jobsOf(txnRef))[0]?.state).toBe("done");
  });

  it("does not call a reconcile 'settled' when the commit held but Sapo refused", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: true as const, params: ipn(txnRef, amountVnd) });
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("no_answer");
    expect((await jobsOf(txnRef))[0]?.state).toBe("pending");
  });

  it("runSapoJob finishes a waiting job from the ledger, without asking VNPAY", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    await handleIpn(ipn(txnRef, amountVnd));
    expect(await runSapoJob(txnRef)).toBe("done");
    expect(queryVnpayTransaction).not.toHaveBeenCalled();
    expect((await jobsOf(txnRef))[0]?.state).toBe("done");
    expect((await getOrder(txnRef))?.status).toBe("completed");
    expect(createOrderOnce).toHaveBeenCalledTimes(2);
  });

  it("runSapoJob counts a failed retry and gives up, with one alert, after the last attempt", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValue(new SapoApiError("down", 503));
    await handleIpn(ipn(txnRef, amountVnd)); // attempt 1
    for (let i = 1; i < real.SAPO_JOB_MAX_ATTEMPTS; i++) expect(await runSapoJob(txnRef)).toBe("retry");
    expect((await jobsOf(txnRef))[0]).toMatchObject({ state: "failed", attempts: real.SAPO_JOB_MAX_ATTEMPTS });
    // The give-up is its own alert kind, so the hourly limit on "sapo_failed" cannot swallow it.
    expect(sendAlert).toHaveBeenCalledWith("sapo_gave_up", txnRef, expect.objectContaining({ reason: expect.stringMatching(/gave up after 8/) }));
    expect(vi.mocked(sendAlert).mock.calls.filter((c) => c[0] === "sapo_gave_up")).toHaveLength(1);
    expect(vi.mocked(sendAlert).mock.calls.filter((c) => c[0] === "sapo_failed").every((c) => !/gave up/.test(c[2]?.reason ?? ""))).toBe(true);
  });

  it("runSapoJob counts a job the ledger has no usable paid record for, so it cannot hold the front of the queue for ever", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    // Paid, but VNPAY's answer carried no transaction number: ledgerPaidParams cannot rebuild the payment.
    const { vnp_TransactionNo: _no, ...withoutNumber } = ipn(txnRef, amountVnd);
    void _no;
    await real.ledgerCommitPaid((await getOrder(txnRef))!, withoutNumber);
    for (let i = 0; i < real.SAPO_JOB_MAX_ATTEMPTS; i++) expect(await runSapoJob(txnRef)).toBe("retry");
    expect((await jobsOf(txnRef))[0]).toMatchObject({ state: "failed", attempts: real.SAPO_JOB_MAX_ATTEMPTS });
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect(sendAlert).toHaveBeenCalledWith("sapo_gave_up", txnRef, expect.anything());
  });

  it("finishes the order exactly once when the commit lands after the timeout and the old path has already made the order", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    // The IPN's commit "timed out" (unavailable), so it took the old path and Sapo created the order...
    vi.mocked(getDb).mockReturnValue(undefined);
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("00");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    // ...and then the abandoned transaction committed after all, leaving a pending job behind.
    vi.mocked(getDb).mockReturnValue(db as never);
    real._resetLedgerBreaker();
    expect(await real.ledgerCommitPaid((await getOrder(txnRef))!, ipn(txnRef, amountVnd))).toBe("committed");
    expect(await runSapoJob(txnRef)).toBe("done");
    expect(createOrderOnce).toHaveBeenCalledTimes(1); // Redis says completed: no second Sapo call
    expect((await jobsOf(txnRef))[0]?.state).toBe("done");
  });

  it("answers 02 to an IPN for a payment whose job has already given up, and neither retries nor counts", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValue(new SapoApiError("down", 503));
    await handleIpn(ipn(txnRef, amountVnd));
    for (let i = 1; i < real.SAPO_JOB_MAX_ATTEMPTS; i++) await runSapoJob(txnRef);
    expect((await jobsOf(txnRef))[0].state).toBe("failed");
    const calls = vi.mocked(createOrderOnce).mock.calls.length;
    vi.mocked(createOrderOnce).mockResolvedValue({ order: { id: 1, name: "#1001" }, created: true });
    expect((await handleIpn(ipn(txnRef, amountVnd))).RspCode).toBe("02");
    expect(vi.mocked(createOrderOnce).mock.calls.length).toBe(calls + 1); // the replay may still finish it
    expect((await jobsOf(txnRef))[0]).toMatchObject({ attempts: real.SAPO_JOB_MAX_ATTEMPTS }); // not counted again
  });

  it("runSapoJob marks a job done when Redis says the order is already complete", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    await real.ledgerCommitPaid((await getOrder(txnRef))!, ipn(txnRef, amountVnd));
    await getOrderStore().put({ ...(await getOrder(txnRef))!, status: "completed" });
    expect(await runSapoJob(txnRef)).toBe("done");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect((await jobsOf(txnRef))[0]?.state).toBe("done");
  });

  it("runSapoJob does not create anything for a reference Redis no longer holds, and counts the attempt", async () => {
    const ref = "20200101000000000123";
    await real.ledgerCommitPaid(
      {
        txnRef: ref,
        createdAt: new Date().toISOString(),
        customer: { name: "A", phone: "0912345678", email: "a@example.com", address: "1" },
        lines: [],
        amountVnd: 1000,
        status: "pending",
      } as never,
      ipn(ref, 1000),
    );
    expect(await runSapoJob(ref)).toBe("retry");
    expect(createOrderOnce).not.toHaveBeenCalled();
    expect((await jobsOf(ref))[0]).toMatchObject({ state: "pending", attempts: 1 });
    expect(sendAlert).not.toHaveBeenCalledWith("paid_no_order", ref, expect.anything());
  });
});

describe("PR 6c — answer VNPAY once the payment is durable, create the Sapo order after", () => {
  let client: InstanceType<typeof PGlite>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => client.close());
  beforeEach(() => {
    real._resetLedgerBreaker();
    vi.mocked(getDb).mockReturnValue(db as never);
    vi.mocked(ledgerPaidParams).mockImplementation((ref) => real.ledgerPaidParams(ref));
  });

  async function paidCheckout(): Promise<{ txnRef: string; amountVnd: number }> {
    catalog(product(1001, 348_000, 68));
    const started = await startCheckout(input([{ variantId: 1001, quantity: 1 }]), "1.2.3.4");
    return { txnRef: started.txnRef, amountVnd: 378_000 };
  }
  const jobsOf = (ref: string) => db.select().from(schema.outboxJobs).where(eq(schema.outboxJobs.dedupeKey, real.sapoJobKey(ref)));
  /** What `after()` does: remember the work, run it only when the test says the answer has gone out. */
  function deferrer() {
    const queue: (() => Promise<void>)[] = [];
    return { defer: (work: () => Promise<void>) => void queue.push(work), run: async () => { for (const w of queue.splice(0)) await w(); }, queue };
  }

  it("answers 00 before Sapo is called, then creates exactly one order, finishes the job and frees the claim", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const d = deferrer();
    expect(await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer })).toEqual({ RspCode: "00", Message: "Confirm Success" });
    expect(createOrderOnce).not.toHaveBeenCalled(); // the answer has gone out; Sapo has not been asked
    expect(d.queue).toHaveLength(1);
    expect((await jobsOf(txnRef))[0].state).toBe("pending"); // durable, waiting
    expect(await getOrderStore().kvGet(SWEEP_ACTIVE_KEY)).toBe("1"); // so the sweep would find it if the work never ran

    await d.run();
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect((await jobsOf(txnRef))[0].state).toBe("done");
    expect((await getOrder(txnRef))?.status).toBe("completed");
    expect(await getOrderStore().claim(txnRef)).toBe(true); // released
  });

  it("holds the claim while the work is pending: a replay then gets 99, and 02 once it is done", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const d = deferrer();
    await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer });
    expect((await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer })).RspCode).toBe("99");
    expect(d.queue).toHaveLength(1); // the replay queued nothing
    await d.run();
    expect((await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer })).RspCode).toBe("02");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });

  it("when the deferred work never runs, the job is still there and the sweep's runner finishes the order once", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const d = deferrer();
    await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer });
    d.queue.length = 0; // the process died after answering
    await getOrderStore().release(txnRef); // …and its claim expired
    expect(await runSapoJob(txnRef)).toBe("done");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect((await jobsOf(txnRef))[0].state).toBe("done");
  });

  it("counts a Sapo failure in the deferred work on the job, mails the owner, frees the claim, and throws nothing", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    const d = deferrer();
    expect((await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer })).RspCode).toBe("00");
    await expect(d.run()).resolves.toBeUndefined();
    expect((await jobsOf(txnRef))[0]).toMatchObject({ state: "pending", attempts: 1 });
    expect(sendAlert).toHaveBeenCalledWith("sapo_failed", txnRef, expect.anything());
    expect(await getOrderStore().claim(txnRef)).toBe(true);
  });

  it("frees the claim and logs it even if the deferred work fails somewhere nothing inside it catches", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    // …so the Sapo catch block itself runs, and a ledger write inside it rejects (the ledger guards itself
    // and never does, but the wrapper must not depend on that).
    const ledger = await import("./ledger");
    const spy = vi.spyOn(ledger, "ledgerRecordSapo").mockRejectedValueOnce(new Error("ledger exploded"));
    const d = deferrer();
    expect((await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer })).RspCode).toBe("00");
    await expect(d.run()).resolves.toBeUndefined();
    spy.mockRestore();
    const { log } = await import("./log");
    expect(log.error).toHaveBeenCalledWith("ipn.deferred_failed", expect.objectContaining({ txnRef }));
    expect(await getOrderStore().claim(txnRef)).toBe(true);
  });

  it("falls back to creating the order inline, and frees the claim, when the defer function itself throws", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const broken = () => {
      throw new Error("after was called outside a request scope");
    };
    expect((await handleIpn(ipn(txnRef, amountVnd), { defer: broken })).RspCode).toBe("00");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect((await jobsOf(txnRef))[0].state).toBe("done");
    expect(await getOrderStore().claim(txnRef)).toBe(true);
    // and with Sapo down as well, the old answer: 00 is durable, so the job keeps the order
    const b = await paidCheckout();
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect((await handleIpn(ipn(b.txnRef, b.amountVnd), { defer: broken })).RspCode).toBe("00");
    expect((await jobsOf(b.txnRef))[0]).toMatchObject({ state: "pending", attempts: 1 });
    expect(await getOrderStore().claim(b.txnRef)).toBe(true);
  });

  it("answers 02 and still creates exactly one order when an earlier IPN committed and died (ledger paid, Redis processing)", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    expect(await real.ledgerCommitPaid((await getOrder(txnRef))!, ipn(txnRef, amountVnd))).toBe("committed");
    await getOrderStore().put({ ...(await getOrder(txnRef))!, status: "processing" });
    const d = deferrer();
    expect((await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer })).RspCode).toBe("02");
    expect(createOrderOnce).not.toHaveBeenCalled();
    await d.run();
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
    expect(await jobsOf(txnRef)).toHaveLength(1);
    expect((await getOrder(txnRef))?.status).toBe("completed");
  });

  it("stays synchronous when the ledger cannot confirm the payment: 00 only once Sapo has the order, 99 otherwise", async () => {
    const down = new Proxy({}, { get: () => () => { throw new Error("connection refused"); } });
    const a = await paidCheckout();
    const b = await paidCheckout();
    vi.mocked(getDb).mockReturnValue(down as never);
    const d = deferrer();
    expect((await handleIpn(ipn(a.txnRef, a.amountVnd), { defer: d.defer })).RspCode).toBe("00");
    expect(createOrderOnce).toHaveBeenCalledTimes(1); // it was NOT deferred
    vi.mocked(createOrderOnce).mockRejectedValueOnce(new SapoApiError("down", 503));
    expect((await handleIpn(ipn(b.txnRef, b.amountVnd), { defer: d.defer })).RspCode).toBe("99");
    expect(d.queue).toHaveLength(0);
  });

  it("defers nothing for a failed or cancelled payment, a wrong amount or a forged signature", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const d = deferrer();
    expect((await handleIpn({ ...ipn(txnRef, amountVnd), vnp_SecureHash: "a".repeat(128) }, { defer: d.defer })).RspCode).toBe("97");
    expect((await handleIpn(ipn(txnRef, amountVnd + 1), { defer: d.defer })).RspCode).toBe("04");
    expect((await handleIpn(ipn(txnRef, amountVnd, { vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }), { defer: d.defer })).RspCode).toBe("00");
    expect(d.queue).toHaveLength(0);
    expect(await getOrderStore().claim(txnRef)).toBe(true);
  });

  it("does not spend one of a job's attempts when it finds the claim held by work in progress", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    const d = deferrer();
    await handleIpn(ipn(txnRef, amountVnd), { defer: d.defer }); // claim now held by the pending work
    expect(await runSapoJob(txnRef)).toBe("retry");
    expect((await jobsOf(txnRef))[0]).toMatchObject({ state: "pending", attempts: 0 });
    expect(createOrderOnce).not.toHaveBeenCalled();
  });

  it("the querydr door creates the order inline, as before", async () => {
    const { txnRef, amountVnd } = await paidCheckout();
    vi.mocked(queryVnpayTransaction).mockResolvedValue({ ok: true as const, params: ipn(txnRef, amountVnd) });
    expect(await reconcilePendingPayment(txnRef, Date.now(), { skipWait: true })).toBe("settled");
    expect(createOrderOnce).toHaveBeenCalledTimes(1);
  });
});
