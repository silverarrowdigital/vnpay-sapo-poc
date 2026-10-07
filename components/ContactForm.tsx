"use client";

import { useState } from "react";

type Fields = Partial<Record<"name" | "email" | "company" | "message", string>>;

/**
 * The B2B enquiry form from the design's contact page (T12.3): underlined fields, one button.
 * Only drawn by the page when the server has an inbox to send to (`CONTACT_EMAIL_TO`).
 */
const FIELD = "w-full rounded-none border-0 border-b border-current bg-transparent py-2.5 text-base text-ink outline-none focus-visible:border-primary";
const LABEL = "grid gap-2 text-[12px] leading-4 font-medium tracking-wider uppercase";
const ERR = "text-xs font-normal normal-case tracking-normal text-[color:var(--err)]";

export default function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    const data = new FormData(e.currentTarget);
    setState("sending");
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const body: { error?: string; fields?: Fields } = await res.json().catch(() => ({}));
      setFields(body.fields ?? {});
      setError(body.error ?? "Chưa gửi được tin nhắn. Vui lòng thử lại.");
    } catch {
      setError("Không kết nối được. Vui lòng thử lại.");
    }
    setState("idle");
  }

  if (state === "sent") {
    return (
      <p role="status" className="m-0 text-xl leading-[26px]">
        Cảm ơn bạn. The Hour đã nhận được tin nhắn và sẽ liên hệ trong thời gian sớm nhất.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <label className={LABEL}>
        Tên*
        <input name="name" autoComplete="name" required maxLength={100} className={FIELD} />
        {fields.name && <span className={ERR}>{fields.name}</span>}
      </label>
      <label className={LABEL}>
        Địa chỉ Email*
        <input name="email" type="email" autoComplete="email" required maxLength={254} className={FIELD} />
        {fields.email && <span className={ERR}>{fields.email}</span>}
      </label>
      <label className={LABEL}>
        Công ty
        <input name="company" autoComplete="organization" maxLength={100} className={FIELD} />
        {fields.company && <span className={ERR}>{fields.company}</span>}
      </label>
      <label className={LABEL}>
        Nội dung*
        <textarea name="message" required maxLength={3000} rows={5} className={`${FIELD} min-h-[120px] resize-y`} />
        {fields.message && <span className={ERR}>{fields.message}</span>}
      </label>
      {error && (
        <p role="alert" className="m-0 text-sm text-[color:var(--err)]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="inline-flex min-h-[52px] w-fit cursor-pointer items-center justify-center rounded-sm border-0 bg-primary px-6 py-4 text-sm leading-5 font-medium tracking-wide text-primary-fg uppercase disabled:cursor-progress disabled:opacity-60"
      >
        {state === "sending" ? "Đang gửi…" : "Send Message"}
      </button>
    </form>
  );
}
