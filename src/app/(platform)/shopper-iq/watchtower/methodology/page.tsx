import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDesignModel } from "@/lib/design-data";
import { DE_ASSET_TYPES } from "@/lib/design-effectiveness";
import { Card, PageHead, Panel, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Design effectiveness methodology" };

const BASE = "/shopper-iq/watchtower";
const MATHS = [
  "value of an answer: Yes 1 · Partial 0.5 · No 0 · N/A and Unknown leave the denominator (Unknown also lowers coverage)",
  "S11 measured footprint: value = Impact Grade (0-100) ÷ 100, from the Impact Grade Watchtower",
  "points = weight × value, for each criterion that applies to the asset type",
  "design score = Σ design points ÷ Σ counted design weight, shown as Attract + Engage + Sell points",
  "sustainability sub-score = Σ sustainability points ÷ Σ counted sustainability weight",
  "overall = (1 − w) × design + w × sustainability (design alone when no sustainability criterion is counted)",
  "band = the highest band whose lower bound the overall reaches",
  "valid = counted ÷ applicable weight reaches the minimum coverage for both design and sustainability",
];

export default async function Methodology() {
  await requireInternal();
  const supabase = await createClient();
  const { libs, criteria, settings } = await getDesignModel(supabase);
  const answers = [...(libs.siq_de_answers ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq));
  const groups = [
    { key: "attract", label: "Design · Attract" }, { key: "engage", label: "Design · Engage" }, { key: "sell", label: "Design · Sell" }, { key: "sustainability", label: "Sustainability" },
  ];
  const total = (t: (typeof DE_ASSET_TYPES)[number]["code"], block: string) => criteria.filter((c) => c.block === block && c.appliesTo[t]).reduce((a, c) => a + c.weight, 0);

  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Watchtower", href: BASE }, { label: "Methodology" }]} title="Design effectiveness methodology"
        sub="One scoring model for Key Visuals, POSM and GWP & Premiums, with sustainability scored inside effectiveness. Criteria, weights and settings are governed libraries." />

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="The maths">
          <ul className="space-y-1.5 px-5 py-4 font-mono text-[0.8rem] leading-relaxed">{MATHS.map((l) => <li key={l} className="rounded bg-surface-2 px-2.5 py-1.5">{l}</li>)}</ul>
        </Panel>
        <Panel title="Settings" actions={<Link href={`${BASE}/libraries/siq_de_parameters`} className="text-sm font-semibold text-accent hover:underline">Manage</Link>}>
          <dl className="grid grid-cols-2 gap-3 px-5 py-4 text-sm">
            <div><dt className="eyebrow">Sustainability weight (w)</dt><dd className="mt-0.5 text-lg font-bold">{(settings.sustainabilityWeight * 100).toFixed(0)}%</dd></div>
            <div><dt className="eyebrow">Minimum coverage</dt><dd className="mt-0.5 text-lg font-bold">{(settings.minCoverage * 100).toFixed(0)}%</dd></div>
            <div className="col-span-2"><dt className="eyebrow">Answers</dt><dd className="mt-1 flex flex-wrap gap-1.5">{answers.map((a) => <Pill key={a.code} tone={a.data.counts ? "info" : "neutral"}>{a.code}: {a.data.counts ? String(a.data.value) : "excluded"}</Pill>)}</dd></div>
            <div className="col-span-2"><dt className="eyebrow">Bands (overall from)</dt><dd className="mt-1 flex flex-wrap gap-1.5">{[...settings.bands].sort((a, b) => a.minScore - b.minScore).map((b) => <Pill key={b.code} tone={b.confirmed ? "ok" : "warn"}>{b.name} {(b.minScore * 100).toFixed(0)}%+</Pill>)}</dd></div>
          </dl>
          <table className="w-full border-t border-line text-sm">
            <thead><tr><th className="th">Asset type</th><th className="th text-right">Design weight</th><th className="th text-right">Sustainability weight</th></tr></thead>
            <tbody>{DE_ASSET_TYPES.map((t) => <tr key={t.code}><td className="td">{t.name}</td><td className="td text-right tabular-nums">{total(t.code, "design")}</td><td className="td text-right tabular-nums">{total(t.code, "sustainability")}</td></tr>)}</tbody>
          </table>
        </Panel>
      </section>

      {groups.map((g) => {
        const list = criteria.filter((c) => c.pillar === g.key);
        return (
          <Panel key={g.key} title={`${g.label} (${list.length})`} actions={<Link href={`${BASE}/libraries/siq_de_criteria`} className="text-sm font-semibold text-accent hover:underline">Manage</Link>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">ID</th><th className="th">Criterion</th><th className="th text-right">Weight</th><th className="th">KV</th><th className="th">POSM</th><th className="th">GWP</th></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.code}>
                      <td className="td font-mono text-xs font-bold">{c.code}</td>
                      <td className="td"><span className="font-semibold">{c.name}</span>{c.input === "impact_grade" && <> <Pill tone="ok">Impact Grade</Pill></>}<br /><span className="text-xs text-muted">{c.whatAssessed}</span></td>
                      <td className="td text-right tabular-nums">{c.weight}</td>
                      {(["key_visual", "posm", "gwp"] as const).map((t) => <td key={t} className="td">{c.appliesTo[t] ? "Y" : <span className="text-muted">–</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
      <Card className="px-5 py-3 text-xs text-muted">Weights: legacy criteria keep their RetailGrade weights; new criteria use proposed tiers (100, 80, 60, 40, 20). None are calibrated against sales or shopper outcomes yet (open item DE-02).</Card>
    </>
  );
}
