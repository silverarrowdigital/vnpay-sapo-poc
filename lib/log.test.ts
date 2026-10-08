import { describe, expect, it } from "vitest";
import { errorMessage } from "./log";

describe("errorMessage — what of an error may be logged or stored", () => {
  it("drops the command an Upstash Redis error carries, which can hold a whole customer record", () => {
    // The exact shape @upstash/redis 1.39 throws on a non-2xx answer (UpstashError).
    const err = new Error(
      'ERR max requests limit exceeded, command was: [["set","order:20261008120437G5B94VT5ZQQD6X6T",{"customer":{"name":"Nguyen Van A","phone":"0912345678","address":"1 Test"}}],["incr","rate:checkout:203.0.113.7"]]',
    );
    const out = errorMessage(err);
    expect(out).toBe("ERR max requests limit exceeded (Redis command omitted)");
    expect(out).not.toMatch(/Nguyen|0912345678|203\.0\.113\.7|order:/);
  });

  it("leaves every other message alone", () => {
    expect(errorMessage(new Error("Sapo POST /admin/orders.json failed with HTTP 503"))).toBe(
      "Sapo POST /admin/orders.json failed with HTTP 503",
    );
    expect(errorMessage("plain string")).toBe("plain string");
  });
});
