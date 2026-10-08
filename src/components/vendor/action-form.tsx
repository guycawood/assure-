"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";
import { Modal } from "@/components/modal";
import type { ActionResult } from "@/lib/vendor";

export type FormAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/**
 * A form wired to a server action, with a pending state and the result message. Extra submit buttons can carry
 * name="intent" values; React includes the clicked button in the form data.
 */
export function ActionForm({ action, submit, variant = "primary", className, children, hidden, disabled, resetOnOk, onDone, secondary }: {
  action: FormAction;
  submit?: string;
  variant?: keyof typeof btn;
  className?: string;
  children?: React.ReactNode;
  hidden?: Record<string, string>;
  disabled?: boolean;
  resetOnOk?: boolean;
  onDone?: () => void;
  secondary?: { label: string; intent: string; variant?: keyof typeof btn }[];
}) {
  const [state, run, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (resetOnOk) ref.current?.reset();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={run} className={className ?? "flex flex-col gap-3"}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {(submit || secondary) && (
        <div className="flex flex-wrap items-center gap-2">
          {submit && <button className={btn[variant]} disabled={pending || disabled} name="intent" value="primary">{pending ? "Working…" : submit}</button>}
          {secondary?.map((s) => (
            <button key={s.intent} className={btn[s.variant ?? "secondary"]} disabled={pending || disabled} name="intent" value={s.intent}>{s.label}</button>
          ))}
          {state.message && <p role="status" className={`text-sm ${state.ok ? "text-ok" : "text-bad"}`}>{state.message}</p>}
        </div>
      )}
      {!submit && !secondary && state.message && <p role="status" className={`text-sm ${state.ok ? "text-ok" : "text-bad"}`}>{state.message}</p>}
    </form>
  );
}

/** One-click action (accept, mark done, set default...). */
export function ActionButton({ action, label, hidden, variant = "secondary", disabled }: {
  action: FormAction; label: string; hidden: Record<string, string>; variant?: keyof typeof btn; disabled?: boolean;
}) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={btn[variant]} disabled={pending || disabled}>{pending ? "Working…" : label}</button>
      {state.message && !state.ok && <span className="text-xs text-bad">{state.message}</span>}
    </form>
  );
}

/** A button that opens a modal holding an ActionForm (decline with a reason, respond, add...). */
export function ActionDialog({ label, title, sub, variant = "secondary", wide, disabled, children, ...form }: {
  label: string; title: string; sub?: string; variant?: keyof typeof btn; wide?: boolean; disabled?: boolean; children: React.ReactNode;
} & Omit<Parameters<typeof ActionForm>[0], "children" | "onDone">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btn[variant]} onClick={() => setOpen(true)} disabled={disabled}>{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} sub={sub} wide={wide}>
        <ActionForm {...form} onDone={() => setOpen(false)}>{children}</ActionForm>
      </Modal>
    </>
  );
}
