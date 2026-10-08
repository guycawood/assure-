import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJob, getJobs, getSpecs, rows } from "@/lib/sourcing-data";
import { specType } from "@/lib/sourcing";
import { ButtonLink, Card, PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { RoutePill } from "@/components/sourcing/bits";
import { createRfq } from "../actions";

export const metadata: Metadata = { title: "New RFQ" };

export default async function NewRfqPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const crumbs = [{ label: "RFQ+", href: "/rfq" }, { label: "New RFQ" }];

  if (!sp.job) {
    const [jobs, specs] = await Promise.all([getJobs(supabase), getSpecs(supabase)]);
    const withCreate = jobs.filter((j) => specs.some((s) => s.job_id === j.id && s.route === "create" && !s.is_draft) && !["closed", "cancelled"].includes(j.status));
    return (
      <>
        <PageHead crumbs={crumbs} title="New RFQ" sub="Pick the job. Only spec lines that triage routed to Create can go out to RFQ." />
        <Card className="divide-y divide-line">
          {withCreate.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No job has Create lines waiting. Triage specs in <Link className="underline" href="/sourcing/triage">Sourcing+</Link> first.</p> :
            withCreate.map((j) => (
              <Link key={j.id} href={`/rfq/new?job=${j.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-2">
                <span><span className="font-semibold">{j.job_number}</span> · {j.title} <span className="text-muted">({j.client_name}, {j.market})</span></span>
                <span className="text-muted">{specs.filter((s) => s.job_id === j.id && s.route === "create").length} line(s)</span>
              </Link>
            ))}
        </Card>
      </>
    );
  }

  const [job, specs, lines] = await Promise.all([getJob(supabase, sp.job), getSpecs(supabase, sp.job), rows<{ spec_id: string; rfq_id: string }>(supabase, "rfq_lines", { limit: 10000 })]);
  if (!job) return <PageHead crumbs={crumbs} title="Job not found" />;
  const onRfq = new Set(lines.map((l) => l.spec_id));
  const eligible = specs.filter((s) => !s.is_draft && s.route === "create");
  const others = specs.filter((s) => !eligible.includes(s));
  const defaultDue = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  return (
    <>
      <PageHead crumbs={crumbs} title={`New RFQ for ${job.job_number}`} sub={`${job.title} · ${job.client_name} · ${job.market} (${job.region}). Quotes are sealed: suppliers never see each other's prices.`} />
      {eligible.length === 0 ? (
        <Card className="px-5 py-6 text-sm">No spec on this job is routed to Create. <ButtonLink href={`/sourcing/jobs/${job.id}?tab=specs`}>Open the job</ButtonLink></Card>
      ) : (
        <ActionForm action={createRfq} hidden={{ job_id: job.id }} submit="Create draft RFQ" pendingLabel="Creating…">
          <Panel title="Lines" sub="First quantity break is the main one: totals, benchmarks and the estimate use it. Up to 6 breaks.">
            <div className="divide-y divide-line">
              {eligible.map((s) => (
                <div key={s.id} className="grid gap-3 px-5 py-4 lg:grid-cols-12">
                  <label className="flex items-start gap-2 lg:col-span-4">
                    <input type="checkbox" name="spec" value={s.id} defaultChecked={!onRfq.has(s.id)} className="mt-1" />
                    <span><span className="font-semibold">{s.title}</span><span className="block text-xs text-muted">{specType(s.spec_type)} · {s.total_quantity.toLocaleString("en-GB")} units{onRfq.has(s.id) ? " · already on an RFQ" : ""}</span></span>
                  </label>
                  <Field label="Quantity breaks" htmlFor={`breaks_${s.id}`} className="lg:col-span-3"><input id={`breaks_${s.id}`} name={`breaks_${s.id}`} defaultValue={String(s.total_quantity)} className="input" placeholder="e.g. 1000, 2000, 5000" /></Field>
                  <Field label="Target unit prices (optional)" htmlFor={`targets_${s.id}`} className="lg:col-span-3"><input id={`targets_${s.id}`} name={`targets_${s.id}`} className="input" placeholder="One per break" /></Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm lg:col-span-2"><input type="checkbox" name={`show_${s.id}`} /> Show targets to suppliers</label>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="RFQ details">
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" htmlFor="title" className="sm:col-span-2"><input id="title" name="title" required defaultValue={job.title} className="input" /></Field>
              <Field label="Quotes due (date)" htmlFor="due_date"><input id="due_date" name="due_date" type="date" required defaultValue={job.quote_due_date ?? defaultDue} className="input" /></Field>
              <Field label="Time" htmlFor="due_time"><input id="due_time" name="due_time" type="time" defaultValue="17:00" className="input" /></Field>
              <Field label="Estimated value" htmlFor="estimated_value" hint="Leave empty to use target price × first break. Sets the control-matrix band and the high-value check." className="sm:col-span-2">
                <input id="estimated_value" name="estimated_value" inputMode="decimal" className="input" />
              </Field>
              <Field label="Internal notes (suppliers don't see these)" htmlFor="notes" className="sm:col-span-2"><input id="notes" name="notes" className="input" /></Field>
            </div>
          </Panel>
        </ActionForm>
      )}
      {others.length > 0 && (
        <Panel title="Other specs on this job" sub="Not routed to Create, so they don't need an RFQ">
          <ul className="divide-y divide-line text-sm">{others.map((s) => <li key={s.id} className="flex items-center justify-between px-5 py-2"><span>{s.title}</span><RoutePill route={s.route} confidence={s.confidence} /></li>)}</ul>
        </Panel>
      )}
    </>
  );
}
