"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { reviewProof, waiveProof } from "@/app/(platform)/orders/proof-actions";
import type { ProofResult } from "@/app/vendor/(portal)/orders/proof-actions";
import type { PoProofs } from "@/lib/proofs";
import { ProofRound } from "./proof-bits";

// Client services view: check each submitted proof (dimensions and material for a physical one), send it to the client or
// back to the supplier, and waive the proof step for an order that needs none.
export function InternalProofs({ poId, data, status }: { poId: string; data: PoProofs; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ProofResult | null>(null);
  const [note, setNote] = useState("");
  const [sentOn, setSentOn] = useState(new Date().toLocaleDateString("en-CA"));
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const run = (fn: () => Promise<ProofResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });

  return (
    <div className="space-y-4 p-5 text-sm">
      {data.production_started_at && <p className="font-semibold text-ok">The supplier launched production on {new Date(data.production_started_at).toLocaleDateString("en-GB")}.</p>}
      {data.proof_waived && <p className="rounded-lg bg-surface-2 p-3">Proof waived: {data.proof_waived_reason}</p>}
      {data.rounds.length === 0 && !data.proof_waived && <p className="text-muted">{status === "accepted" ? "The supplier has not sent a proof yet." : "Proofs start once the supplier accepts the order."}</p>}
      <ol className="space-y-2">
        {[...data.rounds].reverse().map((r) => (
          <ProofRound key={r.id} r={r}>
            {r.status === "submitted" && (
              <div className="space-y-2 border-t border-line pt-3">
                <p className="text-xs text-muted">{r.kind === "physical" ? "Check dimensions and material, send the proof to the client office and record the date." : "Check the digital proof. It goes to the client automatically."}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><label className="label" htmlFor={`cs-note-${r.id}`}>Note (needed to send it back)</label><input id={`cs-note-${r.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                  {r.kind === "physical" && <div><label className="label" htmlFor={`cs-date-${r.id}`}>Sent to the client on</label><input id={`cs-date-${r.id}`} type="date" className="input" value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={btn.primary} disabled={pending} onClick={() => run(() => reviewProof(poId, r.id, true, note, r.kind === "physical" ? sentOn : ""), () => setNote(""))}><MSymbol name="send" size={16} /> Checked: send to the client</button>
                  <button className={btn.danger} disabled={pending || note.trim().length < 3} onClick={() => run(() => reviewProof(poId, r.id, false, note, ""), () => setNote(""))}><MSymbol name="undo" size={16} /> Send back to the supplier</button>
                </div>
              </div>
            )}
          </ProofRound>
        ))}
      </ol>
      {["accepted"].includes(status) && !data.proof_waived && !data.production_started_at && (
        waiving ? (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <label className="label" htmlFor="waive-reason">Why is no proof needed?</label>
            <input id="waive-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: repeat order, artwork unchanged" />
            <div className="flex gap-2">
              <button className={btn.primary} disabled={pending || reason.trim().length < 3} onClick={() => run(() => waiveProof(poId, reason), () => setWaiving(false))}>Waive the proof</button>
              <button className={btn.secondary} onClick={() => setWaiving(false)}>Cancel</button>
            </div>
          </div>
        ) : <button className={btn.secondary} onClick={() => setWaiving(true)}><MSymbol name="block" size={16} /> No proof needed for this order</button>
      )}
      {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
    </div>
  );
}
