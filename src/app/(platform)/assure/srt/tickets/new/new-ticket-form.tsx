"use client";

import { useActionState, useState } from "react";
import { createTicket, type ActionResult } from "@/app/(platform)/assure/actions";
import { CLIENTS, PRIORITIES, TICKET_TYPES } from "@/lib/srt";
import { btn } from "@/components/ui";

type Opt = { id: string; name: string };

export function NewTicketForm({
  suppliers, people, gates, defaults,
}: {
  suppliers: (Opt & { market: string | null })[];
  people: Opt[];
  gates: { key: string; label: string }[];
  defaults: { supplier?: string; gate?: string; type?: string };
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createTicket, {});
  const [supplier, setSupplier] = useState(defaults.supplier ?? "");

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="type">Ticket type</label>
          <select id="type" name="type" defaultValue={defaults.type ?? "missing_document"} className="input">
            {TICKET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="priority">Priority</label>
          <select id="priority" name="priority" defaultValue="normal" className="input">
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="title">Title</label>
        <input id="title" name="title" required className="input" placeholder="e.g. Signed MSA missing for Shanghai Print Co" />
      </div>
      <div>
        <label className="label" htmlFor="supplier_id">Supplier</label>
        <select id="supplier_id" name="supplier_id" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="input">
          <option value="">Not yet a supplier (new request)</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.market ? ` (${s.market})` : ""}</option>)}
        </select>
      </div>
      {!supplier && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="prospect_name">New vendor name</label>
            <input id="prospect_name" name="prospect_name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="client">Client</label>
            <select id="client" name="client" className="input" defaultValue="">
              <option value="">—</option>
              {CLIENTS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="market">Market</label>
            <input id="market" name="market" className="input" placeholder="e.g. China" />
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="gate_key">Onboarding gate</label>
          <select id="gate_key" name="gate_key" defaultValue={defaults.gate ?? ""} className="input">
            <option value="">None</option>
            {gates.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="assignee">SRT assignee</label>
          <select id="assignee" name="assignee" defaultValue="" className="input">
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="owner">Procurement owner</label>
          <select id="owner" name="owner" defaultValue="" className="input">
            <option value="">None</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="description">Details</label>
        <textarea id="description" name="description" rows={4} className="input" placeholder="What is needed, from whom, and any context" />
      </div>
      {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Raising…" : "Raise ticket"}</button>
    </form>
  );
}
