"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormAction } from "@/components/vendor/action-form";
import { money } from "@/lib/vendor";

export type QuoteSpec = {
  title: string; spec_type: string; spec_form?: string | null; description: string | null; size_unit: string | null; hs_code?: string | null;
  versions: { name: string; quantity: number; finished_length: number | null; finished_width: number | null }[];
  product_category?: string | null; product_sub_type?: string | null; size_description?: string | null; material?: string | null; substrate_weight_gsm?: number | null;
  branding_method?: string | null; life_expectancy?: string | null; finished_style?: string | null; testing_checklist?: string[] | null; aql_level?: string | null;
  has_lighting_electronics?: boolean | null; lighting_electronics_detail?: string | null; units_per_inner?: number | null; units_per_outer?: number | null;
  carton_length_cm?: number | null; carton_width_cm?: number | null; carton_height_cm?: number | null; packing_method?: string | null;
  design_guidelines?: string | null; end_market?: string | null; reusable?: boolean | null; number_of_uses?: number | null; designed_for_disassembly?: boolean | null;
  recycled_content_percent?: number | null; origin_country?: string | null; unit_of_measure?: string | null; moq?: number | null; components?: string[];
};
export type QuoteDeliveryPoint = { id: string; point_no: number; label: string; address: string | null; country: string | null; quantity: number | null; delivery_date: string | null };
export type QuoteLine = {
  id: string; line_no: number; quantity_breaks: number[]; target_prices: number[] | null; notes: string | null;
  variant_label?: string | null; run_on_quantity?: number | null; delivery_date?: string | null; incoterm?: string | null;
  spec_revision_sent?: number | null; spec_revision?: number | null; spec_changes?: { revision: number; note: string | null; at: string }[];
  delivery_points?: QuoteDeliveryPoint[];
  spec: QuoteSpec;
};
export type QuotePrice = { line_id: string; quantity: number; unit_price: number; lead_time_days: number | null };
export type QuoteDetail = {
  line_id: string; lead_time_days: number | null; carton_length_cm: number | null; carton_width_cm: number | null; carton_height_cm: number | null;
  units_per_carton: number | null; gross_weight_kg: number | null; net_weight_kg: number | null; hs_code: string | null; country_of_origin: string | null;
  run_on_price: number | null; sample_cost: number | null; sample_lead_time_days: number | null; recycled_content_percent: number | null;
  reusable: boolean | null; number_of_uses: number | null; proposed_spec: string | null; notes: string | null;
};
export type QuoteAlt = { line_id: string; alt_no: number; description: string; quantity: number; unit_price: number; lead_time_days: number | null };
export type QuotePointPrice = { delivery_point_id: string; quantity: number; unit_price: number };

const TESTS: Record<string, string> = { pre_screen: "Pre-screen", lab_test: "Lab test", full_inspection: "Full inspection", drop_test: "Drop test", loading_test: "Loading test", final_inspection: "Final inspection" };
const v = (x: unknown) => (x == null ? "" : String(x));

