"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { btn, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { CONCEPT_STATUS, conceptReadyToSend, MARKETS, type ConceptRow } from "@/lib/briefing";
import { createBriefsFromConcept, decideConcept, sendToSourcing, submitConcept, type ActionResult } from "./actions";

type C = Pick<ConceptRow, "id" | "status" | "client_approval_required" | "client_status" | "decision_comments" | "client_comments">;

export function ConceptStatusPill({ c }: { c: C }) {
  const st = CONCEPT_STATUS[c.status ?? "proposed"];
  return (
    <span className="flex flex-wrap gap-1">
      <Pill tone={st.tone}>{st.label}</Pill>
      {c.status === "approved" && c.client_status === "pending" && <Pill tone="accent"><MSymbol name="storefront" size={13} /> Waiting for the client</Pill>}
      {c.client_status === "approved" && <Pill tone="ok"><MSymbol name="verified" size={13} /> Client approved</Pill>}
    </span>
  );
}

/**
 * The buttons a concept card shows for the signed-in user: submit for approval, approve / request changes (only when
 * the database says this person may decide), send to Sourcing+ (brief concepts) or create briefs per market (campaign).
 */
export function ConceptActions({ c, canDecide, approvalRequired, mode = "brief" }: { c: C; canDecide: boolean; approvalRequired: boolean; mode?: "brief" | "campaign" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [picking, setPicking] = useState(false);
  const [markets, setMarkets] = useState<string[]>([]);
  const status = c.status ?? "proposed";

  const run = (fn: () => Promise<ActionResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });
  const submit = () => {
    const note = window.prompt("Anything the approver should know? (optional)");
    if (note !== null) run(() => submitConcept(c.id, note));
  };
  const changes = () => {
    const why = window.prompt("What needs to change?");
    if (why && why.trim()) run(() => decideConcept(c.id, "changes_requested", why));
  };
  const send = () => {
    const note = window.prompt("Anything Sourcing+ should know about this concept? (optional)");
    if (note !== null) run(() => sendToSourcing(c.id, note));
  };

  const ready = mode === "brief" && conceptReadyToSend(c, approvalRequired);
  return (
    <div className="space-y-2">
      <ConceptStatusPill c={c} />
      {status === "changes_requested" && (c.client_comments || c.decision_comments) && (
        <p className="rounded-md border border-bad/30 bg-bad-soft px-2 py-1 text-xs text-bad">{c.client_comments ? `Client: ${c.client_comments}` : c.decision_comments}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {(status === "proposed" || status === "changes_requested") && (
          <button className={clsx(ready ? btn.secondary : btn.primary, "flex-1")} disabled={pending} onClick={submit}>
            <MSymbol name="approval" size={16} /> {status === "changes_requested" ? "Submit again" : "Submit for approval"}
          </button>
        )}
        {status === "submitted_for_approval" && canDecide && (
          <>
            <button className={clsx(btn.primary, "flex-1")} disabled={pending} onClick={() => run(() => decideConcept(c.id, "approved", ""))}><MSymbol name="check" size={16} /> Approve</button>
            <button className={clsx(btn.secondary, "flex-1")} disabled={pending} onClick={changes}><MSymbol name="undo" size={16} /> Request changes</button>
          </>
        )}
        {status === "submitted_for_approval" && !canDecide && <p className="text-xs text-muted">A colleague with the approval role decides this (never the person who submitted it).</p>}
        {ready && (
          <button className={clsx(btn.primary, "flex-1")} disabled={pending} onClick={send}><MSymbol name="send" size={16} /> Send to Sourcing+</button>
        )}
        {mode === "campaign" && status === "approved" && !picking && (
          <button className={clsx(btn.primary, "flex-1")} disabled={pending} onClick={() => setPicking(true)}><MSymbol name="add" size={16} /> Create briefs for markets</button>
        )}
      </div>
      {mode === "campaign" && picking && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-2">
          <p className="text-xs font-semibold">One draft brief per market:</p>
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-xs sm:grid-cols-3">
            {MARKETS.map((m) => (
              <label key={m.code} className="flex items-center gap-1.5">
                <input type="checkbox" checked={markets.includes(m.code)} onChange={(e) => setMarkets((s) => (e.target.checked ? [...s, m.code] : s.filter((x) => x !== m.code)))} />
                {m.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className={btn.primary} disabled={pending || !markets.length} onClick={() => run(async () => {
              const r = await createBriefsFromConcept(c.id, markets);
              if (r.ok) { setPicking(false); setMarkets([]); }
              return r;
            })}>Create {markets.length || ""} brief{markets.length === 1 ? "" : "s"}</button>
            <button className={btn.secondary} onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}
      {res && (
        <p className={res.ok ? "text-xs text-ok" : "text-xs text-bad"} role={res.ok ? "status" : "alert"}>
          {res.message} {res.ok && mode === "campaign" && res.message.includes("brief") && <Link href="/briefing" className="font-semibold underline">See briefs</Link>}
        </p>
      )}
    </div>
  );
}
