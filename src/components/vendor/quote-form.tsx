"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormAction } from "@/components/vendor/action-form";
import { money } from "@/lib/vendor";

export type QuoteLine = {
  id: string; line_no: number; quantity_breaks: number[]; target_prices: number[] | null; notes: string | null;
  spec: { title: string; spec_type: string; description: string | null; size_unit: string | null; versions: { name: string; quantity: number; finished_length: number | null; finished_width: number | null }[] };
};
export type QuotePrice = { line_id: string; quantity: number; unit_price: number; lead_time_days: number | null };

/** Price per quantity break, with a lead time per break and overall. Totals are previews; the server recalculates. */
export function QuoteForm({ rfqId, currency, lines, prices, leadTime, notes, submitted, action }: {
  rfqId: string; currency: string; lines: QuoteLine[]; prices: QuotePrice[]; leadTime: number | null; notes: string | null; submitted: boolean; action: FormAction;
}) {
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of prices) m[`${p.line_id}:${p.quantity}`] = String(p.unit_price);
    return m;
  }, [prices]);
  const [vals, setVals] = useState(initial);
  const leadOf = (l: string, q: number) => prices.find((p) => p.line_id === l && p.quantity === q)?.lead_time_days ?? "";
  const firstBreakTotal = lines.reduce((sum, l) => sum + (Number(vals[`${l.id}:${l.quantity_breaks[0]}`]) || 0) * l.quantity_breaks[0], 0);

  return (
    <ActionForm action={action} hidden={{ rfq: rfqId }} submit={submitted ? "Update submitted quote" : "Submit quote"}
      secondary={submitted ? undefined : [{ label: "Save draft", intent: "draft" }]} className="flex flex-col gap-5">
      {lines.map((l) => (
        <section key={l.id} className="rounded-xl border border-line">
          <div className="border-b border-line px-4 py-3">
            <p className="font-semibold">Line {l.line_no}: {l.spec.title}</p>
            <p className="text-xs text-muted">{[l.spec.spec_type?.toUpperCase(), l.spec.description].filter(Boolean).join(" · ")}</p>
            {l.spec.versions.length > 0 && (
              <p className="mt-1 text-xs text-muted">Versions: {l.spec.versions.map((v) => `${v.name} (${v.quantity}${v.finished_length && v.finished_width ? `, ${v.finished_length} x ${v.finished_width} ${l.spec.size_unit ?? "mm"}` : ""})`).join("; ")}</p>
            )}
            {l.notes && <p className="mt-1 text-xs"><b>Note from adm Indicia:</b> {l.notes}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Quantity</th>{l.target_prices && <th className="th">Target unit price</th>}<th className="th">Your unit price ({currency})</th><th className="th">Lead time (days)</th><th className="th text-right">Line total</th></tr></thead>
              <tbody>
                {l.quantity_breaks.map((q, i) => {
                  const k = `${l.id}:${q}`;
                  const n = Number(vals[k]);
                  return (
                    <tr key={q}>
                      <td className="td tabular-nums font-semibold">{q.toLocaleString("en-GB")}{i === 0 && <span className="ml-1 text-[0.65rem] font-bold uppercase text-muted">required</span>}</td>
                      {l.target_prices && <td className="td tabular-nums text-muted">{money(l.target_prices[i], currency, 4)}</td>}
                      <td className="td"><input name={`price:${k}`} inputMode="decimal" className="input max-w-[150px]" value={vals[k] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} aria-label={`Unit price for ${q}`} /></td>
                      <td className="td"><input name={`lead:${k}`} inputMode="numeric" className="input max-w-[110px]" defaultValue={String(leadOf(l.id, q))} aria-label={`Lead time for ${q}`} /></td>
                      <td className="td text-right tabular-nums">{Number.isFinite(n) && vals[k] ? money(n * q, currency) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <div><label className="label" htmlFor="lead_time_days">Overall lead time (days)</label><input id="lead_time_days" name="lead_time_days" inputMode="numeric" className="input" defaultValue={leadTime ?? ""} /></div>
        <div><label className="label" htmlFor="notes">Notes for adm Indicia</label><textarea id="notes" name="notes" rows={2} maxLength={2000} className="input" defaultValue={notes ?? ""} placeholder="Assumptions, packing, delivery terms…" /></div>
      </div>
      <p className="text-sm">Total at the first quantity break: <b className="tabular-nums">{money(firstBreakTotal, currency)}</b></p>
    </ActionForm>
  );
}
