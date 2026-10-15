"use client";

import { useState } from "react";
import { btn } from "@/components/ui";
import { Modal } from "@/components/modal";
import { MSymbol } from "@/components/symbol";
import { ActionForm, type FormResult } from "@/components/sourcing/action-form";

/** "Duplicate for a repeat order" button: opens a dialog holding the fields, posts to the given server action. */
export function DuplicateDialog({ label, title, sub, action, hidden, submit, children }: {
  label: string; title: string; sub?: string; submit: string;
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  hidden: Record<string, string>; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)}><MSymbol name="content_copy" size={18} /> {label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} sub={sub}>
        <ActionForm action={action} hidden={hidden} submit={submit} pendingLabel="Duplicating…">{children}</ActionForm>
      </Modal>
    </>
  );
}
