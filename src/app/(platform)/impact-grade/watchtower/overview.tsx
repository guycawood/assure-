import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHealth } from "@/lib/health";
import { getPefIndex } from "@/lib/pef-data";
import { computePef, PEF_STAGES, STAGE_LABEL, type PefInput } from "@/lib/pef";
import { ButtonLink, Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { LibraryIndex } from "@/components/watchtower/library-index";
import { fmt, matches } from "../format";
import { computeImpactGrade } from "@/lib/impact-grade";
import { ProposeReferenceButton } from "./reference-button";
import { ScoringWheel, WheelFrame, WheelLegend } from "@/components/impact-grade/scoring-wheel";

const BASE = "/impact-grade/watchtower";

/** Which libraries feed each stage of the calculation (links into the governed tables). */
const STAGE_LIBS: Record<(typeof PEF_STAGES)[number], { key: string; label: string }[]> = {
  material: [
    { key: "pef_virgin_materials", label: "Virgin materials" }, { key: "pef_recycled_materials", label: "Recycled materials" },
    { key: "pef_coatings", label: "Coatings" }, { key: "pef_custom_factors", label: "Custom factors" },
  ],
  manufacturing: [
    { key: "pef_process_energy", label: "Process energy" }, { key: "pef_process_labels", label: "Printing / branding labels" },
    { key: "pef_energy_activities", label: "Energy by country" }, { key: "pef_process_efficiency", label: "Process efficiency" },
  ],
  distribution: [{ key: "pef_countries", label: "Countries and routes" }, { key: "pef_transport_activities", label: "Transport activities" }],
  use: [{ key: "pef_use_electricity", label: "Use-phase electricity" }, { key: "pef_usage_periods", label: "Usage periods" }],
  end_of_life: [
    { key: "pef_eol_materials", label: "EOL classification" }, { key: "pef_eol_fate", label: "Fate rates" }, { key: "pef_eol_treatment", label: "Treatment" },
  ],
};

export async function ImpactGradeWatchtower() {
  await requireInternal();
  const supabase = await createClient();
  const [{ libs, index }, health] = await Promise.all([getPefIndex(supabase), getHealth(supabase, "impact-grade")]);
  const examples = [...(libs.pef_worked_examples ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq));
  const checks = examples.map((ex) => {
    const input = ex.data.input as PefInput;
    const expected = ex.data.expected as { totalGwp: number; singleScoreMpt: number };
    const r = computePef(input, index);
    const coated = input.components.some((c) => (c.coatingKg ?? 0) > 0);
    return { code: ex.code, name: ex.name, r, expected, co2Ok: matches(r.total.GWP, expected.totalGwp), mptOk: matches(r.singleScoreMpt, expected.singleScoreMpt), coated };
  });
  const allOk = checks.every((c) => c.co2Ok && (c.mptOk || c.coated));
  const { data: sugRaw } = await supabase.rpc("ig_pef_reference_suggestion");
  const suggestion = sugRaw as { reference_mpt: number | null; results: number; percentile: number; basis: string } | null;
  // The scoring diagram, on an example: a board display with the PEF score of worked example WE-05.
  const example = computeImpactGrade({
    specType: "3d", components: [{ name: "Folding Cardboard", weightKg: 1, recycledPercent: 50 }], activationPeriod: "12 - 24 months",
    reusable: true, modular: false, finishing: [], optimalSize: true, accreditation: "Forest - FSC 100%", inks: "Vegetable Inks", electronics: "No",
    pefMpt: checks.find((c) => c.code === "WE-05")?.r.singleScoreMpt ?? checks[0]?.r.singleScoreMpt ?? null,
  }, libs);
  const counts = (k: string) => (libs[k] ?? []).length;

  return (
    <>
      <PageHead crumbs={[{ label: "Sustainability", href: "/sustainability" }, { label: "Impact Grade", href: "/impact-grade" }, { label: "Watchtower" }]} title="Impact Grade Watchtower"
        sub="The Anthesis PEF model as governed data: every mapping, factor, weight and rule the maths uses, versioned and audited here.">
        <ButtonLink href={`${BASE}/grade`} variant="primary"><MSymbol name="calculate" size={18} /> Impact Grade calculator</ButtonLink>
        <ButtonLink href={`${BASE}/methodology`}><MSymbol name="functions" size={18} /> Methodology</ButtonLink>
        <ButtonLink href="/watchtower"><MSymbol name="cell_tower" size={18} /> Master Watchtower</ButtonLink>
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {health.map((h) => (
          <Stat key={h.metric} label={h.label} value={h.metric === "ef_weighting_total" ? `${h.value}%` : h.value} tone={h.status}
            hint={h.metric === "ef_weighting_total" ? "Target 100%" : `Target ${h.target}`} />
        ))}
      </section>

      <Panel title="Checked against the workbook" sub="The Anthesis worked examples, recalculated now from the libraries below and compared with the results Excel gives."
        actions={<Pill tone={allOk ? "ok" : "bad"}>{allOk ? "Matches Excel" : "Differs from Excel"}</Pill>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="th">Example</th><th className="th text-right">Excel kg CO2e</th><th className="th text-right">System Guy kg CO2e</th>
              <th className="th text-right">Excel PEF score (mPt)</th><th className="th text-right">System Guy PEF score (mPt)</th><th className="th">Result</th>
            </tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.code}>
                  <td className="td"><span className="font-semibold">{c.code}</span> <span className="text-xs text-muted">{c.name}</span></td>
                  <td className="td text-right tabular-nums">{fmt(c.expected.totalGwp)}</td>
                  <td className="td text-right tabular-nums">{fmt(c.r.total.GWP)}</td>
                  <td className="td text-right tabular-nums">{fmt(c.expected.singleScoreMpt)}</td>
                  <td className="td text-right tabular-nums">{fmt(c.r.singleScoreMpt)}</td>
                  <td className="td">
                    {c.co2Ok && c.mptOk ? <Pill tone="ok">Match</Pill>
                      : c.co2Ok && c.coated ? <Link href={`${BASE}/issues#PORT-05`}><Pill tone="warn">CO2e matches · score differs (PORT-05)</Pill></Link>
                      : <Pill tone="bad">Differs</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Matching means within one part in a million. The same check runs on every test run (tests/db/impact_grade.test.mjs), stage by stage and for all 16 impact categories.
        </p>
      </Panel>

      <Panel title="Impact Grade scoring diagram" sub="The ecoGrade wheel, rebuilt: circular design and resource use from the spec, and the PEF score as half the grade. Shown here on an example board display."
        actions={<Link href={`${BASE}/grade`} className="text-sm font-semibold text-accent hover:underline">Impact Grade calculator</Link>}>
        <div className="grid items-center gap-6 p-5 lg:grid-cols-[auto_minmax(0,1fr)]">
          <WheelFrame letter={example.letter?.letter ?? null}>
            <ScoringWheel segments={example.subScores} score={example.score} letter={example.letter?.letter ?? null} provisional={example.letter?.confirmed === false} />
          </WheelFrame>
          <div className="space-y-4">
            <WheelLegend segments={example.subScores} />
            <ol className="grid gap-2 text-xs sm:grid-cols-4">
              {[
                ["calculate", "PEF calculation", "Section 1 of the Impact Grade calculator: 16 EF 3.1 categories → PEF score (mPt)", `${BASE}/grade`],
                ["percent", "PEF sub-score", `100 × (1 − PEF ÷ ${example.pef.reference.toPrecision(3)} mPt), the 95th percentile of our scores`, `${BASE}/libraries/ig_parameters`],
                ["grade", "Impact Grade", "Weighted with circular design and resource use: 0-100, A-E", `${BASE}/grade`],
                ["insights", "Used by", "Shopper IQ S11 · CRM client floor · briefs and ideation · specs to SRM", "/shopper-iq/watchtower"],
              ].map(([icon, t, d, href]) => (
                <li key={t} className="rounded-lg border border-line p-2.5">
                  <Link href={href} className="flex items-center gap-1.5 font-semibold hover:underline"><MSymbol name={icon} size={16} />{t}</Link>
                  <p className="mt-0.5 text-muted">{d}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
              <span>PEF reference in use: <span className="font-semibold">{example.pef.reference.toPrecision(4)} mPt</span>
                {suggestion?.reference_mpt != null && <> · {suggestion.percentile}th percentile of our {suggestion.results} PEF scores now: <span className="font-semibold">{Number(suggestion.reference_mpt).toPrecision(4)} mPt</span> ({suggestion.basis.replace(/_/g, " ")})</>}</span>
              <ProposeReferenceButton />
            </div>
          </div>
        </div>
      </Panel>

      <section>
        <h2 className="mb-2 font-bold">How the PEF score is built</h2>
        <div className="grid gap-3 md:grid-cols-5">
          {PEF_STAGES.map((s, i) => (
            <Card key={s} className="p-4 text-sm">
              <p className="eyebrow">Stage {i + 1}</p>
              <h3 className="mt-0.5 font-bold">{STAGE_LABEL[s]}</h3>
              <ul className="mt-2 space-y-1">
                {STAGE_LIBS[s].map((l) => (
                  <li key={l.key}><Link className="text-accent hover:underline" href={`${BASE}/libraries/${l.key}`}>{l.label}</Link> <span className="text-xs text-muted">{counts(l.key)}</span></li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <Card className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-sm">
          <MSymbol name="functions" size={18} />
          <span>Each stage resolves to <Link className="text-accent hover:underline" href={`${BASE}/libraries/pef_ecoinvent`}>ecoinvent activities</Link> ({counts("pef_ecoinvent")} loaded) across 16 categories,</span>
          <span>normalised and weighted by the <Link className="text-accent hover:underline" href={`${BASE}/libraries/pef_impact_categories`}>EF 3.1 factors</Link> into the PEF score.</span>
          <span>The PEF score is half of the <Link className="text-accent hover:underline" href={`${BASE}/grade`}>Impact Grade</Link> (0-100, <Link className="text-accent hover:underline" href={`${BASE}/libraries/pef_grade_bands`}>A-E</Link>).</span>
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Libraries</h2>
          <div className="flex gap-3 text-sm font-semibold">
            <Link href={`${BASE}/issues`} className="text-accent hover:underline">Open issues</Link>
            <Link href={`${BASE}/change-requests`} className="text-accent hover:underline">Change requests</Link>
            <Link href={`${BASE}/audit`} className="text-accent hover:underline">Audit trail</Link>
          </div>
        </div>
        <LibraryIndex module="impact-grade" basePath={`${BASE}/libraries`} />
      </section>
    </>
  );
}
