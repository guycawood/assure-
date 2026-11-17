"use client";

import { useState, useTransition } from "react";
import { Card, Panel, Pill, btn } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { PEF_STAGES, STAGE_LABEL, type PefComponentInput, type PefInput } from "@/lib/pef";
import { fmt } from "../../format";
import { runPef, type CalcResult } from "./actions";

export type PefOptions = {
  substrates: string[];
  countries: { code: string; name: string }[];
  coatings: string[];
  printing: string[];
  branding: string[];
  periods: { label: string; hours: number }[];
  presets: { code: string; label: string; input: PefInput; excel: { totalGwp: number; singleScoreMpt: number } }[];
};

const SUPPLIER_TYPES = ["Manufacturer", "Printer", "Trader", "Retailer"];
const POWER = ["No", "Yes, Power Grid", "Yes, Batteries", "Yes, Solar"];
const blankComponent = (): PefComponentInput => ({ name: "", weightKg: 0, recycledPercent: null, coating: null, coatingKg: null, coatingM2: null, atLeastMinSize: true });
const START: PefInput = {
  shipFrom: "GB", shipTo: "FR", factoryRenewable: false, supplierType: "Manufacturer",
  components: [blankComponent()], printing: null, branding: null, transport: null, usageHours: null, usagePeriod: null,
  electronics: { source: "No", kwhPerHour: 0 }, lighting: { source: "No", kwhPerHour: 0 }, easySeparation: false,
};
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const MAX_SUBSTRATES = 10;

export { START as PEF_START, blankComponent as pefBlankComponent };

/** The PEF calculator on its own: the specification form and its results side by side. */
export function Calculator({ options }: { options: PefOptions }) {
  const [input, setInput] = useState<PefInput>(START);
  const [preset, setPreset] = useState<string>("");
  const [out, setOut] = useState<CalcResult | null>(null);
  const [pending, start] = useTransition();
  const calculate = () => start(async () => setOut(await runPef(input)));
  const excel = options.presets.find((p) => p.code === preset)?.excel;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <PefSpecForm options={options} input={input} setInput={setInput} preset={preset} onPreset={(code) => { setPreset(code); setOut(null); }} />
        <button type="button" className={`${btn.primary} w-full`} disabled={pending} onClick={calculate}>
          <MSymbol name="calculate" size={18} /> {pending ? "Calculating…" : "Calculate"}
        </button>
      </div>
      <div className="min-w-0 space-y-4"><PefResultsView out={out} excel={excel} /></div>
    </div>
  );
}

/** PEF results, or the prompt to calculate. */
export function PefResultsView({ out, excel }: { out: CalcResult | null; excel?: { totalGwp: number; singleScoreMpt: number } }) {
  if (!out) return <Card className="p-8 text-sm text-muted">Fill in the specification, or start from a worked example, and calculate. Results show by stage and impact category with every activity used.</Card>;
  if (!out.ok) return <Card className="p-5 text-sm text-bad">{out.message}</Card>;
  return <Results out={out} excel={excel} />;
}

/**
 * The product specification the PEF model reads: substrates, coatings, printing and branding, transport and use.
 * Controlled, so the Impact Grade calculator can read the same specification.
 */
