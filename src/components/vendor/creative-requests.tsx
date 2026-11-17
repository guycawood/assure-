"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { FileUpload } from "@/components/file-upload";
import { RFI_INVITE_STATUS, type VendorRfi } from "@/lib/creative-rfi";
import { respondCreativeRfi, sendCreativeProposal, type RfiResult } from "@/app/vendor/(portal)/creative/actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Request({ r, supplierId, canAct }: { r: VendorRfi; supplierId: string; canAct: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<RfiResult | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [ip, setIp] = useState(false);
  const [note, setNote] = useState(r.proposal_note ?? "");
  const run = (fn: () => Promise<RfiResult>) => start(async () => { const x = await fn(); setRes(x); if (x.ok) router.refresh(); });
  const st = RFI_INVITE_STATUS[r.status];
  const live = r.rfi_status === "open";

  return (
    <li className="space-y-3 rounded-xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b className="text-base">{r.title}</b> <Pill tone={st.tone}>{st.label}</Pill><span className="text-xs text-muted">Proposals due {when(r.due_at)}</span></div>
      <div><p className="eyebrow">Brief</p><p className="whitespace-pre-wrap">{r.supplier_brief}</p></div>
      <div><p className="eyebrow">IP rule</p><p>{r.ip_rule}</p></div>

      {live && r.status === "invited" && canAct && (
        !declining ? (
          <div className="flex flex-wrap gap-2">
            <button className={btn.primary} disabled={pending} onClick={() => run(() => respondCreativeRfi(r.id, true, ""))}><MSymbol name="check" size={16} /> We can respond</button>
            <button className={btn.secondary} onClick={() => setDeclining(true)}>We cannot respond</button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="label" htmlFor={`why-${r.id}`}>Why can you not respond?</label>
            <textarea id={`why-${r.id}`} rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button className={btn.primary} disabled={pending || reason.trim().length < 3} onClick={() => run(() => respondCreativeRfi(r.id, false, reason))}>Send answer</button>
              <button className={btn.secondary} onClick={() => setDeclining(false)}>Cancel</button>
            </div>
          </div>
        )
      )}
      {r.status === "rejected" && r.reject_reason && <p className="text-muted">Your reason: {r.reject_reason}</p>}

      {live && (r.status === "confirmed" || r.status === "proposed") && canAct && (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="font-semibold">{r.status === "proposed" ? "Your proposal is with us. You can replace it until the due date." : "Your ideation proposal"}</p>
          <FileUpload module="briefing" entityType="creative_rfi_invite" entityId={r.id} supplierId={supplierId} label="ideation proposal" compact />
          <div><label className="label" htmlFor={`note-${r.id}`}>Note (optional if you upload a file)</label>
            <textarea id={`note-${r.id}`} rows={3} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={ip} onChange={(e) => setIp(e.target.checked)} /> <span>I confirm that we accept the IP rule above.</span></label>
          <button className={btn.primary} disabled={pending || !ip} onClick={() => run(() => sendCreativeProposal(r.id, ip, note))}><MSymbol name="send" size={16} /> {r.status === "proposed" ? "Send the updated proposal" : "Send proposal"}</button>
        </div>
      )}
      {r.status === "proposed" && r.files.length > 0 && (
        <ul className="space-y-0.5">{r.files.map((f) => (
          <li key={f.id} className="flex items-center gap-1.5"><MSymbol name="description" size={16} className="text-muted" /><a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>
        ))}</ul>
      )}
      {!live && (r.status === "selected" || r.status === "not_selected") && <p className="text-muted">{r.status === "selected" ? "Your proposal was selected. We will be in touch." : "Another proposal was selected this time. Thank you for responding."}</p>}
      {!canAct && <Pill tone="neutral">View-only account</Pill>}
      {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
    </li>
  );
}

export function CreativeRequests({ items, supplierId, canAct }: { items: VendorRfi[]; supplierId: string; canAct: boolean }) {
  return <ul className="space-y-3">{items.map((r) => <Request key={r.id} r={r} supplierId={supplierId} canAct={canAct} />)}</ul>;
}
