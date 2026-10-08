"use client";

import { Fragment, useActionState, useState, useTransition } from "react";
import { clsx } from "clsx";
import { approveFastTrack, raiseGapTickets, updateGate, type ActionResult } from "@/app/(platform)/assure/actions";
import { effectiveGateState, formatDate, GATE_STATUS, timeAgo, type GateDefinition, type GateStatus, type SupplierGate } from "@/lib/srt";
import { btn } from "@/components/ui";

const statusClass: Record<string, string> = {
  verified: "border-ok bg-ok-soft",
  not_required: "border-ok bg-ok-soft",
  received: "border-info bg-info-soft",
  requested: "border-warn bg-warn-soft",
  rejected: "border-bad bg-bad-soft",
  missing: "border-bad",
};

/** Which statuses this user may choose for a gate. Postgres enforces the same rules. */
function allowedStatuses(def: GateDefinition, role: string | null): Set<GateStatus> {
  const all = new Set<GateStatus>(["missing", "requested", "received"]);
  const canVerify = role === "admin" || (def.verifier_role === "finance" ? role === "finance" : role === "agent" || role === "lead");
  if (canVerify) { all.add("verified"); all.add("rejected"); }
  if (role === "admin" || role === "lead") all.add("not_required");
  return all;
}

export function GateTable({
  supplierId, defs, gates, people, role,
}: { supplierId: string; defs: GateDefinition[]; gates: SupplierGate[]; people: Record<string, string>; role: string | null }) {
  const byKey = new Map(gates.map((g) => [g.gate_key, g]));
  let stage = "";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr>{["Gate", "Status", "Expiry", "Note", "Updated"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>
          {defs.map((d) => {
            const header = d.stage !== stage;
            stage = d.stage;
            const g = byKey.get(d.key);
            return (
              <Fragment key={d.key}>
                {header && <tr><td colSpan={5} className="bg-surface-2 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">{d.stage}</td></tr>}
                {g && <GateRow supplierId={supplierId} def={d} gate={g} updatedBy={g.updated_by ? people[g.updated_by] : undefined} allowed={allowedStatuses(d, role)} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GateRow({ supplierId, def, gate, updatedBy, allowed }: { supplierId: string; def: GateDefinition; gate: SupplierGate; updatedBy?: string; allowed: Set<GateStatus> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const st = effectiveGateState(gate);

  const save = (patch: Parameters<typeof updateGate>[2]) =>
    start(async () => {
      setError(undefined);
      const r = await updateGate(supplierId, def.key, patch);
      if (r.error) setError(r.error);
    });

  return (
    <tr className={clsx(pending && "opacity-60")}>
      <td className="td min-w-[220px] font-medium">
        {def.label}
        {def.critical && <span className="ml-1.5 text-[0.7rem] font-bold text-bad">CRITICAL</span>}
        {def.verifier_role === "finance" && <span className="ml-1.5 text-[0.7rem] font-semibold text-muted">Finance verifies</span>}
        {st === "expired" && <div className="text-xs text-bad">Expired {formatDate(gate.expiry_date)}</div>}
        {gate.status === "rejected" && gate.rejection_reason && <div className="text-xs text-bad">Rejected: {gate.rejection_reason}</div>}
        {error && <div className="text-xs text-bad" role="alert">{error}</div>}
        {rejecting && (
          <div className="mt-1 flex gap-1.5">
            <input className="input py-1 text-xs" placeholder="Reason the vendor can act on" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Rejection reason" />
            <button type="button" className={btn.danger} disabled={!reason.trim()} onClick={() => { save({ status: "rejected", rejection_reason: reason.trim() }); setRejecting(false); }}>Reject</button>
            <button type="button" className={btn.secondary} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        )}
      </td>
      <td className="td">
        <select
          aria-label={`${def.label} status`}
          value={gate.status}
          disabled={pending}
          className={clsx("input w-auto py-1", statusClass[gate.status])}
          onChange={(e) => {
            const v = e.target.value as GateStatus;
            if (v === "rejected") { setRejecting(true); return; }
            save({ status: v });
          }}
        >
          {GATE_STATUS.map((s) => (
            <option key={s.value} value={s.value} disabled={!allowed.has(s.value) && s.value !== gate.status}>{s.label}</option>
          ))}
        </select>
      </td>
      <td className="td">
        {def.has_expiry ? (
          <input
            type="date"
            aria-label={`${def.label} expiry`}
            defaultValue={gate.expiry_date ?? ""}
            disabled={pending}
            className="input w-[150px] py-1"
            onChange={(e) => save({ expiry: e.target.value || null })}
          />
        ) : <span className="text-muted">—</span>}
      </td>
      <td className="td">
        <input
          aria-label={`${def.label} note`}
          defaultValue={gate.note ?? ""}
          placeholder="Evidence location, query…"
          className="input min-w-[160px] py-1"
          onBlur={(e) => { if (e.target.value !== (gate.note ?? "")) save({ note: e.target.value }); }}
        />
      </td>
      <td className="td whitespace-nowrap text-xs text-muted">{updatedBy ? `${timeAgo(gate.updated_at)} · ${updatedBy}` : ""}</td>
    </tr>
  );
}

export function GapTicketsButton({ supplierId }: { supplierId: string }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult>({});
  return (
    <div className="flex items-center gap-2 text-sm">
      {r.message && <span className="text-ok">{r.message}</span>}
      {r.error && <span className="text-bad">{r.error}</span>}
      <button type="button" disabled={pending} className={btn.secondary} onClick={() => start(async () => setR(await raiseGapTickets(supplierId)))}>
        {pending ? "Raising…" : "Raise one ticket per critical gap"}
      </button>
    </div>
  );
}

export function FastTrackForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(approveFastTrack.bind(null, supplierId), {});
  const def = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-3 text-sm">
      <p className="text-muted">Lets purchasing continue while critical gates are closed, until the close-by date. You can&apos;t approve a supplier you created.</p>
      <div><label className="label" htmlFor="justification">Justification</label><textarea id="justification" name="justification" rows={2} required className="input" placeholder="e.g. UL incumbent; production authorised by Unilever Procurement and SLT" /></div>
      <div><label className="label" htmlFor="close_by">All critical gates closed by</label><input id="close_by" name="close_by" type="date" required defaultValue={def} className="input w-auto" /></div>
      {state.error && <p className="text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="text-ok" role="status">{state.message}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Approving…" : "Approve fast-track"}</button>
    </form>
  );
}
