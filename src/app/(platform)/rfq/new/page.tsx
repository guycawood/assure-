import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJob, getJobs, getLibrary, getSpecs, getVersions, rows } from "@/lib/sourcing-data";
import { specType, type LibraryRecord, type SpecVersion } from "@/lib/sourcing";
import { MAX_BREAKS, rfqBlockers, specForm, type SpecHub } from "@/lib/sourcing-hub";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { RoutePill } from "@/components/sourcing/bits";
import { createRfq } from "../actions";

export const metadata: Metadata = { title: "New RFQ" };

function IncotermSelect({ id, name, records, label, emptyLabel }: { id: string; name: string; records: LibraryRecord[]; label: string; emptyLabel: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} name={name} defaultValue="" className="input">
        <option value="">{emptyLabel}</option>
        {records.map((r) => <option key={r.id} value={r.code ?? ""}>{r.code} · {r.name}</option>)}
      </select>
    </Field>
  );
}

/** One RFQ line: the whole spec, or one variant (version) of it. Field names carry the line key. */
function LineRow({ k, title, sub, defaultBreaks, checked, incoterms, badge }: {
  k: string; title: string; sub: string; defaultBreaks: string; checked: boolean; incoterms: LibraryRecord[]; badge?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="grid gap-3 lg:grid-cols-12">
        <label className="flex items-start gap-2 lg:col-span-4">
          <input type="checkbox" name="line" value={k} defaultChecked={checked} className="mt-1" />
          <span><span className="font-semibold">{title}</span> {badge}<span className="block text-xs text-muted">{sub}</span></span>
        </label>
        <Field label={`Quantity breaks (up to ${MAX_BREAKS})`} htmlFor={`breaks_${k}`} className="lg:col-span-3"><input id={`breaks_${k}`} name={`breaks_${k}`} defaultValue={defaultBreaks} className="input" placeholder="e.g. 500, 1000, 2500, 5000" /></Field>
        <Field label="Target unit prices (optional)" htmlFor={`targets_${k}`} className="lg:col-span-3"><input id={`targets_${k}`} name={`targets_${k}`} className="input" placeholder="One per break" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm lg:col-span-2"><input type="checkbox" name={`show_${k}`} /> Show targets to suppliers</label>
      </div>
      <details className="rounded-lg border border-line px-3 py-2 text-sm">
        <summary className="cursor-pointer font-semibold">Run-on, incoterm, delivery date and delivery points</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Run-on: price per extra N units" htmlFor={`runon_${k}`} hint="Suppliers quote the price of each extra block"><input id={`runon_${k}`} name={`runon_${k}`} inputMode="numeric" className="input" placeholder="e.g. 100" /></Field>
          <IncotermSelect id={`inc_${k}`} name={`inc_${k}`} records={incoterms} label="Incoterm for this line" emptyLabel="Same as the RFQ" />
          <Field label="Delivery date" htmlFor={`date_${k}`}><input id={`date_${k}`} name={`date_${k}`} type="date" className="input" /></Field>
          <Field label="Note to suppliers" htmlFor={`notes_${k}`}><input id={`notes_${k}`} name={`notes_${k}`} className="input" /></Field>
          <Field label="Delivery points (one per line: name; country; quantity; YYYY-MM-DD)" htmlFor={`dps_${k}`} className="sm:col-span-2 lg:col-span-4">
            <textarea id={`dps_${k}`} name={`dps_${k}`} rows={2} className="input" placeholder={"Berlin DC; Germany; 300; 2026-12-01\nMunich DC; Germany; 200"} />
          </Field>
        </div>
      </details>
    </div>
  );
}

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
        <PageHead crumbs={crumbs} title="New RFQ" sub="Pick the job. Spec lines that triage routed to Create can go out to RFQ; others need a rate-card exception." />
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

  const [job, specsRaw, lines, incoterms] = await Promise.all([
    getJob(supabase, sp.job), getSpecs(supabase, sp.job), rows<{ spec_id: string; rfq_id: string }>(supabase, "rfq_lines", { limit: 10000 }), getLibrary(supabase, "incoterms"),
  ]);
  if (!job) return <PageHead crumbs={crumbs} title="Job not found" />;
  const specs = specsRaw as SpecHub[];
  const onRfq = new Set(lines.map((l) => l.spec_id));
  const triaged = specs.filter((s) => !s.is_draft && s.route);
  const eligible = triaged.filter((s) => s.route === "create");
  const exceptionOnly = triaged.filter((s) => s.route !== "create");
  const untriaged = specs.filter((s) => !triaged.includes(s));
  const versionsBySpec = new Map<string, SpecVersion[]>(await Promise.all(triaged.map(async (s) => [s.id, await getVersions(supabase, s.id)] as [string, SpecVersion[]])));
  const defaultDue = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  const specLines = (s: SpecHub, checked: boolean, badge?: React.ReactNode) => {
    const vs = versionsBySpec.get(s.id) ?? [];
    const blockers = rfqBlockers(s);
    const sub = `${specType(s.spec_type)} · ${specForm(s.spec_form).label} · ${s.total_quantity.toLocaleString("en-GB")} units${onRfq.has(s.id) ? " · already on an RFQ" : ""}${blockers.length ? ` · needs ${blockers.join(", ")} before sending` : ""}`;
    return (
      <div key={s.id}>
        <LineRow k={s.id} title={s.title} sub={sub} defaultBreaks={String(s.total_quantity)} checked={checked && !onRfq.has(s.id)} incoterms={incoterms} badge={badge} />
        {vs.length > 1 && (
          <div className="ml-6 border-l-2 border-line">
            <p className="px-5 pt-2 text-xs font-semibold text-muted">Or quote each variant as its own line (one RFQ, several variants):</p>
            {vs.map((v) => (
              <LineRow key={v.id} k={`${s.id}:${v.id}`} title={`${s.title}: ${v.name}`} sub={`Variant · ${v.quantity.toLocaleString("en-GB")} units`} defaultBreaks={String(v.quantity)} checked={false} incoterms={incoterms} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHead crumbs={crumbs} title={`New RFQ for ${job.job_number}`} sub={`${job.title} · ${job.client_name} · ${job.market} (${job.region}). Quotes are sealed: suppliers never see each other's prices.`} />
      {triaged.length === 0 ? (
        <Card className="px-5 py-6 text-sm">No spec on this job has been triaged. <ButtonLink href={`/sourcing/jobs/${job.id}?tab=specs`}>Open the job</ButtonLink></Card>
      ) : (
        <ActionForm action={createRfq} hidden={{ job_id: job.id }} submit="Create draft RFQ" pendingLabel="Creating…">
          <Panel title="Lines" sub={`First quantity break is the main one: totals, benchmarks and the estimate use it. Up to ${MAX_BREAKS} breaks per line.`}>
            <div className="divide-y divide-line">
              {eligible.map((s) => specLines(s, true))}
              {exceptionOnly.length > 0 && (
                <>
                  <p className="bg-surface-2 px-5 py-2 text-xs font-semibold text-muted">Priced from a rate card at triage. Tick these only with a rate-card exception (below).</p>
                  {exceptionOnly.map((s) => specLines(s, false, <RoutePill route={s.route} confidence={s.confidence} />))}
                </>
              )}
            </div>
          </Panel>
          <Panel title="RFQ details">
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" htmlFor="title" className="sm:col-span-2"><input id="title" name="title" required defaultValue={job.title} className="input" /></Field>
              <Field label="Quotes due (date)" htmlFor="due_date"><input id="due_date" name="due_date" type="date" required defaultValue={job.quote_due_date ?? defaultDue} className="input" /></Field>
              <Field label="Time" htmlFor="due_time"><input id="due_time" name="due_time" type="time" defaultValue="17:00" className="input" /></Field>
              <IncotermSelect id="incoterm" name="incoterm" records={incoterms} label="Incoterm" emptyLabel="DDP (default)" />
              <Field label="Named place" htmlFor="incoterm_place" hint="Where the incoterm applies, e.g. Ningbo port"><input id="incoterm_place" name="incoterm_place" className="input" /></Field>
              <Field label="Estimated value" htmlFor="estimated_value" hint="Leave empty to use target price × first break. Sets the control-matrix band and the high-value check." className="sm:col-span-2">
                <input id="estimated_value" name="estimated_value" inputMode="decimal" className="input" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="rate_card_exception" /> Rate-card exception</label>
              <Field label="Why go to RFQ despite the rate card" htmlFor="rate_card_exception_reason" className="sm:col-span-3"><input id="rate_card_exception_reason" name="rate_card_exception_reason" className="input" placeholder="Needed when a ticked line was priced from a rate card" /></Field>
              <Field label="Internal notes (suppliers don't see these)" htmlFor="notes" className="sm:col-span-2 lg:col-span-4"><input id="notes" name="notes" className="input" /></Field>
            </div>
          </Panel>
        </ActionForm>
      )}
      {untriaged.length > 0 && (
        <Panel title="Other specs on this job" sub="Drafts or not triaged yet, so they can't go to RFQ">
          <ul className="divide-y divide-line text-sm">{untriaged.map((s) => <li key={s.id} className="flex items-center justify-between px-5 py-2"><span>{s.title}</span>{s.is_draft ? <Pill tone="warn">Draft</Pill> : <RoutePill route={s.route} confidence={s.confidence} />}</li>)}</ul>
        </Panel>
      )}
    </>
  );
}
