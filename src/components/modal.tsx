"use client";

import { useEffect, useRef } from "react";
import { MSymbol } from "@/components/symbol";

/** Accessible dialog built on <dialog>: Esc and the close button dismiss it. */
export function Modal({ open, onClose, title, sub, wide, children }: { open: boolean; onClose: () => void; title: string; sub?: string; wide?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-raised backdrop:bg-brand-navy/30 backdrop:backdrop-blur-[2px] ${wide ? "max-w-3xl" : "max-w-xl"}`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-bold">{title}</h2>
              {sub && <p className="text-xs text-muted">{sub}</p>}
            </div>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Close"><MSymbol name="close" size={18} /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
