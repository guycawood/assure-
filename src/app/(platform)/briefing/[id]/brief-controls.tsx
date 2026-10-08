"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ApprovalPill } from "@/components/briefing/labels";
import type { ApprovalStatus, BriefApproval } from "@/lib/briefing";
import { archiveBrief, decideBrief, submitBrief, type ActionResult } from "../actions";

export function BriefActions({ id, status, canEdit, canSubmit, canArchive }: { id: string; status: string; canEdit: boolean; canSubmit: boolean; canArchive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {canEdit && <Link href={`/briefing/${id}?edit=1`} className={btn.secondary}><MSymbol name="edit" size={17} /> Edit</Link>}
        {canSubmit && status === "draft" && <button className={btn.primary} disabled={pending} onClick={() => run(() => submitBrief(id))}><MSymbol name="send" size={17} /> Submit for approval</button>}
        {canArchive && (
          <button className={btn.danger} disabled={pending} onClick={() => { const note = window.prompt("Why are you archiving this brief? (optional)") ; if (note !== null) run(() => archiveBrief(id, note)); }}>
            <MSymbol name="archive" size={17} /> Archive
          </button>
        )}
      </div>
      {res && <p className={res.ok ? "text-sm text-ok" : "text-sm text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ApprovalPanel({ id, approvalStatus, isAuthor, showDecision, history, names, reviewer, reviewedAt }: {
  id: string; approvalStatus: ApprovalStatus | null; isAuthor: boolean; showDecision: boolean; history: BriefApproval[];
  names: Record<string, string>; reviewer: string | null; reviewedAt: string | null;
}) {
  const router = useRouter();
  const [comments, setComments] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const last = history[history.length - 1];
  const decide = (d: "approved" | "changes_requested") => start(async () => { const r = await decideBrief(id, d, comments.trim()); setRes(r); if (r.ok) { setComments(""); router.refresh(); } });

  return (
    <Panel title="Manager approval" sub="A different team member approves each brief before ideation or hand-off." actions={<ApprovalPill status={approvalStatus} />}>
      <div className="space-y-4 p-5">
        {last?.decision === "changes_requested" && last.comments && (
          <div className="rounded-lg border border-bad/30 bg-bad-soft/60 p-3">
            <p className="eyebrow text-bad">Last review note</p>
            <p className="whitespace-pre-wrap text-sm">{last.comments}</p>
            <p className="mt-1 text-xs text-muted">{names[last.decided_by ?? ""] ?? "Reviewer"} · {when(last.decided_at)}</p>
          </div>
        )}
        {showDecision && (isAuthor ? (
          <p className="text-sm text-muted">This brief is waiting for another team member to review it. You can&apos;t approve your own brief.</p>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="review-comments">Review comments</label>
              <textarea id="review-comments" rows={3} className="input" value={comments} onChange={(e) => setComments(e.target.value)}
                placeholder="A note for the author (optional when approving, needed when asking for changes)" />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button className={btn.danger} disabled={pending || !comments.trim()} onClick={() => decide("changes_requested")}><MSymbol name="undo" size={17} /> Request changes</button>
              <button className={btn.primary} disabled={pending} onClick={() => decide("approved")}><MSymbol name="check" size={17} /> Approve</button>
            </div>
          </>
        ))}
        {approvalStatus === "approved" && reviewer && <p className="text-sm text-muted">Approved by {reviewer}{reviewedAt ? ` on ${when(reviewedAt)}` : ""}.</p>}
        {res && <p className={res.ok ? "text-sm text-ok" : "text-sm text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
        {history.length > 0 && (
          <div className="border-t border-line pt-3">
            <p className="eyebrow mb-2">Approval history</p>
            <ul className="space-y-2">
              {[...history].reverse().map((h) => (
                <li key={h.id} className="text-xs">
                  <span className={h.decision === "approved" ? "font-bold text-ok" : "font-bold text-bad"}>{h.decision === "approved" ? "Approved" : "Changes requested"}</span>
                  <span className="text-muted"> · {names[h.decided_by ?? ""] ?? "—"} · {when(h.decided_at)}</span>
                  {h.comments && <p className="whitespace-pre-wrap text-muted">{h.comments}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
