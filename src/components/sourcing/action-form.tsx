"use client";

import { useActionState } from "react";
import { clsx } from "clsx";
import { btn } from "@/components/ui";

export type FormResult = { ok?: boolean; error?: string; message?: string };
type Action = (prev: FormResult, fd: FormData) => Promise<FormResult>;

/**
 * A form bound to a server action that returns { ok, error, message }. Hidden fields carry record ids,
 * so one component serves every Sourcing+, RFQ+ and Order Management+ action.
 */
export function ActionForm({
  action, hidden, submit, variant = "primary", pendingLabel, className, children, confirm, inline,
}: {
  action: Action; hidden?: Record<string, string | number | null | undefined>; submit: string; variant?: keyof typeof btn;
  pendingLabel?: string; className?: string; children?: React.ReactNode; confirm?: string; inline?: boolean;
}) {
  const [state, run, pending] = useActionState<FormResult, FormData>(action, {});
  return (
    <form
      action={run}
      className={clsx(inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-3", className)}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={String(v)} />)}
      {children}
      <div className={clsx("flex flex-wrap items-center gap-2", inline && "contents")}>
        <button type="submit" disabled={pending} className={btn[variant]}>{pending ? pendingLabel ?? "Saving…" : submit}</button>
        {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
        {state.ok && state.message && <p className="text-sm text-ok" role="status">{state.message}</p>}
      </div>
    </form>
  );
}

/** Label + control wrapper used in Sourcing+ forms. */
export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
