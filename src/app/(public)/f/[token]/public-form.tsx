"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import type { FormField } from "@/lib/crm";
import { submitForm } from "../../actions";

export function PublicForm({ token, fields, consentText }: { token: string; fields: FormField[]; consentText: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <p className="text-sm font-semibold text-ok" role="status">Thank you. We have your details.</p>;
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const data: Record<string, string> = {};
      for (const f of fields) {
        const v = fd.get(f.key);
        if (f.type === "checkbox") data[f.key] = v ? "true" : "";
        else if (typeof v === "string") data[f.key] = v;
      }
      if (fd.get("consent")) data.consent = "true";
      start(async () => {
        const res = await submitForm(token, data, String(fd.get("website") ?? ""));
        if (res.error) setError(res.error); else setDone(true);
      });
    }}>
      {fields.map((f) => (
        <label key={f.key} className={f.type === "checkbox" ? "flex items-center gap-2 text-sm" : "block"}>
          {f.type === "checkbox" ? <><input type="checkbox" name={f.key} required={f.required} /> {f.label}{f.required ? " *" : ""}</> : <>
            <span className="label">{f.label}{f.required ? " *" : ""}</span>
            {f.type === "textarea" ? <textarea name={f.key} required={f.required} maxLength={2000} rows={3} className="input" />
              : f.type === "select" ? (
                <select name={f.key} required={f.required} className="input" defaultValue=""><option value="" disabled={f.required}>Choose…</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
              ) : <input name={f.key} type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"} required={f.required} maxLength={300} className="input" />}
          </>}
        </label>
      ))}
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {consentText && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" className="mt-1" /> {consentText}</label>}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Sending…" : "Send"}</button>
    </form>
  );
}
