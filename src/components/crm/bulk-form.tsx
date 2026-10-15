"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui";
import type { FormResult } from "@/components/sourcing/action-form";

type Action = (prev: FormResult, fd: FormData) => Promise<FormResult>;

/** A server-action form with an id, so inputs elsewhere on the page (form="<id>") can belong to it, e.g. ticked grid rows. */
export function BulkForm({ id, action, submit, children, variant = "secondary" }: { id: string; action: Action; submit: string; children?: React.ReactNode; variant?: keyof typeof btn }) {
  const [state, run, pending] = useActionState<FormResult, FormData>(action, {});
  return (
    <form id={id} action={run} className="inline-flex flex-wrap items-center gap-2">
      {children}
      <button type="submit" disabled={pending} className={btn[variant]}>{pending ? "Saving…" : submit}</button>
      {state.error && <span className="text-sm text-bad" role="alert">{state.error}</span>}
      {state.ok && state.message && <span className="text-sm text-ok" role="status">{state.message}</span>}
    </form>
  );
}
