"use client";

import { useState, useTransition } from "react";
import { schemaFor, type LibraryField } from "@/modules/libraries";
import { btn } from "@/components/ui";
import type { RecordInput, Result } from "@/app/(platform)/watchtower/library-actions";

export type FormMode = "create" | "update" | "supersede";

const toInput = (f: LibraryField, v: unknown): string =>
  v === undefined || v === null ? "" : f.type === "list" && Array.isArray(v) ? v.join("\n") : String(v);

/** Form generated from the library's field schema. Used for add, correct and new-version. */
export function RecordForm({ libraryKey, mode, initial, onSubmit, onDone }: {
  libraryKey: string;
  mode: FormMode;
  initial?: { code: string | null; name: string; data: Record<string, unknown>; effective_from?: string; notes?: string | null };
  onSubmit: (input: RecordInput) => Promise<Result>;
  onDone: () => void;
}) {
  const schema = schemaFor(libraryKey);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result | null>(null);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const submit = (fd: FormData) => {
    const data: Record<string, unknown> = {};
    for (const f of schema.fields) data[f.key] = f.type === "boolean" ? fd.get(f.key) === "on" : String(fd.get(f.key) ?? "");
    const input: RecordInput = {
      code: String(fd.get("__code") ?? ""), name: String(fd.get("__name") ?? ""), effective_from: String(fd.get("__from") ?? ""),
      notes: String(fd.get("__notes") ?? ""), reason: String(fd.get("__reason") ?? ""), data,
    };
    start(async () => {
      const r = await onSubmit(input);
      setMsg(r);
      if (r.ok) onDone();
    });
  };

  return (
    <form action={submit} className="space-y-4">
      {mode === "update" && <p className="rounded-lg bg-info-soft px-3 py-2 text-xs">Use a <b>correction</b> for typos and clarifications. If a value genuinely changes from a date, create a <b>new version</b> instead so history stays accurate.</p>}
      {mode === "supersede" && <p className="rounded-lg bg-info-soft px-3 py-2 text-xs">The current version stays on record and ends the day before the new version starts. Anything dated before then keeps using it.</p>}
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        <label className="text-sm"><span className="label">{schema.codeLabel ?? "Code"}</span>
          <input name="__code" defaultValue={initial?.code ?? ""} disabled={mode !== "create"} className="input disabled:opacity-60" /></label>
        <label className="text-sm"><span className="label">{schema.nameLabel ?? "Name"} *</span>
          <input name="__name" required defaultValue={initial?.name ?? ""} className="input" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {schema.fields.map((f) => (
          <label key={f.key} className={`text-sm ${f.type === "textarea" || f.type === "list" ? "sm:col-span-2" : ""}`}>
            {f.type === "boolean" ? (
              <span className="flex items-center gap-2 pt-6"><input type="checkbox" name={f.key} defaultChecked={Boolean(initial?.data[f.key])} /> {f.label}</span>
            ) : (
              <>
                <span className="label">{f.label}{f.unit ? ` (${f.unit})` : ""}{f.required ? " *" : ""}</span>
                {f.type === "enum" ? (
                  <select name={f.key} defaultValue={toInput(f, initial?.data[f.key])} className="input">
                    <option value="">Choose…</option>
                    {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "textarea" || f.type === "list" ? (
                  <textarea name={f.key} rows={f.type === "list" ? 3 : 2} defaultValue={toInput(f, initial?.data[f.key])} className="input" />
                ) : (
                  <input name={f.key} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} step="any" defaultValue={toInput(f, initial?.data[f.key])} className="input" />
                )}
                {f.help && <span className="mt-1 block text-[0.7rem] text-muted">{f.help}</span>}
              </>
            )}
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode !== "update" && (
          <label className="text-sm"><span className="label">Effective from</span>
            <input type="date" name="__from" defaultValue={mode === "supersede" ? tomorrow : ""} className="input" /></label>
        )}
        <label className={`text-sm ${mode === "update" ? "sm:col-span-2" : ""}`}><span className="label">Notes</span>
          <input name="__notes" defaultValue={initial?.notes ?? ""} className="input" /></label>
        {mode !== "create" && (
          <label className="text-sm sm:col-span-2"><span className="label">{mode === "update" ? "Reason for the correction *" : "What changed and why *"}</span>
            <input name="__reason" required className="input" /></label>
        )}
      </div>
      {msg && !msg.ok && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{msg.message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={btn.secondary}>Cancel</button>
        <button disabled={pending} className={btn.primary}>{mode === "create" ? "Add" : mode === "update" ? "Save correction" : "Create new version"}</button>
      </div>
    </form>
  );
}
