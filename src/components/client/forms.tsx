"use client";

import { useActionState } from "react";
import { clsx } from "clsx";
import { btn } from "@/components/ui";

export type ClientFormResult = { ok?: boolean; error?: string; message?: string };
type Action = (prev: ClientFormResult, fd: FormData) => Promise<ClientFormResult>;

/** A form bound to a Client Portal server action returning { ok, error, message }. React resets the fields after a successful submit. */
export function ClientActionForm({ action, hidden, submit, variant = "primary", pendingLabel, children, className }: {
  action: Action; hidden?: Record<string, string>; submit: string; variant?: keyof typeof btn; pendingLabel?: string;
  children?: React.ReactNode; className?: string;
}) {
  const [state, run, pending] = useActionState<ClientFormResult, FormData>(action, {});
  return (
    <form action={run} className={clsx("space-y-3", className)}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={btn[variant]}>{pending ? pendingLabel ?? "Sending…" : submit}</button>
        {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
        {state.ok && state.message && <p className="text-sm text-ok" role="status">{state.message}</p>}
      </div>
    </form>
  );
}
