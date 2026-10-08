"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/(platform)/assure/actions";
import { CLIENTS, REGIONS, type Supplier } from "@/lib/srt";
import { btn } from "@/components/ui";

type Opt = { id: string; name: string };

export function SupplierForm({
  action: serverAction, supplier, people, submitLabel,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  supplier?: Supplier;
  people: Opt[];
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(serverAction, {});
  const s = supplier;
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Supplier name</label><input id="name" name="name" required defaultValue={s?.name} className="input" placeholder="Registered company name" /></div>
        <div><label className="label" htmlFor="supplier_code">Supplier ID</label><input id="supplier_code" name="supplier_code" defaultValue={s?.supplier_code ?? ""} className="input" placeholder="Stocktool / NAV ID" /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><label className="label" htmlFor="market">Market</label><input id="market" name="market" defaultValue={s?.market ?? ""} className="input" placeholder="e.g. China" /></div>
        <div>
          <label className="label" htmlFor="region">Region</label>
          <select id="region" name="region" defaultValue={s?.region ?? ""} className="input"><option value="">—</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="client">Client</label>
          <select id="client" name="client" defaultValue={s?.client ?? ""} className="input"><option value="">—</option>{CLIENTS.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div><label className="label" htmlFor="category">Category</label><input id="category" name="category" defaultValue={s?.category ?? ""} className="input" placeholder="Print, POSM, Logistics" /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="primary_contact_email">Vendor contact email</label><input id="primary_contact_email" name="primary_contact_email" type="email" defaultValue={s?.primary_contact_email ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="ytd_spend">YTD spend (€)</label><input id="ytd_spend" name="ytd_spend" type="number" min={0} step={1000} defaultValue={s ? Number(s.ytd_spend) : 0} className="input" /></div>
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={s ? s.active : true} /> Active</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="strategic" defaultChecked={s?.strategic} /> Strategic / Core</label>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="srt_owner">SRT owner</label>
          <select id="srt_owner" name="srt_owner" defaultValue={s?.srt_owner ?? ""} className="input"><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <p className="mt-1 text-xs text-muted">Identifies gaps, tracks them, confirms when the supplier is back to green.</p>
        </div>
        <div>
          <label className="label" htmlFor="procurement_owner">In-market procurement owner</label>
          <select id="procurement_owner" name="procurement_owner" defaultValue={s?.procurement_owner ?? ""} className="input"><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <p className="mt-1 text-xs text-muted">Gets missing documents and signatures from the vendor.</p>
        </div>
      </div>
      <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} defaultValue={s?.notes ?? ""} className="input" placeholder="Context, exceptions, client permissions" /></div>
      {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-ok" role="status">{state.message}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
