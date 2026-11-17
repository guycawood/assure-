import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGradeOptions, toRecordView, type GradeRecord } from "@/lib/impact-grade-spec";
import { CalculateAllButton, CalculateButton, GradeRecordPanel } from "@/components/impact-grade/grade-record";
import { ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { PageHead, Pill, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Impact Grade by job" };

type JobRow = { id: string; job_number: string; title: string; status: string; client_name: string };
type SpecRow = { id: string; job_id: string; spec_no: number; title: string };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Every job that has come through the system, rolled up from its specs' Impact Grade records. A job opens to its specs,
// a spec opens to its sub-scores, evidence and history, where inputs can be edited and the record reviewed.
export default async function ImpactGradeJobs({ searchParams }: { searchParams: Promise<{ q?: string; review?: string }> }) {
  await requireInternal();
  const { q, review } = await searchParams;
  const supabase = await createClient();
  const [{ data: jobs }, { data: specs }, { data: recs }, options] = await Promise.all([
    supabase.from("v_jobs").select("id, job_number, title, status, client_name").order("created_at", { ascending: false }).limit(300),
    supabase.from("job_specs").select("id, job_id, spec_no, title").order("spec_no").limit(2000),
    supabase.from("impact_grade_records").select("*").eq("subject_kind", "spec").limit(2000),
    getGradeOptions(supabase),
  ]);
  const records = new Map(((recs ?? []) as GradeRecord[]).map((r) => [r.subject_id, r]));
  const supplierIds = [...new Set([...records.values()].map((r) => r.supplier_id).filter((x): x is string => !!x))];
  const { data: sups } = supplierIds.length ? await supabase.from("suppliers").select("id, name").in("id", supplierIds) : { data: [] };
  const supName = new Map(((sups ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  const bySpecJob = new Map<string, SpecRow[]>();
  for (const s of (specs ?? []) as SpecRow[]) (bySpecJob.get(s.job_id) ?? bySpecJob.set(s.job_id, []).get(s.job_id)!).push(s);

  let rows = ((jobs ?? []) as JobRow[]).filter((j) => bySpecJob.has(j.id)).map((j) => {
    const ss = bySpecJob.get(j.id)!;
    const rs = ss.map((s) => records.get(s.id)).filter((r): r is GradeRecord => !!r);
    const scores = rs.map((r) => (r.score === null ? null : Number(r.score))).filter((x): x is number => x !== null);
    return { j, ss, rs, grade: avg(scores), conf: avg(rs.map((r) => r.confidence ?? 0)), pending: rs.filter((r) => r.review_status !== "reviewed").length };
  });
  if (q) rows = rows.filter((r) => `${r.j.job_number} ${r.j.title} ${r.j.client_name}`.toLowerCase().includes(q.toLowerCase()));
  if (review === "needs") rows = rows.filter((r) => r.pending > 0);

  const all = [...records.values()];
  const graded = all.filter((r) => r.score !== null);
  const totalSpecs = (specs ?? []).length;
  const grade = avg(graded.map((r) => Number(r.score)));
  const conf = avg(all.map((r) => r.confidence ?? 0));

  return (
    <>
      <PageHead crumbs={[{ label: "Sustainability", href: "/sustainability" }, { label: "Impact Grade", href: "/impact-grade" }, { label: "Jobs" }]} title="Impact Grade by job"
        sub="Every job that has come through the system, rolled up from its specs. Open a job, then a spec, to see the evidence behind each sub-score, edit an input and review it.">
        <CalculateAllButton />
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Jobs with specs" value={String(rows.length)} hint={`${totalSpecs} specs`} />
        <Stat label="Specs graded" value={`${graded.length} of ${totalSpecs}`} hint="Calculate the rest above" />
        <Stat label="Average grade" value={grade === null ? "–" : String(Math.round(grade))} hint={conf === null ? undefined : `${Math.round(conf)}% average confidence`} />
        <Stat label="Need review" value={String(all.filter((r) => r.review_status !== "reviewed").length)} tone={all.some((r) => r.review_status === "disputed") ? "bad" : undefined} hint="Unreviewed or disputed" />
      </section>

      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Search job, title or client" className="input min-w-56" />
        <select name="review" defaultValue={review ?? ""} className="input"><option value="">All jobs</option><option value="needs">Needs review</option></select>
        <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-surface-2">Filter</button>
      </form>

      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted">No jobs match.</p>}
        {rows.map(({ j, ss, rs, grade: g, conf: c, pending }) => (
          <details key={j.id} className="group rounded-xl border border-line bg-surface">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-mono text-xs text-muted">{j.job_number}</span>
              <span className="min-w-40 flex-1 font-semibold">{j.title} <span className="font-normal text-muted">· {j.client_name}</span></span>
              <ImpactGradeBadge score={g} href="/impact-grade/jobs" />
              <span className="w-28 text-xs text-muted">{c === null ? "no data" : `${Math.round(c)}% confident`}</span>
              <span className="w-24 text-xs text-muted">{rs.length} of {ss.length} specs</span>
              {pending > 0 ? <Pill tone="warn">{pending} to review</Pill> : rs.length ? <Pill tone="ok">Reviewed</Pill> : <Pill>Not calculated</Pill>}
              <Link href={`/sourcing/jobs/${j.id}`} className="text-xs text-accent hover:underline">Open job</Link>
            </summary>
            <div className="space-y-2 border-t border-line p-3">
              {ss.map((s) => {
                const r = records.get(s.id);
                return (
                  <details key={s.id} className="rounded-lg border border-line bg-surface-2/50">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-muted">Spec {s.spec_no}</span>
                      <span className="min-w-40 flex-1 font-semibold">{s.title}</span>
                      <ImpactGradeBadge score={r?.score ?? null} href={`/sourcing/specs/${s.id}`} />
                      <span className="w-28 text-xs text-muted">{r ? `${r.confidence ?? 0}% confident` : "not calculated"}</span>
                      <span className="w-40 text-xs text-muted">{r?.supplier_id ? supName.get(r.supplier_id) ?? "supplier" : "no supplier yet"}</span>
                      {r && <Pill tone={r.review_status === "reviewed" ? "ok" : r.review_status === "disputed" ? "bad" : "warn"}>{r.review_status === "reviewed" ? "Reviewed" : r.review_status === "disputed" ? "Disputed" : "Needs review"}</Pill>}
                    </summary>
                    <div className="border-t border-line p-3">
                      {r ? <GradeRecordPanel specId={s.id} record={toRecordView(r, r.supplier_id ? supName.get(r.supplier_id) ?? null : null)} options={options} />
                        : <CalculateButton specId={s.id} />}
                      <p className="mt-3 text-xs"><Link href={`/sourcing/specs/${s.id}`} className="text-accent hover:underline">Open the spec</Link></p>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