export function PefSpecForm({ options, input, setInput, preset, onPreset }: {
  options: PefOptions; input: PefInput; setInput: (fn: (i: PefInput) => PefInput) => void; preset: string; onPreset: (code: string) => void;
}) {
  const set = (patch: Partial<PefInput>) => setInput((i) => ({ ...i, ...patch }));
  const setComp = (n: number, patch: Partial<PefComponentInput>) =>
    setInput((i) => ({ ...i, components: i.components.map((c, k) => (k === n ? { ...c, ...patch } : c)) }));
  const t = input.transport ?? {};
  const setT = (patch: Record<string, unknown>) => set({ transport: { ...t, ...patch } });
  function loadPreset(code: string) {
    onPreset(code);
    const p = options.presets.find((x) => x.code === code);
    if (p) setInput(() => ({ ...START, ...p.input, components: p.input.components.map((c) => ({ ...blankComponent(), ...c })) }));
  }

  return (
      <div className="space-y-4">
        <Card className="space-y-3 p-5 text-sm">
          <label className="block"><span className="label">Start from a worked example</span>
            <select className="input" value={preset} onChange={(e) => loadPreset(e.target.value)}>
              <option value="">Blank</option>
              {options.presets.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Ships from (factory)</span>
              <select className="input" value={input.shipFrom} onChange={(e) => set({ shipFrom: e.target.value })}>
                {options.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select></label>
            <label><span className="label">Ships to (market)</span>
              <select className="input" value={input.shipTo} onChange={(e) => set({ shipTo: e.target.value })}>
                {options.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select></label>
            <label><span className="label">Supplier type</span>
              <select className="input" value={input.supplierType} onChange={(e) => set({ supplierType: e.target.value })}>
                {SUPPLIER_TYPES.map((s) => <option key={s}>{s}</option>)}
              </select></label>
            <label className="flex items-center gap-2 pt-6"><input type="checkbox" checked={input.factoryRenewable} onChange={(e) => set({ factoryRenewable: e.target.checked })} /> Factory uses renewable energy</label>
          </div>
        </Card>

        <datalist id="pef-substrates">{options.substrates.map((s) => <option key={s} value={s} />)}</datalist>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
          <h3 className="font-bold">Substrates <span className="font-normal text-muted">({input.components.length} of {MAX_SUBSTRATES})</span></h3>
          {input.components.length < MAX_SUBSTRATES && (
            <button type="button" className={btn.primary} onClick={() => set({ components: [...input.components, blankComponent()] })}>
              <MSymbol name="add" size={18} /> Add a substrate
            </button>
          )}
        </div>
        {input.components.map((c, n) => (
          <Card key={n} className="space-y-3 p-5 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Substrate {n + 1}</h3>
              {input.components.length > 1 && <button type="button" className="text-xs font-semibold text-bad" onClick={() => set({ components: input.components.filter((_, k) => k !== n) })}>Remove</button>}
            </div>
            <label className="block"><span className="label">Substrate (Sourcing Hub name)</span>
              <input className="input" list="pef-substrates" value={c.name} onChange={(e) => setComp(n, { name: e.target.value })} placeholder="e.g. Folding Cardboard" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="label">Weight (kg)</span><input className="input" type="number" step="any" value={c.weightKg || ""} onChange={(e) => setComp(n, { weightKg: Number(e.target.value) })} /></label>
              <label><span className="label">Recycled content (%)</span><input className="input" type="number" step="any" placeholder="Default" value={c.recycledPercent ?? ""} onChange={(e) => setComp(n, { recycledPercent: numOrNull(e.target.value) })} /></label>
              <label className="col-span-2"><span className="label">Coating</span>
                <select className="input" value={c.coating ?? ""} onChange={(e) => setComp(n, { coating: e.target.value || null })}>
                  <option value="">None</option>{options.coatings.map((x) => <option key={x}>{x}</option>)}
                </select></label>
              {c.coating && <>
                <label><span className="label">Coating weight (kg)</span><input className="input" type="number" step="any" value={c.coatingKg ?? ""} onChange={(e) => setComp(n, { coatingKg: numOrNull(e.target.value) })} /></label>
                <label><span className="label">Coated area (m2)</span><input className="input" type="number" step="any" value={c.coatingM2 ?? ""} onChange={(e) => setComp(n, { coatingM2: numOrNull(e.target.value) })} /></label>
              </>}
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={c.atLeastMinSize !== false} onChange={(e) => setComp(n, { atLeastMinSize: e.target.checked })} /> Length and width both at least 5 cm</label>
            </div>
          </Card>
        ))}
        {/* The Anthesis workbook has columns for 3 substrates; the engine takes any number, so up to 10 here. */}
        {input.components.length < MAX_SUBSTRATES ? (
          <button type="button" className={btn.secondary} onClick={() => set({ components: [...input.components, blankComponent()] })}>
            <MSymbol name="add" size={18} /> Add a substrate <span className="font-normal text-muted">({input.components.length} of {MAX_SUBSTRATES})</span>
          </button>
        ) : <p className="text-xs text-muted">Up to {MAX_SUBSTRATES} substrates per specification.</p>}

        <Card className="space-y-3 p-5 text-sm">
          <h3 className="font-bold">Printing, branding and end of life</h3>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Printing</span>
              <select className="input" value={input.printing?.type ?? ""} onChange={(e) => set({ printing: e.target.value ? { type: e.target.value, areaM2: input.printing?.areaM2 ?? 0 } : null })}>
                <option value="">None</option>{options.printing.map((x) => <option key={x}>{x}</option>)}
              </select></label>
            <label><span className="label">Printed area (m2)</span><input className="input" type="number" step="any" disabled={!input.printing} value={input.printing?.areaM2 || ""} onChange={(e) => input.printing && set({ printing: { ...input.printing, areaM2: Number(e.target.value) } })} /></label>
            <label><span className="label">Branding</span>
              <select className="input" value={input.branding?.type ?? ""} onChange={(e) => set({ branding: e.target.value ? { type: e.target.value, areaM2: input.branding?.areaM2 ?? 0 } : null })}>
                <option value="">None</option>{options.branding.map((x) => <option key={x}>{x}</option>)}
              </select></label>
            <label><span className="label">Branded area (m2)</span><input className="input" type="number" step="any" disabled={!input.branding} value={input.branding?.areaM2 || ""} onChange={(e) => input.branding && set({ branding: { ...input.branding, areaM2: Number(e.target.value) } })} /></label>
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={input.easySeparation === true} onChange={(e) => set({ easySeparation: e.target.checked })} /> Materials separate easily (gate 3)</label>
          </div>
        </Card>

        <Card className="space-y-3 p-5 text-sm">
          <h3 className="font-bold">Transport <span className="font-normal text-muted">(blank = from Countries and routes)</span></h3>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Road at origin (km)</span><input className="input" type="number" step="any" value={t.roadOriginKm ?? ""} onChange={(e) => setT({ roadOriginKm: numOrNull(e.target.value) })} /></label>
            <label><span className="label">Road at destination (km)</span><input className="input" type="number" step="any" value={t.roadDestinationKm ?? ""} onChange={(e) => setT({ roadDestinationKm: numOrNull(e.target.value) })} /></label>
            <label><span className="label">Sea (km)</span><input className="input" type="number" step="any" value={t.seaKm ?? ""} onChange={(e) => setT({ seaKm: numOrNull(e.target.value) })} /></label>
            <label><span className="label">Air (km)</span><input className="input" type="number" step="any" value={t.airKm ?? ""} onChange={(e) => setT({ airKm: numOrNull(e.target.value) })} /></label>
          </div>
        </Card>

        <Card className="space-y-3 p-5 text-sm">
          <h3 className="font-bold">Use in store</h3>
          <label className="block"><span className="label">Activation period</span>
            <select className="input" value={input.usageHours !== null && input.usageHours !== undefined && !input.usagePeriod ? "__hours" : input.usagePeriod ?? ""}
              onChange={(e) => set(e.target.value === "__hours" ? { usagePeriod: null, usageHours: input.usageHours ?? 0 } : { usagePeriod: e.target.value || null, usageHours: null })}>
              <option value="">Not used</option>
              {options.periods.map((p) => <option key={p.label} value={p.label}>{p.label} ({p.hours} h)</option>)}
              <option value="__hours">Enter hours</option>
            </select></label>
          {!input.usagePeriod && input.usageHours !== null && input.usageHours !== undefined && (
            <label className="block"><span className="label">Total hours</span><input className="input" type="number" step="any" value={input.usageHours} onChange={(e) => set({ usageHours: Number(e.target.value) })} /></label>
          )}
          {(["electronics", "lighting"] as const).map((k) => (
            <div key={k} className="grid grid-cols-2 gap-3">
              <label><span className="label">{k === "electronics" ? "Electronics" : "Lighting"}</span>
                <select className="input" value={input[k]?.source ?? "No"} onChange={(e) => set({ [k]: { source: e.target.value, kwhPerHour: input[k]?.kwhPerHour ?? 0 } })}>
                  {POWER.map((p) => <option key={p}>{p}</option>)}
                </select></label>
              <label><span className="label">kWh per hour</span><input className="input" type="number" step="any" value={input[k]?.kwhPerHour || ""} onChange={(e) => set({ [k]: { source: input[k]?.source ?? "No", kwhPerHour: Number(e.target.value) } })} /></label>
            </div>
          ))}
        </Card>
      </div>
  );
}

function Results({ out, excel }: { out: Extract<CalcResult, { ok: true }>; excel?: { totalGwp: number; singleScoreMpt: number } }) {
  const r = out.result;
  const totalMpt = r.singleScoreMpt || 1;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <p className="eyebrow">PEF score (weighted single score)</p>
          <p className="mt-1 font-display text-[1.75rem] font-bold leading-none tabular-nums">{fmt(r.singleScoreMpt)} <span className="text-base text-muted">mPt</span></p>
          {excel && <p className="mt-1.5 text-xs text-muted">Excel: {fmt(excel.singleScoreMpt)} mPt</p>}
        </Card>
        <Card className="p-5">
          <p className="eyebrow">Climate change</p>
          <p className="mt-1 font-display text-[1.75rem] font-bold leading-none tabular-nums">{fmt(r.total.GWP)} <span className="text-base text-muted">kg CO2e</span></p>
          {excel && <p className="mt-1.5 text-xs text-muted">Excel: {fmt(excel.totalGwp)} kg CO2e</p>}
        </Card>
      </section>
      <p className="flex items-center gap-1.5 text-xs text-muted"><MSymbol name="info" size={15} /> This is the PEF score. It is half of the Impact Grade (0-100, A-E), scaled against the 95th percentile of our PEF scores: see section 2.</p>

      {r.warnings.length > 0 && (
        <Card className="border-warn/40 p-4 text-sm">
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-warn"><MSymbol name="warning" size={18} /> Gaps in the data (counted as zero, not as no impact)</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Card>
      )}

      <Panel title="By life-cycle stage">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Stage</th><th className="th text-right">kg CO2e</th><th className="th text-right">mPt</th><th className="th w-1/3">Share of score</th></tr></thead>
          <tbody>
            {PEF_STAGES.map((s) => {
              const share = Math.max(0, out.stageScoresMpt[s] / totalMpt);
              return (
                <tr key={s}>
                  <td className="td font-semibold">{STAGE_LABEL[s]}</td>
                  <td className="td text-right tabular-nums">{fmt(r.stages[s].GWP)}</td>
                  <td className="td text-right tabular-nums">{fmt(out.stageScoresMpt[s])}</td>
                  <td className="td"><div className="h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand-sustainability" style={{ width: `${Math.min(100, share * 100)}%` }} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="By impact category" sub="Total, then normalised and weighted (EF 3.1). The weighted values add up to the single score.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Category</th><th className="th text-right">Total</th><th className="th">Unit</th><th className="th text-right">Weighted (mPt)</th></tr></thead>
            <tbody>
              {out.categories.map((c) => (
                <tr key={c.code}>
                  <td className="td"><span className="font-semibold">{c.name}</span> <span className="text-xs text-muted">{c.code}</span></td>
                  <td className="td text-right tabular-nums">{fmt(r.total[c.code as keyof typeof r.total])}</td>
                  <td className="td text-xs text-muted">{c.unit}</td>
                  <td className="td text-right tabular-nums">{fmt(r.weighted[c.code as keyof typeof r.weighted] * 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Substrates and end-of-life gates" sub={`Mono-material: ${r.product.mono ? "yes" : "no"} · can be separated: ${r.product.canSeparate ? "yes" : "no"} · renewable manufacturer: ${r.product.renewableManufacturer ? "yes" : "no"}`}>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Substrate</th><th className="th text-right">Virgin kg</th><th className="th text-right">Recycled kg</th><th className="th">Classification</th><th className="th">Gates 1 · 4 · 5</th><th className="th">Recycled at end of life</th></tr></thead>
          <tbody>
            {r.components.map((c) => (
              <tr key={c.name}>
                <td className="td font-semibold">{c.name}</td>
                <td className="td text-right tabular-nums">{fmt(c.virginKg)}</td>
                <td className="td text-right tabular-nums">{fmt(c.recycledKg)} <span className="text-xs text-muted">({fmt(c.recycledPercent, 3)}%)</span></td>
                <td className="td text-xs">{c.eolClassification ?? "–"}</td>
                <td className="td text-xs">{[c.gates.technicallyRecyclable, c.gates.noImpediments, c.gates.minSize].map((g) => (g ? "Y" : "N")).join(" · ")}</td>
                <td className="td">{c.gates.eligible ? <Pill tone="ok">Yes</Pill> : <Pill>No</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
          Transport: {fmt(r.product.transport.tonnes)} t · road {fmt(r.product.transport.roadOriginKm)} + {fmt(r.product.transport.roadDestinationKm)} km · sea {fmt(r.product.transport.seaKm)} km · air {fmt(r.product.transport.airKm)} km · {r.product.transport.truckClass}. Use: {fmt(r.product.usageHours)} hours.
        </p>
      </Panel>

      <Panel title="Every activity used" sub="ecoinvent activity, the geography actually found, the amount and its climate change result.">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface"><tr><th className="th">Stage · step</th><th className="th">Activity</th><th className="th">Geography</th><th className="th text-right">Amount</th><th className="th text-right">kg CO2e</th></tr></thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td className="td text-xs"><span className="font-semibold">{STAGE_LABEL[l.stage]}</span><br />{l.step}{l.component ? ` · ${l.component}` : ""}</td>
                  <td className="td text-xs">{l.activity}<br /><span className="text-muted">{l.referenceProduct}</span></td>
                  <td className="td text-xs">{l.geography}</td>
                  <td className="td whitespace-nowrap text-right text-xs tabular-nums">{fmt(l.amount)} {l.unit}</td>
                  <td className="td text-right text-xs tabular-nums">{fmt(l.impacts.GWP)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
