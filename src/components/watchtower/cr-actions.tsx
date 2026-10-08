"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { btn } from "@/components/ui";
import { markImplemented, reviewChangeRequest, startReview, verifyChangeRequest, type Result } from "@/app/(platform)/watchtower/library-actions";

type Principle = { id: string; code: string | null; title: string; category: string; description: string };
type Req = { id: string; status: string; category: string | null; impact_level: string | null; implemented_by: string | null };
const CATS: [string, string][] = [["data_integrity", "Data integrity"], ["access_control", "Access control"], ["provenance", "Provenance"], ["governance_ownership", "Governance & ownership"], ["user_experience", "User experience"]];

/** Review (with the principles check), mark implemented, verify. The server enforces the same rules. */
export function CrActions({ request, principles, me }: { request: Req; principles: Principle[]; me: string }) {
  const [open, setOpen] = useState<"review" | "implement" | "verify" | null>(null);
  const [category, setCategory] = useState(request.category ?? "");
  const [impact, setImpact] = useState(request.impact_level ?? "");
  const [status, setStatus] = useState("approved");
  const [notes, setNotes] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState(false);
  const [conflicting, setConflicting] = useState<string[]>([]);
  const [msg, setMsg] = useState<Result | null>(null);
  const [secs, setSecs] = useState(0);
  const [pending, start] = useTransition();
  const relevant = principles.filter((p) => p.category === category);

  useEffect(() => {
    if (open !== "review") return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  const openReview = () => { setMsg(null); setOpen("review"); start(async () => { await startReview(request.id); }); };
  const close = () => { setOpen(null); setMsg(null); setNotes(""); };
  const run = (fn: () => Promise<Result>) => start(async () => { const r = await fn(); setMsg(r); if (r.ok) close(); });
  const allChecked = relevant.every((p) => checked.includes(p.id));
  const canApprove = category && allChecked && secs >= 20;

  return (
    <div className="flex shrink-0 gap-2">
      {["logged", "under_review", "needs_clarification"].includes(request.status) && <button onClick={openReview} className={btn.secondary}>Review</button>}
      {request.status === "approved" && <button onClick={() => setOpen("implement")} className={btn.secondary}>Mark implemented</button>}
      {request.status === "implemented_pending_verification" && request.implemented_by !== me && <button onClick={() => setOpen("verify")} className={btn.primary}>Verify &amp; close</button>}

      <Modal open={open === "review"} onClose={close} title="Review change request" sub="Choose a category, read every principle in it, then decide." wide>
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="label">Category *</span>
              <select value={category} onChange={(e) => { setCategory(e.target.value); setChecked([]); }} className="input">
                <option value="">Choose…</option>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label><span className="label">Impact</span>
              <select value={impact} onChange={(e) => setImpact(e.target.value)} className="input">
                <option value="">From category</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select></label>
            <label><span className="label">Outcome</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
                <option value="approved">Approve</option><option value="under_review">Keep under review</option>
                <option value="needs_clarification">Ask for clarification</option><option value="rejected">Reject</option>
              </select></label>
          </div>
          {category && (
            <div>
              <p className="label">Principles in this category ({relevant.length}) — tick each once you&apos;ve read it</p>
              {relevant.length === 0 ? <p className="text-muted">No active principles in this category.</p> : (
                <ul className="space-y-2">
                  {relevant.map((p) => (
                    <li key={p.id} className="rounded-lg border border-line p-3">
                      <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={checked.includes(p.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, p.id] : checked.filter((x) => x !== p.id))} />
                        <span><b>{p.code} · {p.title}</b><span className="block text-muted">{p.description}</span></span>
                      </label>
                      {conflicts && checked.includes(p.id) && (
                        <label className="ml-6 mt-1 flex items-center gap-2 text-xs text-bad">
                          <input type="checkbox" checked={conflicting.includes(p.id)} onChange={(e) => setConflicting(e.target.checked ? [...conflicting, p.id] : conflicting.filter((x) => x !== p.id))} /> Conflicts with this principle
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={conflicts} onChange={(e) => setConflicts(e.target.checked)} /> This request conflicts with a principle</label>
            </div>
          )}
          <label className="block"><span className="label">Review notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" /></label>
          {status === "approved" && !canApprove && (
            <p className="text-xs text-muted">To approve: choose a category, tick every principle{secs < 20 ? `, and spend at least 20 seconds reviewing (${20 - secs}s left)` : ""}.</p>
          )}
          {msg && !msg.ok && <p className="rounded-lg bg-bad-soft px-3 py-2 text-bad">{msg.message}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className={btn.secondary}>Cancel</button>
            <button disabled={pending || !category || (status === "approved" && !canApprove)}
              onClick={() => run(() => reviewChangeRequest(request.id, { status, category, impact, notes, principles: checked, conflicts, conflicting }))} className={btn.primary}>Save review</button>
          </div>
        </div>
      </Modal>

      <Modal open={open === "implement" || open === "verify"} onClose={close} title={open === "verify" ? "Verify the implementation" : "Mark as implemented"}
        sub={open === "verify" ? "A different person checks the change is live and correct." : "Say what was changed so someone else can verify it."}>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="label">{open === "verify" ? "What you checked *" : "What was done"}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input" /></label>
          {msg && !msg.ok && <p className="rounded-lg bg-bad-soft px-3 py-2 text-bad">{msg.message}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className={btn.secondary}>Cancel</button>
            <button disabled={pending} onClick={() => run(() => (open === "verify" ? verifyChangeRequest(request.id, notes) : markImplemented(request.id, notes)))} className={btn.primary}>
              {open === "verify" ? "Verify and close" : "Mark implemented"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
