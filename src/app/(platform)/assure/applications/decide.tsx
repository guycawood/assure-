"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { approvePlan, decideApplication, declinePlan, type Result } from "./actions";

/** Review buttons for a public vendor application. Rejecting or marking duplicate needs a reason. */
export function ApplicationDecision({ id, status }: { id: string; status: string }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const go = (s: string) => start(async () => setMsg(await decideApplication(id, s, note)));
  if (["invited", "rejected", "duplicate"].includes(status)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (needed to reject)" className="input w-56 py-1.5" />
      {status === "new" && <button disabled={pending} onClick={() => go("reviewing")} className={btn.secondary}>Start review</button>}
      <button disabled={pending} onClick={() => go("invited")} className={btn.primary}>Invite to onboard</button>
      <button disabled={pending} onClick={() => go("duplicate")} className={btn.secondary}>Duplicate</button>
      <button disabled={pending} onClick={() => go("rejected")} className={btn.danger}>Reject</button>
      {msg && <span className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}</span>}
    </div>
  );
}

/** Approve (applies the plan) or decline a vendor's plan change request. Both need a reason. */
export function PlanDecision({ id, supplierId, tier }: { id: string; supplierId: string; tier: string }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="input w-56 py-1.5" />
      <button disabled={pending} onClick={() => start(async () => setMsg(await approvePlan(supplierId, tier, reason)))} className={btn.primary}>Approve</button>
      <button disabled={pending} onClick={() => start(async () => setMsg(await declinePlan(id, reason)))} className={btn.danger}>Decline</button>
      {msg && <span className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}</span>}
    </div>
  );
}