/** The structured spec, as the supplier needs it to quote. */
export function SpecSummary({ spec }: { spec: QuoteSpec }) {
  const facts: [string, string | null][] = [
    ["Category", [spec.product_category, spec.product_sub_type].filter(Boolean).join(" · ") || null],
    ["Size", spec.size_description ?? null], ["Material", [spec.material, spec.substrate_weight_gsm ? `${spec.substrate_weight_gsm} gsm` : null].filter(Boolean).join(", ") || null],
    ["Branding", spec.branding_method ?? null], ["Style", spec.finished_style ?? null], ["Life expectancy", spec.life_expectancy ?? null],
    ["Components", spec.components?.length ? spec.components.join(", ") : null],
    ["Testing", spec.testing_checklist?.length ? spec.testing_checklist.map((t) => TESTS[t] ?? t).join(", ") : null], ["AQL", spec.aql_level ?? null],
    ["Lighting / electronics", spec.has_lighting_electronics ? spec.lighting_electronics_detail ?? "Yes" : null],
    ["Packing", [spec.units_per_inner ? `${spec.units_per_inner} per inner` : null, spec.units_per_outer ? `${spec.units_per_outer} per outer` : null,
      spec.carton_length_cm ? `carton ${spec.carton_length_cm} x ${spec.carton_width_cm ?? "?"} x ${spec.carton_height_cm ?? "?"} cm` : null, spec.packing_method].filter(Boolean).join(", ") || null],
    ["Design guidelines", spec.design_guidelines ?? null], ["End market", spec.end_market ?? null],
    ["Sustainability", [spec.reusable ? `reusable${spec.number_of_uses ? ` (${spec.number_of_uses} uses)` : ""}` : null, spec.designed_for_disassembly ? "designed for disassembly" : null,
      spec.recycled_content_percent != null ? `${spec.recycled_content_percent}% recycled` : null].filter(Boolean).join(", ") || null],
    ["HS code", spec.hs_code ?? null], ["MOQ", spec.moq ? `${spec.moq} ${spec.unit_of_measure ?? ""}` : null],
  ];
  const shown = facts.filter(([, x]) => x);
  if (!shown.length) return null;
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {shown.map(([k, x]) => <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline text-muted">{x}</dd></div>)}
    </dl>
  );
}

function Num({ name, label, value, width = "max-w-[140px]" }: { name: string; label: string; value: unknown; width?: string }) {
  return (
    <label className="block text-xs">
      <span className="label">{label}</span>
      <input name={name} inputMode="decimal" defaultValue={v(value)} className={`input ${width}`} />
    </label>
  );
}

/**
 * Price per quantity break (per unit only; totals are previews and the server recalculates), plus per-line packing, weights,
 * HS code, origin, lead time, run-on and sample costs, emissions declaration, prices per delivery point, a proposed spec for
 * ideation briefs and up to two alternative proposals.
 */
export function QuoteForm({ rfqId, currency, lines, prices, details = [], alternatives = [], pointPrices = [], leadTime, notes, submitted, action }: {
  rfqId: string; currency: string; lines: QuoteLine[]; prices: QuotePrice[]; details?: QuoteDetail[]; alternatives?: QuoteAlt[]; pointPrices?: QuotePointPrice[];
  leadTime: number | null; notes: string | null; submitted: boolean; action: FormAction;
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
      {lines.map((l) => {
        const d = details.find((x) => x.line_id === l.id);
        const alts = alternatives.filter((a) => a.line_id === l.id);
        const pts = l.delivery_points ?? [];
        const proposal = l.spec.spec_form === "ideation" || l.spec.spec_form === "open";
        return (
          <section key={l.id} className="rounded-xl border border-line">
            <div className="border-b border-line px-4 py-3">
              <p className="font-semibold">Line {l.line_no}: {l.spec.title}{l.variant_label ? ` (${l.variant_label})` : ""}</p>
              <p className="text-xs text-muted">{[l.spec.spec_type?.toUpperCase(), l.spec.spec_form === "ideation" ? "IDEATION BRIEF: propose the spec" : l.spec.spec_form === "open" ? "OPEN SPEC: suggestions welcome" : null, l.spec.description].filter(Boolean).join(" · ")}</p>
              {l.spec.versions.length > 0 && (
                <p className="mt-1 text-xs text-muted">Versions: {l.spec.versions.map((x) => `${x.name} (${x.quantity}${x.finished_length && x.finished_width ? `, ${x.finished_length} x ${x.finished_width} ${l.spec.size_unit ?? "mm"}` : ""})`).join("; ")}</p>
              )}
              <SpecSummary spec={l.spec} />
              <p className="mt-1 text-xs text-muted">{[l.incoterm ? `Incoterm ${l.incoterm}` : null, l.delivery_date ? `Deliver by ${l.delivery_date}` : null].filter(Boolean).join(" · ")}</p>
              {l.notes && <p className="mt-1 text-xs"><b>Note from adm Indicia:</b> {l.notes}</p>}
              {(l.spec_changes?.length ?? 0) > 0 && (
                <div className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                  <b>Spec changed since it was sent (revision {l.spec_revision_sent ?? 1} → {l.spec_revision}).</b> {l.spec_changes!.map((c) => `Revision ${c.revision}: ${c.note ?? ""}`).join(" · ")} Please check your prices and resubmit.
                </div>
              )}
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
                        <td className="td"><input name={`price:${k}`} inputMode="decimal" className="input max-w-[150px]" value={vals[k] ?? ""} onChange={(e) => setVals((x) => ({ ...x, [k]: e.target.value }))} aria-label={`Unit price for ${q}`} /></td>
                        <td className="td"><input name={`lead:${k}`} inputMode="numeric" className="input max-w-[110px]" defaultValue={String(leadOf(l.id, q))} aria-label={`Lead time for ${q}`} /></td>
                        <td className="td text-right tabular-nums">{Number.isFinite(n) && vals[k] ? money(n * q, currency) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="border-t border-line px-4 py-3" open={!!d || alts.length > 0}>
              <summary className="cursor-pointer text-sm font-semibold">Packing, shipping, samples, emissions{pts.length ? ", delivery points" : ""} and alternatives</summary>
              <div className="mt-3 space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Num name={`d:${l.id}:carton_length_cm`} label="Carton length (cm)" value={d?.carton_length_cm} />
                  <Num name={`d:${l.id}:carton_width_cm`} label="Carton width (cm)" value={d?.carton_width_cm} />
                  <Num name={`d:${l.id}:carton_height_cm`} label="Carton height (cm)" value={d?.carton_height_cm} />
                  <Num name={`d:${l.id}:units_per_carton`} label="Units per carton" value={d?.units_per_carton} />
                  <Num name={`d:${l.id}:net_weight_kg`} label="Net weight per unit (kg)" value={d?.net_weight_kg} />
                  <Num name={`d:${l.id}:gross_weight_kg`} label="Gross weight per unit (kg)" value={d?.gross_weight_kg} />
                  <label className="block text-xs"><span className="label">HS code</span><input name={`d:${l.id}:hs_code`} defaultValue={v(d?.hs_code ?? l.spec.hs_code)} className="input max-w-[140px]" /></label>
                  <label className="block text-xs"><span className="label">Country of origin</span><input name={`d:${l.id}:country_of_origin`} defaultValue={v(d?.country_of_origin)} className="input max-w-[180px]" /></label>
                  <Num name={`d:${l.id}:lead_time_days`} label="Lead time for this line (days)" value={d?.lead_time_days} />
                </div>
                <div className="flex flex-wrap gap-3">
                  {l.run_on_quantity ? <Num name={`d:${l.id}:run_on_price`} label={`Run-on: price per extra ${l.run_on_quantity.toLocaleString("en-GB")} units (${currency})`} value={d?.run_on_price} width="max-w-[200px]" /> : null}
                  <Num name={`d:${l.id}:sample_cost`} label={`Sample cost (${currency})`} value={d?.sample_cost} />
                  <Num name={`d:${l.id}:sample_lead_time_days`} label="Sample lead time (days)" value={d?.sample_lead_time_days} />
                </div>
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="mb-1 text-xs font-bold">Emissions declaration</legend>
                  <Num name={`d:${l.id}:recycled_content_percent`} label="Recycled content (%)" value={d?.recycled_content_percent} />
                  <label className="block text-xs"><span className="label">Reusable</span>
                    <select name={`d:${l.id}:reusable`} defaultValue={d?.reusable == null ? "" : d.reusable ? "yes" : "no"} className="input max-w-[120px]"><option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option></select>
                  </label>
                  <Num name={`d:${l.id}:number_of_uses`} label="Number of uses" value={d?.number_of_uses} />
                </fieldset>
                {pts.length > 0 && (
                  <fieldset>
                    <legend className="mb-1 text-xs font-bold">Unit price per delivery point (only if it differs from the price above)</legend>
                    <div className="flex flex-wrap gap-3">
                      {pts.map((p) => (
                        <Num key={p.id} name={`dp:${p.id}`} label={`${p.label}${p.quantity ? ` (${p.quantity.toLocaleString("en-GB")})` : ""}${p.country ? `, ${p.country}` : ""}`}
                          value={pointPrices.find((x) => x.delivery_point_id === p.id)?.unit_price} width="max-w-[160px]" />
                      ))}
                    </div>
                  </fieldset>
                )}
                {proposal && (
                  <label className="block text-xs"><span className="label">Your proposed spec</span>
                    <textarea name={`d:${l.id}:proposed_spec`} rows={3} maxLength={4000} defaultValue={v(d?.proposed_spec)} className="input" placeholder="Materials, sizes, finishes and branding you recommend, and why" />
                  </label>
                )}
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-xs font-bold">Alternative proposals (optional): another option with its own price</legend>
                  {[1, 2].map((n) => {
                    const a = alts[n - 1];
                    return (
                      <div key={n} className="flex flex-wrap items-end gap-3">
                        <label className="block min-w-[240px] flex-1 text-xs"><span className="label">Alternative {n}: what is different</span><input name={`alt:${l.id}:${n}:description`} defaultValue={v(a?.description)} maxLength={500} className="input" placeholder="e.g. Recycled cotton, same print" /></label>
                        <Num name={`alt:${l.id}:${n}:quantity`} label="Quantity" value={a?.quantity ?? ""} width="max-w-[110px]" />
                        <Num name={`alt:${l.id}:${n}:unit_price`} label={`Unit price (${currency})`} value={a?.unit_price} width="max-w-[130px]" />
                        <Num name={`alt:${l.id}:${n}:lead_time_days`} label="Lead time (days)" value={a?.lead_time_days} width="max-w-[110px]" />
                      </div>
                    );
                  })}
                </fieldset>
                <label className="block text-xs"><span className="label">Notes on this line</span><input name={`d:${l.id}:notes`} defaultValue={v(d?.notes)} maxLength={500} className="input" /></label>
              </div>
            </details>
          </section>
        );
      })}
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <div><label className="label" htmlFor="lead_time_days">Overall lead time (days)</label><input id="lead_time_days" name="lead_time_days" inputMode="numeric" className="input" defaultValue={leadTime ?? ""} /></div>
        <div><label className="label" htmlFor="notes">Notes for adm Indicia</label><textarea id="notes" name="notes" rows={2} maxLength={2000} className="input" defaultValue={notes ?? ""} placeholder="Assumptions, packing, delivery terms…" /></div>
      </div>
      <p className="text-sm">Total at the first quantity break: <b className="tabular-nums">{money(firstBreakTotal, currency)}</b> <span className="text-xs text-muted">(we calculate totals from your unit prices)</span></p>
    </ActionForm>
  );
}
