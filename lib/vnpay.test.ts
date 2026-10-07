import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VnpayConfig } from "./config";
import {
  buildSignData,
  createPaymentUrl,
  createTxnRef,
  normaliseTxnRef,
  TXN_REF_PATTERN,
  formatVnpDate,
  isPaymentSuccess,
  normaliseIp,
  sign,
  verifySignature,
} from "./vnpay";

const SECRET = "TESTSECRETTESTSECRETTESTSECRET12";
const CONFIG: VnpayConfig = {
  tmnCode: "TESTTMN1",
  hashSecret: SECRET,
  paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  returnUrl: "https://shop.test/api/vnpay/return",
};

function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe("formatVnpDate", () => {
  it("writes GMT+7 whatever the server's timezone", () => {
    // 05:09:21 UTC is 12:09:21 in Vietnam — the reference of the real sandbox payment on 2026-10-06.
    expect(formatVnpDate(new Date("2026-10-06T05:09:21Z"))).toBe("20261006120921");
  });

  it("rolls the date over at 17:00 UTC", () => {
    expect(formatVnpDate(new Date("2026-12-31T17:30:00Z"))).toBe("20270101003000");
  });
});

describe("createTxnRef", () => {
  it("is the GMT+7 timestamp followed by 16 random symbols", () => {
    const now = new Date("2026-10-06T05:09:21Z");
    const ref = createTxnRef(now);
    expect(ref).toMatch(/^20261006120921[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(ref).toHaveLength(30); // VNPAY allows 100
    expect(TXN_REF_PATTERN.test(ref)).toBe(true);
  });

  it("does not repeat across 10,000 draws in the same second", () => {
    const now = new Date("2026-10-06T05:09:21Z");
    const seen = new Set(Array.from({ length: 10_000 }, () => createTxnRef(now)));
    expect(seen.size).toBe(10_000);
  });

  it("still recognises the old 20-digit references, and folds a typed one to upper case", () => {
    expect(TXN_REF_PATTERN.test("20261006120921603450")).toBe(true);
    expect(normaliseTxnRef("  20261006120921abcd1234efgh5678 ")).toBe("20261006120921ABCD1234EFGH5678");
    expect(TXN_REF_PATTERN.test(normaliseTxnRef("abc 123"))).toBe(false);
    expect(TXN_REF_PATTERN.test("12345")).toBe(false);
  });
});

describe("createPaymentUrl", () => {
  const createdAt = new Date("2026-10-06T05:09:21Z");
  const url = createPaymentUrl(CONFIG, {
    txnRef: "20261006120921603450",
    amountVnd: 378_000,
    orderInfo: "Thanh toán đơn hàng 20261006120921603450",
    ipAddr: "203.0.113.7",
    createdAt,
  });
  const p = paramsOf(url);

  it("sends the amount in VND × 100, as an integer string", () => {
    expect(p.vnp_Amount).toBe("37800000");
  });

  it("expires 15 minutes after creation, both in GMT+7", () => {
    expect(p.vnp_CreateDate).toBe("20261006120921");
    expect(p.vnp_ExpireDate).toBe("20261006122421");
  });

  it("sends only letters, digits and spaces in the order info, as the docs require", () => {
    expect(p.vnp_OrderInfo).toMatch(/^[A-Za-z0-9 ]+$/);
    expect(p.vnp_OrderInfo).toContain("20261006120921603450");
  });

  it("produces a signature our own verifier accepts", () => {
    expect(verifySignature(p, SECRET)).toBe(true);
  });

  it("rejects the URL once the amount is changed by one đồng", () => {
    expect(verifySignature({ ...p, vnp_Amount: "37800100" }, SECRET)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifySignature(p, "SOMEONEELSESSECRETSOMEONEELSES12")).toBe(false);
  });
});

describe("sign — known answer", () => {
  // Pinned against an independently written string and Node's own HMAC, not against `sign` itself:
  // a switch to SHA-256, or a change in how the return URL is encoded, must fail here even though
  // every round-trip test (sign, then verify with the same code) would still pass.
  it("is HMAC-SHA512 over sorted key=value pairs, PHP-urlencoded", () => {
    const params = {
      vnp_ReturnUrl: "https://shop.test/api/vnpay/return",
      vnp_Amount: "37800000",
      vnp_OrderInfo: "Thanh toan don hang 1",
    };
    const literal =
      "vnp_Amount=37800000&vnp_OrderInfo=Thanh+toan+don+hang+1&vnp_ReturnUrl=https%3A%2F%2Fshop.test%2Fapi%2Fvnpay%2Freturn";
    expect(buildSignData(params)).toBe(literal);
    expect(sign(params, SECRET)).toBe(createHmac("sha512", SECRET).update(literal, "utf8").digest("hex"));
  });
});

describe("buildSignData", () => {
  it("sorts keys, skips the hash fields and empty values, encodes spaces as +", () => {
    expect(
      buildSignData({
        vnp_TxnRef: "1",
        vnp_Amount: "100",
        vnp_OrderInfo: "a b",
        vnp_Empty: "",
        vnp_SecureHash: "x",
        vnp_SecureHashType: "y",
      }),
    ).toBe("vnp_Amount=100&vnp_OrderInfo=a+b&vnp_TxnRef=1");
  });
});

describe("verifySignature", () => {
  it("refuses a missing or malformed hash without throwing", () => {
    expect(verifySignature({ vnp_Amount: "100" }, SECRET)).toBe(false);
    expect(verifySignature({ vnp_Amount: "100", vnp_SecureHash: "deadbeef" }, SECRET)).toBe(false);
  });

  it("accepts an upper-case hash", () => {
    const params = { vnp_Amount: "100", vnp_TxnRef: "1" };
    expect(verifySignature({ ...params, vnp_SecureHash: sign(params, SECRET).toUpperCase() }, SECRET)).toBe(true);
  });
});

describe("isPaymentSuccess", () => {
  it("needs both the response code and the transaction status to be 00", () => {
    expect(isPaymentSuccess({ vnp_ResponseCode: "00", vnp_TransactionStatus: "00" })).toBe(true);
    expect(isPaymentSuccess({ vnp_ResponseCode: "00", vnp_TransactionStatus: "01" })).toBe(false);
    expect(isPaymentSuccess({ vnp_ResponseCode: "24", vnp_TransactionStatus: "00" })).toBe(false);
    expect(isPaymentSuccess({ vnp_ResponseCode: "00" })).toBe(false);
  });
});

describe("normaliseIp", () => {
  it("takes the first forwarded address and unwraps IPv4-mapped IPv6", () => {
    expect(normaliseIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(normaliseIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("falls back to 127.0.0.1 when there is nothing usable", () => {
    expect(normaliseIp(null)).toBe("127.0.0.1");
    expect(normaliseIp("")).toBe("127.0.0.1");
  });
});
