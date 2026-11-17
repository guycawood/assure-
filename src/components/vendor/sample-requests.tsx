"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { SAMPLE_STATUS, type VendorSample } from "@/lib/creative-rfi";
import { shipSample, type RfiResult } from "@/app/vendor/(portal)/creative/actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Sample({ s, canAct }: { s: VendorSample; canAct: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<RfiResult | null>(null);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const st = SAMPLE_STATUS[s.status];
  const send = () => start(async () => { const r = await shipSample(s.id, carrier, tracking, note); setRes(r); if (r.ok) router.refresh(); });

  return (
    <li className="space-y-2 rounded-xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b>{s.quantity} piece{s.quantity === 1 ? "" : "s"}</b> <Pill tone={st.tone}>{st.label}</Pill>
        <span className="text-xs text-muted">Round {s.round}{s.needed_by ? ` · needed by ${when(s.needed_by)}` : ""}</span></div>
      <p>{s.description}</p>
      {s.tracking_number && <p className="text-xs text-muted">{s.carrier ? `${s.carrier} · ` : ""}Tracking {s.tracking_number}{s.shipped_at ? ` · sent ${when(s.shipped_at)}` : ""}</p>}
      {s.status === "changes_requested" && s.review_note && <p className="rounded-lg bg-warn-soft p-2 text-warn">Changes needed: {s.review_note}</p>}
      {(s.status === "requested" || s.status === "changes_requested") && canAct && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor={`car-${s.id}`}>Carrier</label><input id={`car-${s.id}`} className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
          <div><label className="label" htmlFor={`trk-${s.id}`}>Tracking number</label><input id={`trk-${s.id}`} className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
          <div><label className="label" htmlFor={`nt-${s.id}`}>Note (optional)</label><input id={`nt-${s.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="sm:col-span-3"><button className={btn.primary} disabled={pending || tracking.trim().length < 3} onClick={send}><MSymbol name="local_shipping" size={16} /> The sample is on its way</button></div>
        </div>
      )}
      {!canAct && <Pill tone="neutral">View-only account</Pill>}
      {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
    </li>
  );
}

export function SampleRequests({ items, canAct }: { items: VendorSample[]; canAct: boolean }) {
  return <ul className="space-y-3">{items.map((s) => <Sample key={s.id} s={s} canAct={canAct} />)}</ul>;
}
