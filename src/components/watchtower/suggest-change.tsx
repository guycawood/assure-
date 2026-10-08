"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { MSymbol } from "@/components/symbol";
import { btn } from "@/components/ui";
import { submitChangeRequest, type Result } from "@/app/(platform)/watchtower/library-actions";

/** "Suggest a change" (Base44 sidebar footer). Logs a change request against the module you're in. */
export function SuggestChange({ module, collapsed }: { module: string; collapsed: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button onClick={() => { setOpen(true); setMsg(null); }} title={collapsed ? "Suggest a change" : undefined}
        className={`flex w-full items-center gap-3 rounded-lg text-[0.84rem] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-fg ${collapsed ? "justify-center p-2" : "px-3 py-2"}`}>
        <MSymbol name="lightbulb" size={19} />{!collapsed && <span>Suggest a change</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Suggest a change" sub="Your suggestion goes to the module's Watchtower, where it's reviewed against the core principles.">
        {msg?.ok ? (
          <div className="space-y-3 text-sm"><p className="rounded-lg bg-ok-soft px-3 py-2 text-ok">{msg.message}</p><div className="flex justify-end"><button onClick={() => setOpen(false)} className={btn.primary}>Done</button></div></div>
        ) : (
          <form className="space-y-3 text-sm" action={() => start(async () => { const r = await submitChangeRequest({ module, sourceArea: path, text, category }); setMsg(r); if (r.ok) { setText(""); setCategory(""); } })}>
            <label className="block"><span className="label">What would you change, and why? *</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} required className="input" placeholder="e.g. Add recycled content % to the substrate list so buyers can compare options" /></label>
            <label className="block"><span className="label">Type (optional)</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                <option value="">Not sure</option><option value="data_integrity">Data integrity</option><option value="access_control">Access control</option>
                <option value="provenance">Provenance</option><option value="governance_ownership">Governance &amp; ownership</option><option value="user_experience">User experience</option>
              </select></label>
            <p className="text-xs text-muted">Logged from <code>{path}</code>.</p>
            {msg && !msg.ok && <p className="rounded-lg bg-bad-soft px-3 py-2 text-bad">{msg.message}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className={btn.secondary}>Cancel</button><button disabled={pending} className={btn.primary}>Submit</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}
