import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { sendAlert } = await import("./alert");
const { _resetStore } = await import("./store");
const { log } = await import("./log");

const fetchMock = vi.fn();
const REF = "20261006120921603450";

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ALERT_EMAIL_TO = "owner@example.invalid";
  delete process.env.ALERT_EMAIL_FROM;
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
    delete process.env[k];
  }
  _resetStore();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/** The JSON body of the n-th email handed to the provider. */
function sent(n = 0): { to: string[]; from: string; subject: string; text: string } {
  return JSON.parse(fetchMock.mock.calls[n][1].body);
}

describe("sendAlert", () => {
  it("emails the owner a reference, amount and next step, in the shape Resend's API takes", async () => {
    const ok = await sendAlert("sapo_failed", REF, {
      amountVnd: 378_000,
      vnpTransactionNo: "15696152",
      reason: "Sapo answered HTTP 503",
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const body = sent();
    expect(body.to).toEqual(["owner@example.invalid"]);
    expect(body.from).toBe("Order alerts <onboarding@resend.dev>");
    expect(body.subject).toContain(REF);
    expect(body.text).toContain("378.000");
    expect(body.text).toContain(`npm run querydr -- ${REF}`);
  });

  it("sends one mail per reference and kind however often VNPAY retries", async () => {
    expect(await sendAlert("sapo_failed", "20261006120921111111")).toBe(true);
    expect(await sendAlert("sapo_failed", "20261006120921111111")).toBe(false);
    expect(await sendAlert("sapo_failed", "20261006120921111111")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A different kind, or a different order, is a different problem.
    expect(await sendAlert("paid_no_order", "20261006120921111111")).toBe(true);
    expect(await sendAlert("sapo_failed", "20261006120921222222")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not count a failed send, so the next retry tries again instead of staying silent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    expect(await sendAlert("sapo_failed", REF)).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await sendAlert("sapo_failed", REF)).toBe(false);
    // Two failures within the hour, and no mail has been recorded as sent:
    expect(await sendAlert("sapo_failed", REF)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Only now is it counted.
    expect(await sendAlert("sapo_failed", REF)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends the give-up mail even when 'sapo_failed' for the same order already used the hour", async () => {
    expect(await sendAlert("sapo_failed", REF)).toBe(true);
    expect(await sendAlert("sapo_failed", REF)).toBe(false); // the hourly limit, working as intended
    expect(await sendAlert("sapo_gave_up", REF, { reason: "Sapo answered HTTP 503; gave up after 8 tries" })).toBe(true);
    const gaveUp = sent(1);
    expect(gaveUp.subject).toContain("CẦN TẠO ĐƠN THỦ CÔNG");
    // A hand-made order must carry the tag, or a replay / page reload can make a second one.
    expect(gaveUp.text).toContain(`GẮN TAG vnpay-${REF}`);
    // It must not tell the owner to wait for a VNPAY retry that will not come.
    expect(gaveUp.text).not.toContain("tối đa 10 lần) và hệ thống tự thử lại");
    expect(gaveUp.text).toContain("KHÔNG còn tự thử lại");
  });

  it("tells the truth about who retries in the ordinary Sapo-failure mail", async () => {
    await sendAlert("sapo_failed", REF);
    expect(sent(0).text).toContain("job nền");
    expect(sent(0).text).toContain(`tag vnpay-${REF}`);
  });

  it("gives each kind the next steps that are true for it", async () => {
    await sendAlert("sapo_failed", REF);
    await sendAlert("paid_no_order", REF);
    await sendAlert("amount_mismatch", REF);
    const [sapo, noOrder, mismatch] = [0, 1, 2].map((i) => sent(i).text);
    // Every kind starts by checking whether the order already exists, which is what prevents a
    // refund of an order that is fine (a signed callback can be replayed).
    for (const t of [sapo, noOrder, mismatch]) expect(t).toContain(`vnpay-${REF}`);
    // replay-ipn only helps when an order is stored, i.e. only for a Sapo failure.
    expect(sapo).toContain("npm run replay-ipn");
    for (const t of [noOrder, mismatch]) {
      expect(t).toContain("Không dùng npm run replay-ipn với bản chính");
      // the querydr hint that would lead to a self-signed "paid" order is called out
      expect(t).toContain("KHÔNG sửa số tiền");
      // a manual order must carry the tag that step 1 and the refund script look for
      expect(t).toContain(`gắn tag vnpay-${REF}`);
      // refunding through the portal is not something this repo has exercised
      expect(t).toContain("chưa kiểm chứng");
    }
  });

  it("still reports a successful send when recording it fails, and still sends when the check fails", async () => {
    const store = (await import("./store")).getOrderStore();
    const hit = vi.spyOn(store, "hit").mockRejectedValueOnce(new Error("redis down"));
    await expect(sendAlert("sapo_failed", REF)).resolves.toBe(true);
    hit.mockRestore();
    const count = vi.spyOn(store, "count").mockRejectedValueOnce(new Error("redis down"));
    await expect(sendAlert("paid_no_order", REF)).resolves.toBe(true);
    count.mockRestore();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("puts no customer data in the mail", async () => {
    // The only inputs the call sites can pass are a reference, an amount, a VNPAY number and a short
    // reason; the template adds nothing of its own. Assert on the rendered text of every kind.
    for (const kind of ["sapo_failed", "paid_no_order", "amount_mismatch"] as const) {
      await sendAlert(kind, `9${kind.length}${REF}`, { amountVnd: 1, vnpTransactionNo: "1", reason: "x" });
    }
    for (let i = 0; i < 3; i++) expect(sent(i).text).not.toMatch(/@|điện thoại|địa chỉ giao|phone/i);
  });

  it("replaces a malformed reference instead of putting it in the subject or the store key", async () => {
    await sendAlert("paid_no_order", "evil\r\nBcc: x@y.invalid");
    const body = sent();
    expect(body.subject).not.toMatch(/Bcc|\r|\n/);
    expect(body.text).not.toContain("Bcc");
  });

  it("does nothing but log when alerts are not configured", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendAlert("sapo_failed", "20261006120921333333", { amountVnd: 1 })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith("alert.not_configured", expect.objectContaining({ txnRef: "20261006120921333333" }));
  });

  it("never throws: a provider error, a network failure and a timeout all resolve to false", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 422 }));
    await expect(sendAlert("sapo_failed", "444441")).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(sendAlert("sapo_failed", "444442")).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(sendAlert("sapo_failed", "444443")).resolves.toBe(false);
  });

  it("keeps the provider's response body out of the log", async () => {
    fetchMock.mockResolvedValueOnce(new Response("owner@example.invalid is not allowed", { status: 403 }));
    await sendAlert("sapo_failed", "555555");
    const logged = JSON.stringify(vi.mocked(log.error).mock.calls);
    expect(logged).toContain("alert.send_failed");
    expect(logged).not.toContain("owner@example.invalid");
  });
});
