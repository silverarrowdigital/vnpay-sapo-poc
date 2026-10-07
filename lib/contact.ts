/**
 * The contact form's server side (T12.3): validate what the browser sent, and send it to the shop's
 * inbox through Resend. Server-only.
 *
 * Unlike the order alerts, this mail **does carry personal data** — the sender's name, email and the
 * message are the whole point. So the data goes into the mail and nowhere else: not into a log line,
 * not into the store. `sendContactMessage` never throws and never logs a field's value.
 */
import { getContactConfig } from "./config";
import { errorMessage, log } from "./log";

export interface ContactInput {
  name: string;
  email: string;
  company: string;
  message: string;
}

export type ContactErrors = Partial<Record<keyof ContactInput, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = 10_000;

/** Trims, bounds and checks. Returns the clean input or the per-field errors, never both. */
export function validateContact(body: unknown): { ok: true; input: ContactInput } | { ok: false; errors: ContactErrors } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const input: ContactInput = { name: str("name"), email: str("email").toLowerCase(), company: str("company"), message: str("message") };

  const errors: ContactErrors = {};
  if (input.name === "" || input.name.length > 100) errors.name = "Vui lòng nhập tên (tối đa 100 ký tự)";
  if (!EMAIL_RE.test(input.email) || input.email.length > 254) errors.email = "Email không hợp lệ";
  if (input.company.length > 100) errors.company = "Tên công ty quá dài";
  if (input.message === "" || input.message.length > 3000) errors.message = "Vui lòng nhập nội dung (tối đa 3000 ký tự)";
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input };
}

/** A header-safe single line: the name goes into the subject, and a newline there would be an injection. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").slice(0, 100);
}

/** `true` when Resend accepted the mail. `false` for any failure or when the form is switched off. */
export async function sendContactMessage(input: ContactInput): Promise<boolean> {
  const cfg = getContactConfig();
  if (cfg === undefined) {
    log.warn("contact.not_configured", {});
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.from,
        to: [cfg.to],
        // The visitor's address is only a reply-to: it is never the sender, so the form cannot be
        // used to send mail "from" someone else.
        reply_to: input.email,
        subject: `[Liên hệ] ${oneLine(input.name)}${input.company ? ` — ${oneLine(input.company)}` : ""}`,
        text: [`Tên: ${input.name}`, `Email: ${input.email}`, input.company ? `Công ty: ${input.company}` : undefined, "", input.message]
          .filter((l): l is string => l !== undefined)
          .join("\n"),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.error("contact.send_failed", { status: res.status });
      return false;
    }
    log.info("contact.sent", {});
    return true;
  } catch (err) {
    log.error("contact.send_failed", { error: errorMessage(err) });
    return false;
  }
}
