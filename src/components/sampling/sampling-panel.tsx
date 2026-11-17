"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { FileUpload } from "@/components/file-upload";
import { SAMPLING_STATUS, type SamplingFile, type SamplingJob } from "@/lib/sampling";
import {
  cancelSampling, decideSamplingApproval, issueSamplePo, receiveSample, requestSampling, reviewSample, sendSampleToClient, sendSamplingDrawing, type SamplingResult,
} from "@/app/(platform)/rfq/sampling-actions";

// The sampling job on an RFQ (GBT RFP process r10 to r24): request a sample quote from a supplier that has quoted, then follow the job
// to the sample PO, the drawing sign-off, the supplier's launch and shipment, the conformity check and the client's decision.

const money = (n: number | null, c: string | null) => (n === null ? "" : `${c ?? ""} ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Files({ files }: { files: SamplingFile[] }) {
  if (!files.length) return null;
  return <ul className="space-y-0.5">{files.map((f) => (
    <li key={f.id} className="flex items-center gap-1.5"><MSymbol name="description" size={16} className="text-muted" />
      <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>
  ))}</ul>;
}

export function SamplingPanel({ rfq, canAct, jobs, suppliers }: { rfq: string; canAct: boolean; jobs: SamplingJob[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SamplingResult | null>(null);
  const [supplier, setSupplier] = useState("");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const setN = (k: string, v: string) => setNotes((n) => ({ ...n, [k]: v }));
  const go = (fn: () => Promise<SamplingResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });

  return (
    <Panel title="Sampling" sub="Review a supplier's quote, then ask it for a sample quote. The job follows the sample from quote and PO to the client's approval.">
      <div className="space-y-4 p-5 text-sm">
        {jobs.map((j) => {
          const st = SAMPLING_STATUS[j.status];
          const note = notes[j.id] ?? "";
          return (
            <div key={j.id} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{j.job_number}</b> <span>{j.supplier_name}</span> <Pill tone={st.tone}>{st.label}</Pill>
                <span className="text-xs text-muted">{j.quantity} piece{j.quantity === 1 ? "" : "s"} · round {j.round}</span>
                {j.sample_po_number && <Pill tone={j.po_valid ? "info" : "bad"}>{j.po_valid ? `PO ${j.sample_po_number}` : `PO ${j.sample_po_number} invalid`}</Pill>}
              </div>
              <p>{j.description}</p>
              {j.quote_amount !== null && <p className="text-xs text-muted">Sample quote {money(j.quote_amount, j.quote_currency)}, {j.quote_lead_days} days{j.quote_note ? ` · ${j.quote_note}` : ""}{j.client_po_number ? ` · client PO ${j.client_po_number}` : ""}</p>}
              {j.client_reject_reason && j.status === "requested" && <p className="text-xs text-bad">The client did not accept the quote: {j.client_reject_reason}</p>}
              {j.tracking_number && <p className="text-xs text-muted">{j.carrier ? `${j.carrier} · ` : ""}Tracking {j.tracking_number}{j.invoice_ref ? ` · invoice ${j.invoice_ref}` : ""}</p>}
              {j.reception_notice && <p className="text-xs text-muted">Reception notice {j.reception_notice}</p>}
              {j.review_note && <p className="text-xs"><span className="text-muted">Check:</span> {j.review_note}</p>}
              {j.client_sample_comment && <p className="text-xs"><span className="text-muted">Client:</span> {j.client_sample_comment}</p>}
              {j.drawing_sent_at && <p className="text-xs text-muted">Drawing {j.drawing_approved === true ? "signed off" : j.drawing_approved === false ? `needs changes: ${j.drawing_comment}` : "with the client"}</p>}
              <Files files={j.drawing_files} />
              <Files files={j.files} />

              {canAct && j.status === "quoted" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Does the client need to approve the sample quote?</span>
                  <button className={btn.primary} disabled={pending} onClick={() => go(() => decideSamplingApproval(rfq, j.id, true))}>Yes, send it to the client</button>
                  <button className={btn.secondary} disabled={pending} onClick={() => go(() => decideSamplingApproval(rfq, j.id, false))}>No, accept it</button>
                </div>
              )}
              {canAct && j.status === "approved" && (
                <button className={btn.primary} disabled={pending} onClick={() => go(() => issueSamplePo(rfq, j.id))}><MSymbol name="receipt_long" size={16} /> Issue the sample PO</button>
              )}
              {canAct && ["approved", "po_issued", "launched"].includes(j.status) && j.drawing_approved !== true && (
                <details>
                  <summary className="cursor-pointer font-semibold text-accent">{j.drawing_sent_at ? "Send the drawing again" : "Technical drawing for the client to sign off"}</summary>
                  <div className="mt-2 space-y-2">
                    <FileUpload module="sourcing" entityType="sampling_drawing" entityId={j.id} label="technical drawing" compact />
                    <button className={btn.secondary} disabled={pending} onClick={() => go(() => sendSamplingDrawing(rfq, j.id))}><MSymbol name="send" size={16} /> Send for sign-off</button>
                  </div>
                </details>
              )}
              {canAct && j.status === "shipped" && (
                <div className="flex flex-wrap items-end gap-2">
                  <input aria-label="Arrival note" className="input min-w-48 flex-1" placeholder="Condition on arrival (optional)" value={note} onChange={(e) => setN(j.id, e.target.value)} />
                  <button className={btn.primary} disabled={pending} onClick={() => go(() => receiveSample(rfq, j.id, note))}><MSymbol name="inventory" size={16} /> It has arrived</button>
                </div>
              )}
              {canAct && j.status === "received" && (
                <div className="flex flex-wrap items-end gap-2">
                  <input aria-label="Check note" className="input min-w-48 flex-1" placeholder="Check note (needed to reject)" value={note} onChange={(e) => setN(j.id, e.target.value)} />
                  <button className={btn.primary} disabled={pending} onClick={() => go(() => reviewSample(rfq, j.id, true, note))}><MSymbol name="check_circle" size={16} /> Sample OK</button>
                  <button className={btn.secondary} disabled={pending || note.trim().length < 3} onClick={() => go(() => reviewSample(rfq, j.id, false, note))}>Sample rejected</button>
                </div>
              )}
              {canAct && j.status === "accepted" && (
                <button className={btn.primary} disabled={pending} onClick={() => go(() => sendSampleToClient(rfq, j.id))}><MSymbol name="send" size={16} /> Send the sample to the client</button>
              )}
              {canAct && !["shipped", "received", "accepted", "with_client", "client_approved", "rejected", "cancelled"].includes(j.status) && (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-bad">Cancel this sampling job</summary>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <input aria-label="Why cancelled" className="input min-w-48 flex-1" placeholder="Why" value={note} onChange={(e) => setN(j.id, e.target.value)} />
                    <button className={btn.danger} disabled={pending || note.trim().length < 3} onClick={() => go(() => cancelSampling(rfq, j.id, note))}>Cancel</button>
                  </div>
                </details>
              )}
              {j.events.length > 0 && (
                <details><summary className="cursor-pointer text-xs text-muted">History ({j.events.length})</summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">{j.events.map((e, i) => <li key={i}>{when(e.at)} · {e.event.replace(/_/g, " ")}{e.detail ? `: ${e.detail}` : ""}</li>)}</ul>
                </details>
              )}
            </div>
          );
        })}

        {canAct && suppliers.length > 0 ? (
          <details open={jobs.length === 0}>
            <summary className="cursor-pointer font-semibold text-accent">Ask a supplier for a sample quote</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><label className="label" htmlFor="sj-sup">Supplier that has quoted</label>
                <select id="sj-sup" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">Choose</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="label" htmlFor="sj-qty">Pieces</label><input id="sj-qty" type="number" min={1} max={100} className="input" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="sm:col-span-4"><label className="label" htmlFor="sj-desc">What sample do you need?</label><textarea id="sj-desc" rows={2} className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            </div>
            <button className={`${btn.primary} mt-3`} disabled={pending || !supplier || desc.trim().length < 5} onClick={() => go(() => requestSampling(rfq, supplier, desc, qty), () => setDesc(""))}>
              <MSymbol name="send" size={16} /> Request the sample quote
            </button>
          </details>
        ) : jobs.length === 0 && <p className="text-muted">A sampling job can be requested once a supplier has quoted on this RFQ.</p>}
        {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
