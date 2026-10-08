"use client";

import { useActionState, useEffect, useRef } from "react";
import { clsx } from "clsx";
import { btn } from "@/components/ui";

export type FormResult = { ok?: boolean; error?: string; message?: string };
type Action = (prev: FormResult, fd: FormData) => Promise<FormResult>;

/**
 * A form wired to a server action, showing its result inline. Children are the inputs; hidden values go in `hidden`.
 * `confirm` asks before submitting (for decisions that can't be undone).
 */
export function ActionForm({
  action, submit, children, hidden, variant = "primary", className, confirm, resetOnOk, inline, id,
}: {
  id?: string;
  action: Action;
  submit: string;
  children?: React.ReactNode;
  hidden?: Record<string, string | number | null | undefined>;
  variant?: keyof typeof btn;
  className?: string;
  confirm?: string;
  resetOnOk?: boolean;
  inline?: boolean;
}) {
  const [state, run, pending] = useActionState<FormResult, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form
      id={id}
      ref={ref}
      action={run}
      className={clsx(inline ? "flex flex-wrap items-end gap-2" : "space-y-3", className)}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
      {children}
      <div className={clsx("flex flex-wrap items-center gap-2", inline && "pb-0.5")}>
        <button type="submit" disabled={pending} className={btn[variant]}>{pending ? "Saving…" : submit}</button>
        {state.error && <span className="text-sm text-bad" role="alert">{state.error}</span>}
        {state.ok && state.message && <span className="text-sm text-ok" role="status">{state.message}</span>}
      </div>
    </form>
  );
}

/** Labelled field wrapper. */
export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select({ name, options, defaultValue, blank, required, className }: {
  name: string; options: { value: string; label: string }[]; defaultValue?: string | null; blank?: string; required?: boolean; className?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} required={required} className={clsx("input", className)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
