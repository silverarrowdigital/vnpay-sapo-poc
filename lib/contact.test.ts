import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const { sendContactMessage, validateContact } = await import("./contact");
const { log } = await import("./log");

const GOOD = { name: " Nguyen Van A ", email: "A@Example.com", company: "", message: "Xin chào" };

describe("validateContact", () => {
  it("trims, lower-cases the email and accepts a complete message", () => {
    const r = validateContact(GOOD);
    expect(r).toEqual({ ok: true, input: { name: "Nguyen Van A", email: "a@example.com", company: "", message: "Xin chào" } });
  });

  it("names every field that is wrong", () => {
    const r = validateContact({ name: "", email: "nope", company: "x".repeat(101), message: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["company", "email", "message", "name"]);
  });

  it("bounds the message and ignores non-string values", () => {
    expect(validateContact({ ...GOOD, message: "x".repeat(3001) }).ok).toBe(false);
    expect(validateContact({ ...GOOD, name: 5 }).ok).toBe(false);
    expect(validateContact(null).ok).toBe(false);
  });
});

describe("sendContactMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.CONTACT_EMAIL_TO = "owner@shop.test";
    delete process.env.ALERT_EMAIL_FROM;
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.CONTACT_EMAIL_TO;
  });

  it("sends to the shop's inbox with the visitor only as reply-to", async () => {
    expect(await sendContactMessage({ name: "A", email: "a@example.com", company: "Công ty B", message: "Hi" })).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(["owner@shop.test"]);
    expect(body.reply_to).toBe("a@example.com");
    expect(body.from).not.toContain("a@example.com");
    expect(body.text).toContain("Hi");
  });

  it("cannot be used to inject a header line through the name", async () => {
    await sendContactMessage({ name: "A\r\nBcc: x@evil.test", email: "a@example.com", company: "", message: "Hi" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.subject).not.toMatch(/[\r\n]/);
  });

  it("does nothing, and says so, when no inbox is configured", async () => {
    delete process.env.CONTACT_EMAIL_TO;
    expect(await sendContactMessage({ name: "A", email: "a@example.com", company: "", message: "Hi" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith("contact.not_configured", {});
  });

  it("returns false on a Resend error and logs no personal data", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 422 }));
    expect(await sendContactMessage({ name: "Secret Name", email: "secret@example.com", company: "", message: "private text" })).toBe(false);
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toMatch(/Secret|secret@|private/);
  });
});
