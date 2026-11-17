"use client";

import { useState } from "react";
import { ActionForm } from "@/components/sourcing/action-form";
import { addJobDeliveries } from "@/app/(platform)/logistics/actions";

export type PoOption = { id: string; po_number: string; supplier_name: string; delivery_date: string | null; lines: { spec_id: string; label: string; on_po: number; planned: number }[] };
type Market = { code: string; name: string };

/** Add several destinations to one purchase order at once. Each row is one destination for one spec; add as many rows as you need. */
export function JobDeliveryForm({ jobId, pos, markets, defaultMarket }: { jobId: string; pos: PoOption[]; markets: Market[]; defaultMarket: string }) {
  const [poId, setPoId] = useState(pos[0]?.id ?? "");
  const [rows, setRows] = useState([0, 1]);
  const [next, setNext] = useState(2);
  const po = pos.find((p) => p.id === poId);
  if (pos.length === 0) return <p className="text-sm text-muted">Deliveries can be added once a supplier PO is issued.</p>;

  return (
    <ActionForm action={addJobDeliveries} hidden={{ job_id: jobId, count: rows.length > 0 ? Math.max(...rows) + 1 : 0 }} submit="Add these deliveries" pendingLabel="Adding…">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="label">Purchase order</span>
          <select name="po_id" value={poId} onChange={(e) => setPoId(e.target.value)} className="input">
            {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number} · {p.supplier_name}</option>)}
          </select>
        </label>
        <p className="self-end text-xs text-muted">{po?.lines.map((l) => `${l.label}: ${l.planned.toLocaleString("en-GB")} of ${l.on_po.toLocaleString("en-GB")} planned`).join(" · ")}</p>
      </div>

      <div className="space-y-3">
        {rows.map((i, n) => (
          <fieldset key={`${poId}-${i}`} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-6">
            <legend className="px-1 text-xs font-semibold text-muted">Destination {n + 1}</legend>
            <label className="block text-xs sm:col-span-2"><span className="label">Spec</span>
              <select name={`r${i}_spec_id`} className="input" defaultValue={po?.lines[0]?.spec_id}>{po?.lines.map((l) => <option key={l.spec_id} value={l.spec_id}>{l.label}</option>)}</select>
            </label>
            <label className="block text-xs"><span className="label">Quantity</span><input name={`r${i}_quantity`} inputMode="numeric" className="input" placeholder="e.g. 500" /></label>
            <label className="block text-xs sm:col-span-3"><span className="label">Recipient</span><input name={`r${i}_recipient_name`} className="input" placeholder="Store or person" /></label>
            <label className="block text-xs sm:col-span-2"><span className="label">Address</span><input name={`r${i}_address_line`} className="input" /></label>
            <label className="block text-xs"><span className="label">City</span><input name={`r${i}_city`} className="input" /></label>
            <label className="block text-xs"><span className="label">Postcode</span><input name={`r${i}_postcode`} className="input" /></label>
            <label className="block text-xs"><span className="label">Market</span>
              <select name={`r${i}_market`} className="input" defaultValue={defaultMarket}>{markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
            </label>
            <label className="block text-xs"><span className="label">Deliver by</span><input name={`r${i}_planned_delivery_date`} type="date" defaultValue={po?.delivery_date ?? ""} className="input" /></label>
            {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter((x) => x !== i))} className="self-end text-xs font-semibold text-bad hover:underline">Remove</button>}
          </fieldset>
        ))}
      </div>
      <button type="button" onClick={() => { setRows([...rows, next]); setNext(next + 1); }} className="text-sm font-semibold text-accent hover:underline">+ Add another destination</button>
    </ActionForm>
  );
}
