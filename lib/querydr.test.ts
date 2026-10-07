import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { buildQueryDrBody, queryDrToIpnParams, queryVnpayTransaction, verifyQueryDrResponse } = await import("./querydr");

const SECRET = "TESTSECRETTESTSECRETTESTSECRET12";
const CFG = { tmnCode: "TESTTMN1", hashSecret: SECRET };
const REF = "202610071347414AXQWTQRGWTVZKZH";
const NOW = new Date("2026-10-07T06:48:30Z"); // 13:48:30 in GMT+7

const hmac = (data: string) => createHmac("sha512", SECRET).update(data).digest("hex");

/** A response as VNPAY builds it: fifteen values joined with "|", an absent one empty. */
function signedResponse(over: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    vnp_ResponseId: "abc123",
    vnp_Command: "querydr",
    vnp_ResponseCode: "00",
    vnp_Message: "QueryDR success",
    vnp_TmnCode: "TESTTMN1",
    vnp_TxnRef: REF,
    vnp_Amount: "74400000",
    vnp_BankCode: "NCB",
    vnp_PayDate: "20261007134756",
    vnp_TransactionNo: "15697488",
    vnp_TransactionType: "01",
    vnp_TransactionStatus: "00",
    vnp_OrderInfo: `Thanh toan don hang ${REF}`,
    ...over,
  };
  const order = ["vnp_ResponseId", "vnp_Command", "vnp_ResponseCode", "vnp_Message", "vnp_TmnCode", "vnp_TxnRef", "vnp_Amount", "vnp_BankCode", "vnp_PayDate", "vnp_TransactionNo", "vnp_TransactionType", "vnp_TransactionStatus", "vnp_OrderInfo", "vnp_PromotionCode", "vnp_PromotionAmount"];
  return { ...base, vnp_SecureHash: hmac(order.map((k) => base[k] ?? "").join("|")) };
}

describe("buildQueryDrBody", () => {
  it("signs the nine values in the documented order, joined with |", () => {
    const body = buildQueryDrBody(CFG, REF, NOW, "20261007134830000001");
    const expected = hmac(
      ["20261007134830000001", "2.1.0", "querydr", "TESTTMN1", REF, "20261007134741", "20261007134830", "127.0.0.1", `Truy van giao dich ${REF}`].join("|"),
    );
    expect(body.vnp_SecureHash).toBe(expected);
    expect(body.vnp_TransactionDate).toBe("20261007134741");
    expect(body.vnp_CreateDate).toBe("20261007134830");
  });

  it("changes the checksum when the reference changes by one character", () => {
    const a = buildQueryDrBody(CFG, REF, NOW, "1");
    const b = buildQueryDrBody(CFG, REF.slice(0, -1) + "Y", NOW, "1");
    expect(a.vnp_SecureHash).not.toBe(b.vnp_SecureHash);
  });
});

describe("verifyQueryDrResponse", () => {
  it("accepts a genuine answer, with absent promotion fields counted as empty", () => {
    expect(verifyQueryDrResponse(signedResponse(), SECRET)).toBe(true);
  });

  it("rejects one changed field, a wrong secret and a missing checksum", () => {
    const good = signedResponse();
    expect(verifyQueryDrResponse({ ...good, vnp_Amount: "74400100" }, SECRET)).toBe(false);
    expect(verifyQueryDrResponse({ ...good, vnp_TransactionStatus: "02" }, SECRET)).toBe(false);
    expect(verifyQueryDrResponse(good, "another-secret-another-secret-12345")).toBe(false);
    const { vnp_SecureHash: _drop, ...unsigned } = good;
    void _drop;
    expect(verifyQueryDrResponse(unsigned, SECRET)).toBe(false);
  });
});

describe("queryDrToIpnParams", () => {
  it("keeps only what settlement reads", () => {
    const p = queryDrToIpnParams(signedResponse());
    expect(p).toMatchObject({ vnp_TxnRef: REF, vnp_Amount: "74400000", vnp_ResponseCode: "00", vnp_TransactionStatus: "00", vnp_TmnCode: "TESTTMN1" });
    expect(p).not.toHaveProperty("vnp_SecureHash");
    expect(p).not.toHaveProperty("vnp_OrderInfo");
  });
});

describe("queryVnpayTransaction", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.VNPAY_TMN_CODE = "TESTTMN1";
    process.env.VNPAY_HASH_SECRET = SECRET;
    process.env.APP_BASE_URL = "https://shop.test";
    delete process.env.VNPAY_PAYMENT_URL;
    delete process.env.VNPAY_QUERYDR_URL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const reply = (json: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify(json), { status: 200 }));

  it("returns the parameters of a verified answer about our terminal and reference", async () => {
    reply(signedResponse());
    const r = await queryVnpayTransaction(REF);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.vnp_TransactionStatus).toBe("00");
  });

  it("refuses an answer whose checksum does not verify", async () => {
    reply({ ...signedResponse(), vnp_Amount: "100" });
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "bad_checksum" });
  });

  it("refuses a validly signed answer about another reference or terminal", async () => {
    reply(signedResponse({ vnp_TxnRef: "202610071347414AXQWTQRGWTVZKZZ" }));
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "bad_response" });
    reply(signedResponse({ vnp_TmnCode: "OTHERTMN" }));
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "bad_response" });
  });

  it("refuses a validly signed answer about a refund rather than a payment", async () => {
    reply(signedResponse({ vnp_TransactionType: "02" }));
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "not_found_or_error" });
  });

  it("treats 'no such transaction' and a network failure as no answer", async () => {
    reply({ vnp_ResponseCode: "91", vnp_Message: "not found" });
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "not_found_or_error" });
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "network" });
  });

  it("does not ask the sandbox about a production payment URL", async () => {
    process.env.VNPAY_PAYMENT_URL = "https://pay.vnpay.vn/vpcpay.html";
    expect(await queryVnpayTransaction(REF)).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
