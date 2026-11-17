"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BRIEF_TYPES, CREATIVE_ROUTES, type BriefProcess } from "@/lib/briefing";
import { creativeReviewBrief, sendBriefBack, setBriefProcess, type ActionResult } from "../actions";

// The brief intake steps of the Global Business Transformation process (Client brief intake and validation, Target):
// b2 brief type, b4 creative input needed?, b5 review with operational creative, b7 clear and complete?, b6 send back to the client.

export function ProcessPanel({ id, status, p, gaps, canChange, reviewerName }: {
  id: string; status: string; p: BriefProcess; gaps: string[]; canChange: boolean; reviewerName: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [types, setTypes] = useState<string[]>(p.brief_types);
  const [needed, setNeeded] = useState<"" | "yes" | "no">(p.creative_needed === null ? "" : p.creative_needed ? "yes" : "no");
  const [route, setRoute] = useState<string>(p.creative_route ?? "");
  const [note, setNote] = useState("");
  const [back, setBack] = useState(false);
  const [reason, setReason] = useState(gaps.join(" "));
  const [meeting, setMeeting] = useState(false);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });
  const open = ["draft", "submitted", "with_client", "in_ideation"].includes(status);
  const reviewed = !!p.creative_reviewed_at;

  return (
    <Panel title="Brief intake" sub="The steps from the client brief process: brief type, whether creative input is needed, the creative review, and sending an incomplete brief back to the client."
      actions={status === "with_client" ? <Pill tone="warn">With client</Pill> : undefined}>
      <div className="space-y-4 p-5 text-sm">
        {status === "with_client" && p.returned_reason && (
          <div className="rounded-lg border border-warn/40 bg-warn-soft p-3">
            <p className="eyebrow text-warn">Sent back to the client</p>
            <p className="whitespace-pre-wrap">{p.returned_reason}</p>
            {p.meeting_requested && <p className="mt-1 font-semibold">A client meeting was requested.</p>}
            <p className="mt-1 text-xs text-muted">Waiting for the client to answer and resubmit in their portal.</p>
          </div>
        )}

        <div>
          <p className="label">Brief type <span className="font-normal text-muted">(one or several)</span></p>
          <div className="flex flex-wrap gap-3">
            {BRIEF_TYPES.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5">
                <input type="checkbox" disabled={!canChange || !open} checked={types.includes(t.key)}
                  onChange={(e) => setTypes((s) => (e.target.checked ? [...s, t.key] : s.filter((x) => x !== t.key)))} /> {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="creative-needed">Creative input needed?</label>
            <select id="creative-needed" className="input" disabled={!canChange || !open} value={needed} onChange={(e) => setNeeded(e.target.value as "" | "yes" | "no")}>
              <option value="">Not decided</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </div>
          {needed === "yes" && (
            <div>
              <label className="label" htmlFor="creative-route">Who does the creative?</label>
              <select id="creative-route" className="input" disabled={!canChange || !open} value={route} onChange={(e) => setRoute(e.target.value)}>
                <option value="">Choose</option>
                {Object.entries(CREATIVE_ROUTES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}
        </div>
        {canChange && open && (
          <button className={btn.secondary} disabled={pending}
            onClick={() => run(() => setBriefProcess(id, { brief_types: types, creative_needed: needed === "" ? null : needed === "yes", creative_route: needed === "yes" ? route || null : null }))}>
            <MSymbol name="save" size={16} /> Save intake answers
          </button>
        )}

        {p.creative_needed && (
          <div className="rounded-lg border border-line bg-surface-2/60 p-3">
            <p className="font-semibold">Creative review {reviewed ? <Pill tone="ok">Done</Pill> : <Pill tone="warn">Needed before approval</Pill>}</p>
            {reviewed ? (
              <p className="text-muted">Reviewed{reviewerName ? ` by ${reviewerName}` : ""} on {new Date(p.creative_reviewed_at!).toLocaleDateString("en-GB")}.{p.creative_review_note ? ` ${p.creative_review_note}` : ""}</p>
            ) : open && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label className="label" htmlFor="creative-note">Review note (optional)</label>
                  <input id="creative-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <button className={btn.primary} disabled={pending} onClick={() => run(() => creativeReviewBrief(id, note), () => setNote(""))}>
                  <MSymbol name="verified" size={16} /> Reviewed with creative
                </button>
              </div>
            )}
          </div>
        )}

        {["draft", "submitted"].includes(status) && (
          <div className="rounded-lg border border-line p-3">
            <p className="font-semibold">Brief clear and complete?</p>
            <p className="text-xs text-muted">Timings, additional services, logistics information and sustainability requirements. If not, send it back to the client with the reason.</p>
            {gaps.length > 0 && <p className="mt-1 text-xs text-warn">{gaps.join(" ")}</p>}
            {!back ? (
              <button className={`${btn.secondary} mt-2`} onClick={() => setBack(true)}><MSymbol name="reply" size={16} /> Send back to the client</button>
            ) : (
              <div className="mt-2 space-y-2">
                <label className="label" htmlFor="back-reason">What is missing or unclear? (the client sees this)</label>
                <textarea id="back-reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={meeting} onChange={(e) => setMeeting(e.target.checked)} /> Ask for a client meeting</label>
                <div className="flex gap-2">
                  <button className={btn.primary} disabled={pending || reason.trim().length < 3} onClick={() => run(() => sendBriefBack(id, reason, meeting), () => setBack(false))}>Send back</button>
                  <button className={btn.secondary} onClick={() => setBack(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
