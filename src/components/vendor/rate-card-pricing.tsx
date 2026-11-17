"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormAction } from "@/components/vendor/action-form";

export type PricingItem = {
  id: string; subcode: string; product_type: string; product_code: string | null; channel: string; category: string | null; uom: string | null;
  qty_min: number | null; qty_max: number | null; spec_detail: string | null; price: number | null;
};

const num = (n: number | null) => (n == null ? "no limit" : Number(n).toLocaleString("en-GB"));

/** The vendor's pricing grid: one price per item and quantity tier, grouped by product. Saving a draft keeps it private; sending tells the team. */
export function RateCardPricing({ programme, currency, items, closed, canAct, submitted, action }: {
  programme: string; currency: string; items: PricingItem[]; closed: boolean; canAct: boolean; submitted: boolean; action: FormAction;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.price == null ? "" : String(i.price)])));
  const [filter, setFilter] = useState("");
  const priced = Object.values(vals).filter((v) => v.trim() !== "").length;
  const groups = useMemo(() => {
    const g = new Map<string, PricingItem[]>();
    for (const i of items) {
      if (filter && !`${i.product_type} ${i.subcode} ${i.product_code ?? ""}`.toLowerCase().includes(filter.toLowerCase())) continue;
      const k = `${i.product_type}${i.product_code ? ` · ${i.product_code}` : ""}`;
      g.set(k, [...(g.get(k) ?? []), i]);
    }
    return [...g.entries()];
  }, [items, filter]);
  const disabled = closed || !canAct;

  return (
    <ActionForm action={action} hidden={{ programme }} className="flex flex-col gap-4"
      submit={disabled ? undefined : submitted ? "Update sent prices" : "Send prices"} secondary={disabled || submitted ? undefined : [{ label: "Save draft", intent: "draft" }]}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm"><b className="tabular-nums">{priced}</b> of {items.length} priced</p>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="input max-w-xs" />
      </div>
      {groups.map(([name, rows]) => (
        <section key={name} className="rounded-xl border border-line">
          <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold">{name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Item</th><th className="th">Quantity tier</th><th className="th">Unit</th><th className="th">Your unit price ({currency})</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="td"><span className="font-mono text-xs">{r.subcode}</span><div className="text-xs text-muted">{r.channel}{r.category ? ` · ${r.category}` : ""}</div>
                      {r.spec_detail && <details className="mt-1"><summary className="cursor-pointer text-xs text-accent">Specification</summary><p className="mt-1 max-w-md whitespace-pre-line text-xs text-muted">{r.spec_detail}</p></details>}</td>
                    <td className="td tabular-nums">{num(r.qty_min)} to {num(r.qty_max)}</td>
                    <td className="td">{r.uom ?? ""}</td>
                    <td className="td"><input name={`price:${r.id}`} inputMode="decimal" disabled={disabled} className="input max-w-[170px]" value={vals[r.id] ?? ""}
                      onChange={(e) => setVals((x) => ({ ...x, [r.id]: e.target.value }))} aria-label={`Price for ${r.subcode}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {groups.length === 0 && <p className="text-sm text-muted">No item matches.</p>}
      {closed && <p className="text-sm text-muted">Pricing for this programme has closed.</p>}
    </ActionForm>
  );
}
