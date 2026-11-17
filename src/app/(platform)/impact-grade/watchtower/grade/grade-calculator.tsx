"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Card, Panel, Pill, btn } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { computeImpactGrade, indexImpactGrade, type IgInput, type IgLibraries } from "@/lib/impact-grade";
import type { PefInput } from "@/lib/pef";
import { ScoringWheel, WheelFrame, WheelLegend } from "@/components/impact-grade/scoring-wheel";
import { PEF_START, PefResultsView, PefSpecForm, type PefOptions } from "../calculator/calculator";
import { runPef, type CalcResult } from "../calculator/actions";
import { fmt } from "../../format";
import { fmtIntensity } from "@/lib/carbon-intensity";

const SPEC_TYPES = [["2d", "2D"], ["3d", "3D"], ["promo_merch", "Promo & merch"], ["custom_goods_services", "Custom goods & services"]];
type Tri = "yes" | "no" | "";
const tri = (v: Tri) => (v === "" ? null : v === "yes");
type PefMode = "calculate" | "manual" | "none";

/**
 * One specification, two calculations. The Impact Grade and the PEF score read the same product specification
 * (substrates, weights, recycled content, coatings, printing, transport, use); the grade adds a few design questions.
 * Top: the Impact Grade wheel. Middle: the specification. Bottom: the PEF score and its breakdown.
 */
