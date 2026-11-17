"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { FileUpload } from "@/components/file-upload";
import { SAMPLING_STATUS, type VendorSamplingJob } from "@/lib/sampling";
import { launchSample, quoteSample, shipSampleJob, type SamplingActionResult } from "@/app/vendor/(portal)/sampling/actions";

const money = (n: number | null, c: string | null) => (n === null ? "" : `${c ?? ""} ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());

function Job({ j, supplierId, canAct }: { j: VendorSamplingJob; supplierId: string; canAct: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SamplingActionResult | null>(null);
  const [amount, setAmount] = useState("");
  const [lead, setLead] = useState("");
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [invoice, setInvoice] = useState("");
  const st = SAMPLING_STATUS[j.status];
  const go = (fn: () => Promise<SamplingActionResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });
  const drawingBlocks = j.drawing_sent_at !== null && j.drawing_approved !== true;

  return (
    <li className="space-y-2 rounded-xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b>{j.job_number}</b> <Pill tone={st.tone}>{st.label}</Pill>
        <span className="text-xs text-muted">{j.quantity} piece{j.quantity === 1 ? "" : "s"} · round {j.round}</span>
        {j.sample_po_number && <Pill tone={j.po_valid ? "info" : "bad"}>{j.po_valid ? `Sample PO ${j.sample_po_number}` : `PO ${j.sample_po_number} invalid`}</Pill>}</div>
      <p>{j.description}</p>
      {j.quote_amount !== null && <p className="text-xs text-muted">Your sample quote: {money(j.quote_amount, j.quote_currency)}, {j.quote_lead_days} days</p>}
      {j.client_reject_reason && j.status === "requested" && <p className="rounded-lg bg-warn-soft p-2 text-warn">The quote was not accepted: {j.client_reject_reason}. Please send a revised quote.</p>}
      {j.status === "rework" && j.client_sample_comment && <p className="rounded-lg bg-warn-soft p-2 text-warn">Rework needed: {j.client_sample_comment}</p>}
      {j.status === "rejected" && j.review_note && <p className="rounded-lg bg-warn-soft p-2 text-warn">Sample rejected: {j.review_note}. The sample PO is invalid.</p>}
      {j.drawing_files.length > 0 && (
        <div><p className="eyebrow">Technical drawing{j.drawing_approved === true ? " (signed off)" : " (waiting for sign-off)"}</p>
          <ul className="space-y-0.5">{j.drawing_files.map((f) => <li key={f.id}><a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>)}</ul></div>
      )}

      {canAct && j.status === "requested" && (
        <div className="grid gap-2 sm:grid-cols-4">
          <div><label className="label" htmlFor={`am-${j.id}`}>Sample cost ({j.quote_currency ?? ""})</label><input id={`am-${j.id}`} type="number" min={0} step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="label" htmlFor={`ld-${j.id}`}>Lead time (days)</label><input id={`ld-${j.id}`} type="number" min={0} className="input" value={lead} onChange={(e) => setLead(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor={`nt-${j.id}`}>Note (optional)</label><input id={`nt-${j.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="sm:col-span-4"><button className={btn.primary} disabled={pending || amount === "" || lead === ""} onClick={() => go(() => quoteSample(j.id, amount, lead, note))}><MSymbol name="request_quote" size={16} /> Send the sample quote</button></div>
        </div>
      )}
      {["quoted", "awaiting_client", "approved"].includes(j.status) && <p className="text-muted">Waiting for us to issue the sample PO.</p>}

      {canAct && j.status === "po_issued" && j.po_valid && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="font-semibold">Confirm the sample launch</p>
          {drawingBlocks && <p className="text-muted">The technical drawing has to be signed off before you launch.</p>}
          <FileUpload module="sourcing" entityType="sampling_job" entityId={j.id} supplierId={supplierId} label="photo or video" compact />
          <input aria-label="Launch note" className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className={btn.primary} disabled={pending || drawingBlocks || j.files.length === 0} onClick={() => go(() => launchSample(j.id, note))}><MSymbol name="rocket_launch" size={16} /> Confirm the launch</button>
          {j.files.length === 0 && <p className="text-xs text-muted">Upload at least one photo or video first.</p>}
        </div>
      )}
      {canAct && (j.status === "launched" || j.status === "rework") && j.po_valid && (
        <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-4">
          <p className="font-semibold sm:col-span-4">{j.status === "rework" ? "Send the reworked sample" : "Send the sample"}</p>
          <div><label className="label" htmlFor={`cr-${j.id}`}>Carrier</label><input id={`cr-${j.id}`} className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
          <div><label className="label" htmlFor={`tk-${j.id}`}>Tracking number</label><input id={`tk-${j.id}`} className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
          <div><label className="label" htmlFor={`iv-${j.id}`}>Your invoice number</label><input id={`iv-${j.id}`} className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></div>
          <div><label className="label" htmlFor={`sn-${j.id}`}>Note (optional)</label><input id={`sn-${j.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="sm:col-span-4"><button className={btn.primary} disabled={pending || tracking.trim().length < 3} onClick={() => go(() => shipSampleJob(j.id, carrier, tracking, invoice, note))}><MSymbol name="local_shipping" size={16} /> The sample is on its way</button></div>
        </div>
      )}
      {j.tracking_number && ["shipped", "received", "accepted", "with_client", "client_approved"].includes(j.status) && (
        <p className="text-xs text-muted">{j.carrier ? `${j.carrier} · ` : ""}Tracking {j.tracking_number}{j.invoice_ref ? ` · invoice ${j.invoice_ref}` : ""}</p>
      )}
      {!canAct && <Pill tone="neutral">View-only account</Pill>}
      {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
    </li>
  );
}

export function VendorSampling({ items, supplierId, canAct }: { items: VendorSamplingJob[]; supplierId: string; canAct: boolean }) {
  return <ul className="space-y-3">{items.map((j) => <Job key={j.id} j={j} supplierId={supplierId} canAct={canAct} />)}</ul>;
}
