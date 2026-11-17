"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btn, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { FileUpload } from "@/components/file-upload";
import { launchProduction, startProof, submitProof, type ProofResult } from "@/app/vendor/(portal)/orders/proof-actions";
import { approvedRound, mayLaunch, openRound, type PoProofs } from "@/lib/proofs";
import { ProofRound } from "./proof-bits";

// Vendor view of the proof step: start a proof (digital or physical), upload it, send it, answer changes in a new round,
// and launch production once the client has approved a proof.
export function VendorProofs({ poId, supplierId, data, canAct }: { poId: string; supplierId: string; data: PoProofs; canAct: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ProofResult | null>(null);
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const run = (fn: () => Promise<ProofResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });
  const open = openRound(data);
  const approved = approvedRound(data);
  const started = !!data.production_started_at;

  return (
    <div className="space-y-4 p-5 text-sm">
      {started && <p className="flex items-center gap-2 font-semibold text-ok"><MSymbol name="check_circle" size={18} fill /> Production launched {new Date(data.production_started_at!).toLocaleDateString("en-GB")}.</p>}
      {!started && data.proof_waived && <p className="rounded-lg bg-surface-2 p-3 text-muted">We have waived the proof for this order. You can launch production.</p>}

      {data.rounds.length > 0 && (
        <ol className="space-y-2">
          {[...data.rounds].reverse().map((r) => (
            <ProofRound key={r.id} r={r}>
              {r.status === "draft" && canAct && (
                <div className="space-y-3 border-t border-line pt-3">
                  <FileUpload module="orders" entityType="po_proof" entityId={r.id} supplierId={supplierId} label={r.kind === "physical" ? "photo of the physical proof" : "digital proof"} compact />
                  {r.kind === "physical" && (
                    <div><label className="label" htmlFor="proof-tracking">Tracking number</label>
                      <input id="proof-tracking" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Courier tracking number" /></div>
                  )}
                  <div><label className="label" htmlFor="proof-note">Note for client services (optional)</label>
                    <input id="proof-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                  <button className={btn.primary} disabled={pending || r.files.length === 0 || (r.kind === "physical" && !tracking.trim())}
                    onClick={() => run(() => submitProof(poId, r.id, tracking, note))}><MSymbol name="send" size={16} /> Send proof</button>
                  {r.files.length === 0 && <p className="text-xs text-muted">Upload the proof first.</p>}
                </div>
              )}
            </ProofRound>
          ))}
        </ol>
      )}

      {!open && !approved && !started && !data.proof_waived && canAct && (
        <div className="space-y-2">
          <p className="text-muted">{data.rounds.length ? "Make the changes asked for, then start a new round." : "Once you have the final artwork, launch a proof or sample."}</p>
          <div className="flex flex-wrap gap-2">
            <button className={btn.primary} disabled={pending} onClick={() => run(() => startProof(poId, "digital"))}><MSymbol name="draft" size={16} /> Start a digital proof</button>
            <button className={btn.secondary} disabled={pending} onClick={() => run(() => startProof(poId, "physical"))}><MSymbol name="package_2" size={16} /> Start a physical proof</button>
          </div>
        </div>
      )}
      {open && open.status !== "draft" && <p className="text-muted">Waiting for {open.status === "submitted" ? "Our client services to check" : "the client to approve"} the proof.</p>}

      {canAct && mayLaunch(data) && (
        <div className="rounded-lg border border-ok/40 bg-ok-soft p-3">
          <p className="mb-2 font-semibold text-ok">{approved ? "The client approved your proof." : "No proof is needed for this order."} You can launch production.</p>
          <button className={btn.primary} disabled={pending} onClick={() => run(() => launchProduction(poId))}><MSymbol name="precision_manufacturing" size={16} /> Launch production</button>
        </div>
      )}
      {!canAct && <Pill tone="neutral">View-only account</Pill>}
      {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
    </div>
  );
}
