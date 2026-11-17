import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHealth } from "@/lib/health";
import { getDesignModel } from "@/lib/design-data";
import { scoreDesign, type DeInput } from "@/lib/design-effectiveness";
import { ButtonLink, Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { LibraryIndex } from "@/components/watchtower/library-index";

const BASE = "/shopper-iq/watchtower";
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-9, 1e-12));

export async function ShopperIqWatchtower() {
  await requireInternal();
  const supabase = await createClient();
  const [{ libs, criteria, settings }, health] = await Promise.all([getDesignModel(supabase), getHealth(supabase, "shopper-iq")]);
  const examples = [...(libs.siq_de_examples ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq)).map((ex) => {
    const input = ex.data.input as DeInput;
    const expected = ex.data.expected as { design: number; sustainability: number; overall: number; band: string };
    const r = scoreDesign(input, criteria, settings);
    const ok = same(r.design, expected.design) && same(r.sustainability, expected.sustainability) && same(r.overall, expected.overall) && r.band?.name === expected.band;
    return { code: ex.code, name: ex.name, input, expected, r, ok };
  });
  const ex = examples[0];
  // Workbook "Sensitivity" sheet: the worked example's overall score as the sustainability weight changes.
  const sens = ex ? [0, 0.1, 0.25, 0.4, 0.5].map((w) => ({ w, r: scoreDesign(ex.input, criteria, { ...settings, sustainabilityWeight: w }) })) : [];

  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Watchtower" }]} title="Shopper IQ Watchtower"
        sub="The design effectiveness model as governed data: every criterion, weight, answer value, band and rule, versioned and audited here.">
        <ButtonLink href={`${BASE}/calculator`} variant="primary"><MSymbol name="calculate" size={18} /> Design calculator</ButtonLink>
        <ButtonLink href={`${BASE}/methodology`}><MSymbol name="functions" size={18} /> Methodology</ButtonLink>
        <ButtonLink href="/watchtower"><MSymbol name="cell_tower" size={18} /> Master Watchtower</ButtonLink>
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {health.map((h) => <Stat key={h.metric} label={h.label} value={h.value} tone={h.status} hint={`Target ${h.target}`} />)}
      </section>

      <Panel title="Checked against the workbook" sub="The ShopperIQ Design Effectiveness Model worked example, recalculated now from the libraries below and compared with Excel."
        actions={<Pill tone={examples.every((e) => e.ok) ? "ok" : "bad"}>{examples.every((e) => e.ok) ? "Matches Excel" : "Differs from Excel"}</Pill>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Example</th><th className="th text-right">Design</th><th className="th text-right">Sustainability</th><th className="th text-right">Overall</th><th className="th">Band</th><th className="th">Result</th></tr></thead>
            <tbody>
              {examples.map((e) => (
                <tr key={e.code}>
                  <td className="td"><span className="font-semibold">{e.code}</span> <span className="text-xs text-muted">{e.name} · Impact Grade {String(e.input.impactGrade ?? "–")}</span></td>
                  <td className="td text-right tabular-nums">{pct(e.r.design)} <span className="text-xs text-muted">Excel {pct(e.expected.design)}</span></td>
                  <td className="td text-right tabular-nums">{pct(e.r.sustainability)} <span className="text-xs text-muted">Excel {pct(e.expected.sustainability)}</span></td>
                  <td className="td text-right tabular-nums">{pct(e.r.overall)} <span className="text-xs text-muted">Excel {pct(e.expected.overall)}</span></td>
                  <td className="td">{e.r.band?.name ?? "–"}</td>
                  <td className="td">{e.ok ? <Pill tone="ok">Match</Pill> : <Pill tone="bad">Differs</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">The same check runs on every test run (tests/db/shopper_iq_design.test.mjs).</p>
      </Panel>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="How it connects to Impact Grade" sub="Sustainability is scored inside effectiveness; the measured footprint comes from the Impact Grade Watchtower.">
          <ol className="space-y-2 px-5 py-4 text-sm">
            {[
              ["eco", "PEF score", "Impact Grade Watchtower: the Anthesis PEF model across 5 stages and 16 categories.", "/impact-grade/watchtower"],
              ["grade", "Impact Grade 0-100 (A-E)", "Built from the PEF score (formula to be defined). Held on the spec in Sourcing.", "/impact-grade/watchtower/issues#PORT-02"],
              ["looks_one", "Criterion S11, measured footprint", `Credit = Impact Grade ÷ 100, weight ${criteria.find((c) => c.code === "S11")?.weight ?? "–"}. Applies to POSM and GWP & Premiums.`, `${BASE}/libraries/siq_de_criteria`],
              ["percent", "Sustainability sub-score", "Weighted share of the applicable sustainability criteria (S01-S11).", `${BASE}/methodology`],
              ["functions", `Overall = ${(1 - settings.sustainabilityWeight) * 100}% design + ${settings.sustainabilityWeight * 100}% sustainability`, "The sustainability weight w is a governed parameter (open item DE-03).", `${BASE}/libraries/siq_de_parameters`],
            ].map(([icon, title, body, href], i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-sustainability/20 text-brand-sustainability"><MSymbol name={icon} size={18} /></span>
                <span><Link href={href} className="font-semibold hover:underline">{title}</Link><br /><span className="text-muted">{body}</span></span>
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            The other way (step 2, System X journey): Shopper IQ planning gives the Impact Grade record its outlet count and mix, distribution pattern and expected reuse, at the &lsquo;Estimated&rsquo; evidence tier.
          </p>
        </Panel>
        {ex && (
          <Panel title="Sensitivity to the sustainability weight" sub={`The worked example (${ex.name}) as w changes. The legacy RetailGrade blend was 50%.`}>
            <table className="w-full text-sm">
              <thead><tr><th className="th">w</th><th className="th text-right">Overall</th><th className="th">Band</th></tr></thead>
              <tbody>
                {sens.map((s) => (
                  <tr key={s.w} className={s.w === settings.sustainabilityWeight ? "bg-surface-2 font-semibold" : ""}>
                    <td className="td">{(s.w * 100).toFixed(0)}%{s.w === settings.sustainabilityWeight ? " (current)" : ""}</td>
                    <td className="td text-right tabular-nums">{pct(s.r.overall)}</td>
                    <td className="td">{s.r.band?.name ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Libraries</h2>
          <div className="flex gap-3 text-sm font-semibold">
            <Link href={`${BASE}/open-items`} className="text-accent hover:underline">Open items</Link>
            <Link href={`${BASE}/change-requests`} className="text-accent hover:underline">Change requests</Link>
            <Link href={`${BASE}/audit`} className="text-accent hover:underline">Audit trail</Link>
          </div>
        </div>
        <LibraryIndex module="shopper-iq" basePath={`${BASE}/libraries`} />
      </section>
      <Card className="px-5 py-3 text-xs text-muted">Source: ShopperIQ Design Effectiveness Model v1 (draft 30 Oct 2026), built from RetailGrade - Design 2025 and Alexia Michel&apos;s criteria (29 Oct 2026). Weights are not yet calibrated.</Card>
    </>
  );
}
