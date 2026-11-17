"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { SAMPLE_STATUS, type BriefSample } from "@/lib/creative-rfi";
import { receiveSample, requestSample, reviewSample, setSamplesNeeded, type ActionResult } from "../actions";

// Samples (GBT creative work): cr16 samples needed? and cr18 the product sampling process with a supplier.

type Option = { id: string; name: string; detail: string };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export function SamplesPanel({ id, needed, decidedNote, open, samples, suppliers }: {
  id: string; needed: boolean | null; decidedNote: string | null; open: boolean; samples: BriefSample[]; suppliers: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [note, setNote] = useState("");
  const [supplier, setSupplier] = useState("");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [by, setBy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });
  const setN = (k: string, v: string) => setNotes((n) => ({ ...n, [k]: v }));

  return (
    <Panel title="Samples" sub="Are samples needed? If so, ask a supplier for one, confirm it arrived and approve it or ask for changes."
      actions={needed === null ? <Pill tone="warn">Not decided</Pill> : <Pill tone={needed ? "info" : "neutral"}>{needed ? "Samples needed" : "No samples needed"}</Pill>}>
      <div className="space-y-4 p-5 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="samples-note">Samples needed? {needed !== null && decidedNote && <span className="font-normal text-muted">Last note: {decidedNote}</span>}</label>
            <input id="samples-note" className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} disabled={!open} />
          </div>
          {open && (
            <>
              <button className={needed === true ? btn.primary : btn.secondary} disabled={pending} onClick={() => run(() => setSamplesNeeded(id, true, note))}>Yes, samples needed</button>
              <button className={needed === false ? btn.primary : btn.secondary} disabled={pending} onClick={() => run(() => setSamplesNeeded(id, false, note))}>No samples needed</button>
            </>
          )}
        </div>

        {samples.length > 0 && (
          <ul className="space-y-2">
            {samples.map((s) => {
              const st = SAMPLE_STATUS[s.status];
              return (
                <li key={s.id} className="space-y-1.5 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2"><b>{s.supplier_name}</b> <Pill tone={st.tone}>{st.label}</Pill>
                    <span className="text-xs text-muted">{s.quantity} piece{s.quantity === 1 ? "" : "s"} · round {s.round}{s.needed_by ? ` · needed by ${when(s.needed_by)}` : ""}</span></div>
                  <p>{s.description}</p>
                  {s.tracking_number && <p className="text-xs text-muted">{s.carrier ? `${s.carrier} · ` : ""}Tracking {s.tracking_number}{s.shipped_at ? ` · sent ${when(s.shipped_at)}` : ""}{s.supplier_note ? ` · ${s.supplier_note}` : ""}</p>}
                  {s.review_note && s.status !== "received" && <p className="text-xs"><span className="text-muted">Review:</span> {s.review_note}</p>}
                  {open && s.status === "shipped" && (
                    <div className="flex flex-wrap items-end gap-2 pt-1">
                      <input aria-label="Arrival note" className="input min-w-48 flex-1" placeholder="Condition on arrival (optional)" value={notes[s.id] ?? ""} onChange={(e) => setN(s.id, e.target.value)} />
                      <button className={btn.primary} disabled={pending} onClick={() => run(() => receiveSample(id, s.id, notes[s.id] ?? ""))}><MSymbol name="inventory" size={16} /> It has arrived</button>
                    </div>
                  )}
                  {open && s.status === "received" && (
                    <div className="flex flex-wrap items-end gap-2 pt-1">
                      <input aria-label="Review note" className="input min-w-48 flex-1" placeholder="Review note (needed to ask for changes)" value={notes[s.id] ?? ""} onChange={(e) => setN(s.id, e.target.value)} />
                      <button className={btn.primary} disabled={pending} onClick={() => run(() => reviewSample(id, s.id, true, notes[s.id] ?? ""))}><MSymbol name="check_circle" size={16} /> Approve</button>
                      <button className={btn.secondary} disabled={pending || (notes[s.id] ?? "").trim().length < 3} onClick={() => run(() => reviewSample(id, s.id, false, notes[s.id] ?? ""))}>Ask for changes</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {needed === true && open && (
          <details open={samples.length === 0}>
            <summary className="cursor-pointer font-semibold text-accent">Ask a supplier for a sample</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><label className="label" htmlFor="smp-sup">Supplier</label>
                <select id="smp-sup" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                  <option value="">Choose</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.detail ? ` · ${s.detail}` : ""}</option>)}
                </select></div>
              <div><label className="label" htmlFor="smp-qty">Pieces</label><input id="smp-qty" type="number" min={1} max={100} className="input" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div><label className="label" htmlFor="smp-by">Needed by</label><input id="smp-by" type="date" className="input" value={by} onChange={(e) => setBy(e.target.value)} /></div>
              <div className="sm:col-span-4"><label className="label" htmlFor="smp-desc">What do you need?</label><textarea id="smp-desc" rows={2} className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            </div>
            <button className={`${btn.primary} mt-3`} disabled={pending || !supplier || desc.trim().length < 5}
              onClick={() => run(() => requestSample(id, { supplier, description: desc, quantity: qty, needed_by: by }), () => { setDesc(""); setBy(""); })}>
              <MSymbol name="send" size={16} /> Request the sample
            </button>
          </details>
        )}
        {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
