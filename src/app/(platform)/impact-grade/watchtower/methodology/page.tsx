import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPefIndex } from "@/lib/pef-data";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { fmt } from "../../format";

export const metadata: Metadata = { title: "Impact Grade methodology" };

const BASE = "/impact-grade/watchtower";

/** The maths per stage, in the order the engine (src/lib/pef.ts) applies it. Rules and constants are governed below. */
const MATHS: { stage: string; rulesStage: string; lines: string[] }[] = [
  {
    stage: "1. Material acquisition", rulesStage: "Material Acquisition & Preprocessing",
    lines: [
      "recycled kg = weight × recycled % (your % if given, else the mapped default; 0 when recycled content is not allowed)",
      "virgin kg = weight − recycled kg; both ÷ process efficiency when a renewable manufacturer forms the part",
      "impact = kg × Σ (amount per kg × ecoinvent result ÷ reference amount) over the activities mapped (custom factors add every row)",
      "geography: PO Ship From, then GLO, RER, RoW, then any geography for that activity",
      "coating = coating kg or m2 × coating factor (geography: see parameter coating_geography)",
    ],
  },
  {
    stage: "2. Manufacturing", rulesStage: "Manufacturing",
    lines: [
      "printing / branding = treated area (m2) × Σ (energy per m2 × country factor) for electricity, natural gas, other heat and steam",
      "forming (renewable manufacturer only) = gross kg × Σ (energy per kg × country factor); otherwise forming is inside the processed material factor",
      "electricity is the renewable activity when the factory is renewable; other carriers are unchanged",
    ],
  },
  {
    stage: "3. Distribution", rulesStage: "Distribution",
    lines: [
      "tonnes = (material + coating kg) ÷ 1000",
      "impact = tonnes × (origin road km × road factor + destination road km × road factor + sea km × sea factor + air km × air factor)",
      "same country: road only (parameter same_country_road_km); otherwise the default mode and distances from Countries and routes",
    ],
  },
  {
    stage: "4. Use", rulesStage: "Usage",
    lines: [
      "kWh = kWh per hour × total hours (from the activation period)",
      "impact = kWh × low-voltage electricity factor for the country of use (power grid or batteries; solar counts as zero)",
    ],
  },
  {
    stage: "5. End of life", rulesStage: "End of Life",
    lines: [
      "recyclable only when gates 1, 4 and 5 pass for the part and the product is mono-material or separates easily",
      "recyclable: incineration and landfill at the country rates (recycling itself carries no impact or credit: cut-off)",
      "not recyclable: incineration and landfill re-scaled to 100%",
      "impact = net kg × rate × |treatment factor| (geography: PO Ship To, then GLO, RER, Europe without Switzerland, RoW)",
    ],
  },
  {
    stage: "PEF score", rulesStage: "",
    lines: [
      "per category: total = Σ of the five stages",
      "PEF score (Pt) = Σ over the 16 categories (total ÷ normalisation factor × weighting factor); mPt = Pt × 1000",
      "PEF sub-score of the Impact Grade = 100 × (1 − PEF mPt ÷ reference), floored at 0; reference = 95th percentile of our PEF scores",
      "Impact Grade (0-100, A-E) = Σ weight × sub-score: circular design 35, resource use 15, PEF 50 (Promo weights for promo/merch); see the Impact Grade calculator",
    ],
  },
];

export default async function Methodology() {
  await requireInternal();
  const supabase = await createClient();
  const { libs } = await getPefIndex(supabase);
  const rules = [...(libs.pef_methodology ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq));
  const params = [...(libs.pef_parameters ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq));
  const cats = [...(libs.pef_impact_categories ?? [])].sort((a, b) => Number(a.data.sort) - Number(b.data.sort));
  const general = rules.filter((r) => r.data.stage === "General");

  return (
    <>
      <PageHead crumbs={[{ label: "Impact Grade", href: "/impact-grade" }, { label: "Watchtower", href: BASE }, { label: "Methodology" }]} title="Methodology"
        sub="The maths, stage by stage, next to the documented rule it applies. Rules, constants and factors are governed libraries: change them there, with a reason and a second approver." />

      {general.length > 0 && (
        <Card className="p-5 text-sm">
          <h2 className="mb-2 font-bold">General rules</h2>
          <ul className="space-y-1.5">{general.map((r) => <li key={r.code}><span className="font-semibold">{r.name}.</span> {String(r.data.rule)}</li>)}</ul>
        </Card>
      )}

      {MATHS.map((m) => {
        const stageRules = m.rulesStage ? rules.filter((r) => r.data.stage === m.rulesStage) : [];
        return (
          <Panel key={m.stage} title={m.stage}>
            <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
              <div>
                <p className="eyebrow mb-2">The maths</p>
                <ul className="space-y-1.5 font-mono text-[0.8rem] leading-relaxed">
                  {m.lines.map((l) => <li key={l} className="rounded bg-surface-2 px-2.5 py-1.5">{l}</li>)}
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-2">Documented rules ({stageRules.length})</p>
                {stageRules.length === 0 ? <p className="text-sm text-muted">See the impact categories and grade bands below.</p> : (
                  <ul className="space-y-2 text-sm">
                    {stageRules.map((r) => (
                      <li key={r.code}>
                        <span className="font-semibold">{r.name}</span> <span className="text-xs text-muted">{r.code}</span>
                        <p className="whitespace-pre-line text-muted">{String(r.data.rule)}</p>
                        {r.data.assumption ? <p className="mt-0.5 text-xs"><Pill tone="info">Assumption</Pill> {String(r.data.assumption)}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Panel>
        );
      })}

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Calculation parameters" actions={<Link href={`${BASE}/libraries/pef_parameters`} className="text-sm font-semibold text-accent hover:underline">Manage</Link>}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Parameter</th><th className="th">Value</th><th className="th">Stage</th></tr></thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.code}>
                  <td className="td"><span className="font-semibold">{p.name}</span><br /><span className="font-mono text-xs text-muted">{p.code}</span></td>
                  <td className="td whitespace-nowrap">{p.data.value !== undefined && p.data.value !== null ? `${String(p.data.value)} ${String(p.data.unit ?? "")}` : String(p.data.text_value ?? "–")}</td>
                  <td className="td text-xs text-muted">{String(p.data.stage ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Normalisation and weighting (EF 3.1)" actions={<Link href={`${BASE}/libraries/pef_impact_categories`} className="text-sm font-semibold text-accent hover:underline">Manage</Link>}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Category</th><th className="th text-right">Normalisation</th><th className="th text-right">Weight</th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.code}>
                  <td className="td"><span className="font-semibold">{c.name}</span> <span className="text-xs text-muted">{c.code} · {String(c.data.unit ?? "")}</span></td>
                  <td className="td text-right tabular-nums">{fmt(Number(c.data.normalisation_factor))}</td>
                  <td className="td text-right tabular-nums">{(Number(c.data.weighting_factor) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
      <p className="flex items-center gap-1.5 text-xs text-muted"><MSymbol name="info" size={15} /> Source: Anthesis, our LCA database documentation 2026 and Example Calculations v2, ported from the PEF Logic workbook.</p>
    </>
  );
}
