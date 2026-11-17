import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGradeOptions, toRecordView, type GradeRecord } from "@/lib/impact-grade-spec";
import { confidenceLevel } from "@/lib/impact-grade-confidence";
import { TIER_LABEL, type IgTier } from "@/lib/impact-grade";
import { CalculateAllButton, CalculateButton, GradeRecordPanel } from "@/components/impact-grade/grade-record";
import { gradeLetter, ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { Card, Panel, Pill, Stat } from "@/components/ui";

type SpecRow = { id: string; spec_no: number; title: string; is_draft?: boolean };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const TIER_ORDER: IgTier[] = ["verified", "measured", "declared", "estimated", "assumed"];
const TIER_TONE = { assumed: "neutral", estimated: "warn", declared: "info", measured: "accent", verified: "ok" } as const;

/**
 * A job's Impact Grade and the way down into it: the job grade is the average of its specs' grades; below that, each
 * sub-score across the job (with the evidence behind it and which spec is weakest), the specs ranked from lowest, and
 * every spec's full record (inputs, evidence, history, review) to open and edit.
 */
export async function JobImpactGrade({ supabase, jobId, specs }: { supabase: SupabaseClient; jobId: string; specs: SpecRow[] }) {
  const ids = specs.map((s) => s.id);
  const [{ data: recData }, options] = await Promise.all([
    ids.length ? supabase.from("impact_grade_records").select("*").eq("subject_kind", "spec").in("subject_id", ids) : Promise.resolve({ data: [] }),
    getGradeOptions(supabase as never),
  ]);
  const recs = new Map(((recData ?? []) as GradeRecord[]).map((r) => [r.subject_id, r]));
  const supplierIds = [...new Set([...recs.values()].map((r) => r.supplier_id).filter((x): x is string => !!x))];
  const { data: sups } = supplierIds.length ? await supabase.from("suppliers").select("id, name").in("id", supplierIds) : { data: [] };
  const supName = new Map(((sups ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  const list = [...recs.values()];
  const scored = list.filter((r) => r.score !== null);
  const jobScore = avg(scored.map((r) => Number(r.score)));
  const low = avg(list.filter((r) => r.range_low !== null).map((r) => Number(r.range_low)));
  const high = avg(list.filter((r) => r.range_high !== null).map((r) => Number(r.range_high)));
  // Level of confidence = data availability: the share of the weighted inputs that have data, across every spec (a spec with no grade counts as none).
  const jobCoverage = specs.length ? specs.reduce((a, s) => a + Number(recs.get(s.id)?.coverage ?? 0), 0) / specs.length : 0;
  const jobLevel = confidenceLevel(jobCoverage);
  const pending = list.filter((r) => r.review_status !== "reviewed").length;
  const disputed = list.filter((r) => r.review_status === "disputed").length;
  const letter = gradeLetter(jobScore);
  const specById = new Map(specs.map((s) => [s.id, s]));

  // Each sub-score across the job's specs.
  type Sub = { code: string; name: string; weight: number | null; scores: { spec: string; score: number }[]; tiers: Partial<Record<IgTier, number>>; why: string };
  const subs = new Map<string, Sub>();
  for (const r of list) for (const s of r.sub_scores ?? []) {
    const cur = subs.get(s.code) ?? { code: s.code, name: s.name, weight: s.weight, scores: [], tiers: {}, why: s.why };
    if (s.score !== null) {
      cur.scores.push({ spec: r.subject_id, score: Number(s.score) });
      const t = (r.tiers?.[s.code] ?? "assumed") as IgTier;
      cur.tiers[t] = (cur.tiers[t] ?? 0) + 1;
    }
    subs.set(s.code, cur);
  }
  const subRows = [...subs.values()].map((s) => ({ ...s, mean: avg(s.scores.map((x) => x.score)), worst: s.scores.length ? s.scores.reduce((a, b) => (b.score < a.score ? b : a)) : null }))
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const ranked = specs.map((s) => ({ s, r: recs.get(s.id) })).sort((a, b) => (a.r?.score ?? 999) - (b.r?.score ?? 999));
  const warnings = new Map<string, number>();
  for (const r of list) for (const w of r.warnings ?? []) warnings.set(w, (warnings.get(w) ?? 0) + 1);
  const bar = (v: number | null) => (letter && v !== null ? gradeLetter(v)?.colour : "#cbd5d5") ?? "#cbd5d5";

  if (specs.length === 0) return <Card className="px-5 py-6 text-sm text-muted">This job has no specs yet. The Impact Grade is worked out per spec, so add one first.</Card>;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Job Impact Grade" value={letter && jobScore !== null ? <span style={{ color: letter.colour }}>{letter.letter} <span className="text-[1.1rem]">{jobScore.toFixed(0)}</span></span> : "—"}
          hint={low !== null && high !== null ? `Likely range ${Math.round(low)} to ${Math.round(high)} · average of its specs` : "Average of its specs"} />
        <Stat label="Level of confidence" value={`${jobLevel.pct}%`} tone={jobLevel.tone === "neutral" ? undefined : jobLevel.tone}
          hint={`Based on data availability: the share of the grade's weighted inputs that have data, across ${specs.length} spec${specs.length === 1 ? "" : "s"}`} />
        <Stat label="Specs graded" value={`${scored.length} of ${specs.length}`} hint={scored.length < specs.length ? "Calculate the rest with the button below" : "Every spec has a grade"} tone={scored.length < specs.length ? "warn" : "ok"} />
        <Stat label="Review" value={pending === 0 && list.length ? "Reviewed" : `${pending} to review`} hint={disputed ? `${disputed} disputed` : "Open a spec below to review it"} tone={disputed ? "bad" : pending ? "warn" : list.length ? "ok" : undefined} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <CalculateAllButton jobId={jobId} />
        <span className="text-xs text-muted">Works out the grade of this job&apos;s specs. The job grade is a plain average of the spec grades. Method and weights are set in the <Link href="/impact-grade/watchtower" className="text-accent hover:underline">Impact Grade Watchtower</Link>.</span>
      </div>

      {subRows.length > 0 && (
        <Panel title="What the grade is made of" sub="Each sub-score across this job's specs. The evidence column counts the specs at each level, from Assumed to Verified.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-4 py-2">Sub-score</th><th className="px-4 py-2">Weight</th><th className="px-4 py-2">Average</th><th className="px-4 py-2">Evidence</th><th className="px-4 py-2">Weakest spec</th></tr>
              </thead>
              <tbody>
                {subRows.map((s) => (
                  <tr key={s.code} className="border-t border-line align-top">
                    <td className="px-4 py-2 font-semibold">{s.name}</td>
                    <td className="px-4 py-2">{s.weight ? `${s.weight}%` : <span className="text-muted">not weighted</span>}</td>
                    <td className="px-4 py-2">
                      {s.mean === null ? <span className="text-muted">–</span> : (
                        <div className="flex min-w-32 items-center gap-2">
                          <span className="w-8 font-bold tabular-nums">{Math.round(s.mean)}</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, s.mean)}%`, background: bar(s.mean) }} /></span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{TIER_ORDER.filter((t) => s.tiers[t]).map((t) => <Pill key={t} tone={TIER_TONE[t]}>{TIER_LABEL[t]} {s.tiers[t]}</Pill>)}{s.scores.length === 0 && <span className="text-muted">no data</span>}</div></td>
                    <td className="px-4 py-2 text-xs">{s.worst ? <>Spec {specById.get(s.worst.spec)?.spec_no} <span className="text-muted">· {Math.round(s.worst.score)}</span></> : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {warnings.size > 0 && (
        <Card className="space-y-1 border-warn/40 bg-warn-soft px-4 py-3 text-xs text-warn">
          <p className="font-semibold">What is missing or assumed</p>
          <ul className="space-y-0.5">{[...warnings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => <li key={w}>• {w}{n > 1 ? ` (${n} specs)` : ""}</li>)}</ul>
        </Card>
      )}

      <Panel title="Specs, lowest grade first" sub="Open a spec for its full record: every sub-score with the reason, the evidence level, an editor for the inputs, and review.">
        <div className="space-y-2 p-3">
          {ranked.map(({ s, r }) => (
            <details key={s.id} className="rounded-lg border border-line bg-surface-2/40">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted">Spec {s.spec_no}</span>
                <span className="min-w-40 flex-1 font-semibold">{s.title}{s.is_draft && <span className="ml-2"><Pill tone="warn">Draft</Pill></span>}</span>
                <ImpactGradeBadge score={r?.score ?? null} href={`/sourcing/specs/${s.id}`} />
                {r ? <span title={`${confidenceLevel(r.coverage).pct}% of the grade's weighted inputs have data`}><Pill tone={confidenceLevel(r.coverage).tone}>{confidenceLevel(r.coverage).pct}% confidence</Pill></span> : <span className="w-28 text-xs text-muted">not calculated</span>}
                <span className="w-40 truncate text-xs text-muted">{r?.supplier_id ? supName.get(r.supplier_id) ?? "supplier" : "no supplier yet"}</span>
                {r && <Pill tone={r.review_status === "reviewed" ? "ok" : r.review_status === "disputed" ? "bad" : "warn"}>{r.review_status === "reviewed" ? "Reviewed" : r.review_status === "disputed" ? "Disputed" : "Needs review"}</Pill>}
              </summary>
              <div className="border-t border-line p-3">
                {r ? <GradeRecordPanel specId={s.id} record={toRecordView(r, r.supplier_id ? supName.get(r.supplier_id) ?? null : null)} options={options} hideConfidence /> : <CalculateButton specId={s.id} />}
                <p className="mt-3 text-xs"><Link href={`/sourcing/specs/${s.id}`} className="text-accent hover:underline">Open the spec</Link></p>
              </div>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