export function GradeCalculator({ libs, pef }: { libs: IgLibraries; pef: PefOptions }) {
  const ix = useMemo(() => indexImpactGrade(libs), [libs]);
  const opts = (kind: string) => (libs.ig_option_scores ?? []).filter((r) => r.data.kind === kind).sort((a, b) => Number(a.data.seq) - Number(b.data.seq)).map((r) => r.name);

  // The specification (shared).
  const [spec, setSpecRaw] = useState<PefInput>(PEF_START);
  const [preset, setPreset] = useState("");
  const [stale, setStale] = useState(false);
  const setSpec = (fn: (i: PefInput) => PefInput) => { setSpecRaw(fn); setStale(true); };

  // Design questions only the grade asks.
  const [specType, setSpecType] = useState("3d");
  const [reusable, setReusable] = useState<Tri>("");
  const [modular, setModular] = useState<Tri>("");
  const [optimal, setOptimal] = useState<Tri>("");
  const [accreditation, setAccreditation] = useState("");
  const [inks, setInks] = useState("");
  const [varnish, setVarnish] = useState("");
  const [oeko, setOeko] = useState<Tri>("");
  const [spend, setSpend] = useState("");

  // The PEF score.
  const [mode, setMode] = useState<PefMode>("calculate");
  const [pefOut, setPefOut] = useState<CalcResult | null>(null);
  const [manual, setManual] = useState("");
  const [pending, start] = useTransition();
  const calculate = () => start(async () => { const r = await runPef(spec); setPefOut(r); setStale(false); });
  const calcMpt = pefOut && pefOut.ok ? pefOut.result.singleScoreMpt : null;
  const pefMpt = mode === "calculate" ? calcMpt : mode === "manual" ? (manual.trim() === "" ? null : Number(manual)) : null;
  const excel = pef.presets.find((p) => p.code === preset)?.excel;

  // The grade reads the same specification.
  const electronicsOpts = opts("electronics");
  const src = spec.electronics?.source ?? "No";
  const input: IgInput = {
    specType,
    components: spec.components.filter((c) => c.name).map((c) => ({ name: c.name, weightKg: c.weightKg, recycledPercent: c.recycledPercent ?? null })),
    activationPeriod: spec.usagePeriod && opts("activation_period").includes(spec.usagePeriod) ? spec.usagePeriod : null,
    reusable: tri(reusable), modular: tri(modular), easySeparation: spec.easySeparation ?? null,
    finishing: spec.components.map((c) => c.coating).filter((x): x is string => !!x),
    optimalSize: tri(optimal), accreditation: accreditation || null, inks: inks || null, varnish: varnish || null,
    electronics: electronicsOpts.includes(src) ? src : src === "No" ? "No" : null, oekoTex: tri(oeko), pefMpt,
  };
  const r = computeImpactGrade(input, ix);

  // Carbon intensity KPIs (reported beside the grade, not scored): the PEF climate result for the same specification
  // per € of purchase spend, and per kg of material (substrates plus coatings).
  const climateKg = mode === "calculate" && pefOut && pefOut.ok ? pefOut.result.total.GWP : null;
  const spendEur = spend.trim() === "" ? null : Number(spend);
  const weightKg = spec.components.reduce((a, c) => a + (Number(c.weightKg) || 0) + (Number(c.coatingKg) || 0), 0);
  const economic = climateKg !== null && spendEur && spendEur > 0 ? climateKg / spendEur : null;
  const physical = climateKg !== null && weightKg > 0 ? climateKg / weightKg : null;

  const yn = (label: string, v: Tri, set: (v: Tri) => void) => (
    <label><span className="label">{label}</span>
      <select className="input" value={v} onChange={(e) => set(e.target.value as Tri)}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
  );
  const sel = (label: string, v: string, set: (v: string) => void, list: string[], empty = "None") => (
    <label><span className="label">{label}</span>
      <select className="input" value={v} onChange={(e) => set(e.target.value)}><option value="">{empty}</option>{list.map((x) => <option key={x}>{x}</option>)}</select></label>
  );

  return (
    <div className="space-y-4">
      {/* Top: the Impact Grade. */}
      <Panel title="Impact Grade" sub="Circular design and resource use from the specification and design questions, plus the PEF score (half the grade) from the same specification.">
        <div className="grid items-start gap-6 p-5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-3">
            <WheelFrame letter={r.letter?.letter ?? null}>
              <ScoringWheel segments={r.subScores} score={r.score} letter={r.letter?.letter ?? null} provisional={!r.confirmed || r.letter?.confirmed === false} />
            </WheelFrame>
            <div className="flex flex-wrap justify-center gap-1.5 text-xs">
              <Pill tone={r.confirmed ? "ok" : "warn"}>{Math.round(r.coverage * 100)}% of the weight has data{r.confirmed ? "" : ": provisional"}</Pill>
              {r.letter && !r.letter.confirmed && <Pill tone="warn">Letters not yet confirmed</Pill>}
            </div>
          </div>
          <div className="space-y-3">
            <WheelLegend segments={r.subScores} />
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
              PEF score: <span className="font-semibold">{pefMpt === null ? "not calculated yet" : `${fmt(pefMpt)} mPt`}</span>
              {r.pef.score !== null && <> → sub-score {r.pef.score}</>}
              {mode === "calculate" && stale && pefOut && <span className="ml-1 font-semibold text-warn">· the specification changed: recalculate</span>}
              {" · "}<a href="#pef" className="font-semibold text-accent hover:underline">PEF breakdown below</a>
            </div>
            <div className="grid grid-cols-2 gap-2" title="Reported beside the Impact Grade, not scored in it (Impact Grade.xlsx, Outputs). Climate change from the PEF calculation on this specification.">
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="eyebrow">Economic carbon intensity</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums">{fmtIntensity(economic)}</p>
                <p className="text-[0.7rem] text-muted">{climateKg === null ? "Calculate the PEF score" : spendEur ? `${fmt(climateKg)} kg CO2e ÷ €${spendEur.toLocaleString("en-GB")}` : "Enter the spend in the specification"}</p>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="eyebrow">Physical carbon intensity</p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums">{fmtIntensity(physical, "kg")}</p>
                <p className="text-[0.7rem] text-muted">{climateKg === null ? "Calculate the PEF score" : weightKg > 0 ? `${fmt(climateKg)} kg CO2e ÷ ${fmt(weightKg)} kg` : "Add substrate weights"}</p>
              </div>
            </div>
          </div>
          <div className="text-sm">
            <p className="eyebrow mb-1">Why</p>
            <ul className="space-y-1">{r.subScores.filter((s) => s.weight).map((s) => <li key={s.code}><span className="font-semibold">{s.name}:</span> <span className="text-muted">{s.why}</span></li>)}</ul>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted"><MSymbol name="arrow_forward" size={16} />
              <span>Feeds Shopper IQ design effectiveness: criterion S11 credit = {r.score === null ? "–" : (r.score / 100).toFixed(2)} (<Link className="text-accent hover:underline" href="/shopper-iq/watchtower">Shopper IQ Watchtower</Link>).</span></p>
          </div>
        </div>
      </Panel>

      {/* Middle: one specification for both. */}
      <Panel title="Specification" sub="One specification for both: the PEF score and the Impact Grade read the same substrates, weights, recycled content, coatings, printing, transport and use.">
        <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <PefSpecForm options={pef} input={spec} setInput={setSpec} preset={preset} onPreset={(code) => { setPreset(code); setPefOut(null); }} />
          <div className="space-y-4">
            <Card className="grid gap-3 p-5 text-sm">
              <h3 className="font-bold">Design questions (Impact Grade)</h3>
              <label><span className="label">Spec type</span>
                <select className="input" value={specType} onChange={(e) => setSpecType(e.target.value)}>{SPEC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <p className="text-xs text-muted">{r.promo ? "Scored with Promo weights." : "Scored with standard weights."}</p>
              <label><span className="label">Durability &amp; lifespan (activation period)</span>
                <select className="input" value={spec.usagePeriod ?? ""} onChange={(e) => setSpec((i) => ({ ...i, usagePeriod: e.target.value || null, usageHours: null }))}>
                  <option value="">Not known</option>
                  {pef.periods.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                </select>
                <span className="mt-1 block text-xs text-muted">
                  The same field as &ldquo;Activation period&rdquo; in Use in store: it scores durability and sets the hours of use in the PEF.
                  {r.subScores.find((s) => s.code === "DURABILITY")?.score != null && <> Durability score {r.subScores.find((s) => s.code === "DURABILITY")!.score}.</>}
                </span></label>
              {yn("Designed for reuse", reusable, setReusable)}
              {yn("Modular (repairable)", modular, setModular)}
              {yn("Designed to optimal size and weight", optimal, setOptimal)}
              {sel("Material certification", accreditation, setAccreditation, opts("accreditation"))}
              {sel("Inks", inks, setInks, opts("ink"), "Not known")}
              {sel("Varnish", varnish, setVarnish, opts("varnish"), "Not known")}
              {yn("Textile: OEKO-TEX (leave unknown if no textile)", oeko, setOeko)}
              <p className="text-xs text-muted">From the specification: substrates and recycled content, coatings (finishing), separation and electronics.</p>
            </Card>
            <Card className="grid gap-2 p-5 text-sm">
              <h3 className="font-bold">Spend (carbon intensity)</h3>
              <label><span className="label">Purchase spend for this specification (€)</span>
                <input className="input" type="number" min={0} step="any" value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="e.g. 2500" /></label>
              <p className="text-xs text-muted">For the economic carbon intensity (kg CO2e per €), reported beside the grade, not scored in it.</p>
            </Card>
            <button type="button" className={`${btn.primary} w-full`} disabled={pending || mode !== "calculate"} onClick={calculate}>
              <MSymbol name="calculate" size={18} /> {pending ? "Calculating…" : pefOut && !stale ? "Recalculate the PEF score" : "Calculate the PEF score"}
            </button>
          </div>
        </div>
      </Panel>

      {/* Bottom: the PEF score. */}
      <div id="pef" className="scroll-mt-20">
        <Panel title="PEF score" sub="The Anthesis PEF model on the specification above: material, manufacturing, distribution, use and end of life across 16 categories. Half of the Impact Grade."
          actions={
            <div className="flex flex-wrap gap-1">
              {([["calculate", "From the specification"], ["manual", "Enter a PEF score"], ["none", "Not calculated yet"]] as [PefMode, string][]).map(([m, l]) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${mode === m ? "border-accent bg-accent text-accent-fg" : "border-line hover:bg-surface-2"}`}>{l}</button>
              ))}
            </div>
          }>
          <div className="space-y-3 p-5">
            {mode === "calculate" && (
              <>
                {stale && pefOut && <p className="text-sm text-warn">The specification changed since this was calculated. Recalculate to update the PEF score and the grade.</p>}
                <PefResultsView out={pefOut} excel={excel} />
              </>
            )}
            {mode === "manual" && (
              <label className="block max-w-xs text-sm"><span className="label">PEF score (mPt)</span><input className="input" type="number" step="any" value={manual} onChange={(e) => setManual(e.target.value)} /></label>
            )}
            {mode === "none" && <p className="text-sm text-muted">The grade is worked out from the other sub-scores and shows as provisional: half of the weight has no data.</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
