import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getJobSurveys, getLibrary, getMarkets, getSurveyResults, getSurveyWaves, getTemplate } from "@/lib/crm-data";
import { NPS_TONE, avg, countBy, nps } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Bars, ClientLink, Disclosure, Input, ScorePill, Select, clientOptions } from "@/components/crm/bits";
import { createWave } from "../actions";

export const metadata: Metadata = { title: "Surveys · CRM" };

// Customer satisfaction: survey waves, the results dashboard (with the 0-10 feedback folded in as NPS-only responses) and
// post-job surveys from Order Management.
export default async function CrmSurveys({ searchParams }: { searchParams: Promise<{ client?: string; market?: string; category?: string; feeling?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [waves, allResults, clients, markets, jobs, services] = await Promise.all([getSurveyWaves(supabase), getSurveyResults(supabase, { client_id: sp.client }),
    getClients(supabase), getMarkets(supabase), getJobSurveys(supabase), getLibrary(supabase, "crm_services")]);
  const results = allResults.filter((r) => (!sp.market || r.market === sp.market) && (!sp.category || r.nps_category === sp.category) && (!sp.feeling || r.feeling === sp.feeling));
  const surveys = results.filter((r) => r.kind === "survey");
  const tpl = waves[0] ? await getTemplate(supabase, waves[0].template_id) : null;
  const sections = tpl?.data.sections ?? [];
  const sectionAvg = sections.map((s) => ({ label: s.label, v: avg(surveys.map((r) => Number(r.section_scores?.[s.key])).filter((n) => !Number.isNaN(n))) }));
  const score = nps(results.map((r) => r.nps));
  const sent = waves.reduce((n, w) => n + w.sent, 0), responded = waves.reduce((n, w) => n + w.responded, 0);
  const svcName = new Map(services.map((s) => [s.id, s.name]));
  const aware = services.map((s) => ({ label: s.name, value: surveys.filter((r) => r.services_aware.includes(s.id)).length, text: "" })).map((x) => ({ ...x, text: String(x.value) }));
  const interested = services.map((s) => ({ label: s.name, value: surveys.filter((r) => r.services_interested.includes(s.id)).length, text: "" })).map((x) => ({ ...x, text: String(x.value) }))
    .filter((x) => x.value > 0);
  const comments = surveys.flatMap((r) => Object.entries(r.comments ?? {}).map(([q, c]) => ({ r, q, c, score: r.scores?.[q] })));

  return (
    <>
      <PageHead title="Surveys" sub="Customer satisfaction surveys (twice a year, or as the contract says), results by client, country and NPS, and short surveys sent when a job closes."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Surveys" }]} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="NPS" value={score ?? "—"} tone={score == null ? undefined : score >= 30 ? "ok" : score >= 0 ? "warn" : "bad"} hint={`${results.length} responses (incl. 0-10 feedback)`} icon={<MSymbol name="reviews" />} />
        <Stat label="Overall rating" value={avg(surveys.map((r) => Number(r.overall)).filter((n) => n > 0)) ?? "—"} hint="Average of the 1-5 statements" icon={<MSymbol name="star" />} />
        <Stat label="Response rate" value={sent ? `${Math.round((100 * responded) / sent)}%` : "—"} hint={`${responded} of ${sent} sent`} icon={<MSymbol name="mark_email_read" />} />
        <Stat label="Comments to read" value={comments.length} hint="Scores of 3 or lower always come with one; internal only" icon={<MSymbol name="comment" />} />
      </div>

      <Panel title="Survey waves" actions={<span className="text-xs text-muted">Template: {tpl?.name ?? "Customer satisfaction survey (standard)"}</span>}>
        {waves.length === 0 ? <Empty title="No surveys yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Wave</Th><Th>Status</Th><Th>Sent</Th><Th>Opened</Th><Th>Responded</Th><Th>Excluded</Th><Th>Closes</Th></tr></thead>
            <tbody>{waves.map((w) => (
              <tr key={w.id}><Td><Link className="font-semibold hover:underline" href={`/crm/surveys/${w.id}`}>{w.name}</Link><div className="text-xs text-muted">{w.period_label}</div></Td>
                <Td><Pill tone={w.status === "sent" ? "ok" : w.status === "draft" ? "neutral" : "info"}>{w.status}</Pill>{w.approval_pending && <div className="mt-1"><Pill tone="warn">Approval pending</Pill></div>}</Td>
                <Td>{w.sent}</Td><Td>{w.opened}</Td><Td>{w.responded}</Td><Td>{w.excluded_count}</Td><Td>{fmtDate(w.closes_on)}</Td></tr>))}</tbody>
          </table></div>
        )}
        <div className="border-t border-line px-5 py-3">
          <details><summary className="cursor-pointer text-sm font-semibold text-accent">Start a survey wave</summary>
            <ActionForm action={createWave} submit="Create" className="mt-3 grid gap-3 sm:grid-cols-3">
              <Input name="name" label="Name" required placeholder="Year-end survey March 2027" />
              <Input name="period" label="Period" placeholder="FY 2026/27" />
              <Input name="closes_on" label="Closes on" type="date" />
            </ActionForm>
          </details>
        </div>
      </Panel>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <Select name="market" label="Country" options={markets.map((m) => ({ value: m.code, label: m.name }))} value={sp.market} empty="All countries" />
        <Select name="category" label="NPS category" options={[{ value: "promoter", label: "Promoters (9-10)" }, { value: "passive", label: "Passives (7-8)" }, { value: "detractor", label: "Detractors (0-6)" }]} value={sp.category} empty="All" />
        <Select name="feeling" label="Customer feeling" options={[{ value: "positive", label: "Positive" }, { value: "neutral", label: "Neutral" }, { value: "negative", label: "Negative" }]} value={sp.feeling} empty="All" />
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter results</button>
        {(sp.client || sp.market || sp.category || sp.feeling) && <Link href="/crm/surveys" className="pb-2 text-sm text-accent underline">Clear</Link>}
      </form>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Section scores" sub="Average of the 1-5 statements" className="xl:col-span-2">
          {surveys.length === 0 ? <Empty title="No survey responses for this filter" /> :
            <Bars rows={sectionAvg.filter((s) => s.v != null).map((s) => ({ label: s.label, value: s.v ?? 0, text: String(s.v), tone: (s.v ?? 0) < 3.5 ? "bg-bad" : (s.v ?? 0) < 4 ? "bg-warn" : "bg-ok" }))} />}
        </Panel>
        <div className="grid gap-4">
          <Panel title="NPS categories"><Bars rows={countBy(results, (r) => r.nps_category).map(([k, n]) => ({ label: k, value: n, text: String(n), tone: k === "promoter" ? "bg-ok" : k === "passive" ? "bg-warn" : "bg-bad" }))} /></Panel>
          <Panel title="By country"><Bars rows={countBy(results, (r) => r.market_name ?? r.market).map(([k, n]) => ({ label: k, value: n, text: String(n) }))} /></Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Services awareness" sub="Responses that knew we offer each service"><Bars rows={aware} /></Panel>
        <Panel title="Services they'd like to hear about">{interested.length ? <Bars rows={interested} /> : <p className="px-5 py-4 text-sm text-muted">None yet.</p>}</Panel>
      </div>

      <Panel title="Responses" sub="Comments are internal only and never shown to clients">
        {results.length === 0 ? <Empty title="No responses" /> : (
          <ul className="divide-y divide-line">{results.slice(0, 50).map((r) => (
            <li key={`${r.kind}-${r.id}`} className="space-y-1 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><ScorePill score={r.nps} /><Pill tone={NPS_TONE[r.nps_category]}>{r.nps_category}</Pill>
                <ClientLink id={r.client_id} name={r.client_name} /><span className="text-xs text-muted">{r.contact_name ?? ""}{r.market ? ` · ${r.market}` : ""} · {fmtDate(r.created_at)} ·{" "}
                  {r.kind === "survey" ? <Link className="underline" href={`/crm/surveys/${r.wave_id}`}>{r.wave_name}</Link> : "0-10 feedback"}</span>
                {r.overall != null && <span className="text-xs">Overall {r.overall}/5</span>}{r.testimonial_opt_in && <Pill tone="accent">Testimonial OK</Pill>}</div>
              {Object.entries(r.comments ?? {}).map(([q, c]) => <p key={q} className="text-muted"><span className="font-semibold">{q}{r.scores?.[q] != null ? ` (${r.scores[q]})` : ""}:</span> {c}</p>)}
              {(r.start_doing || r.continue_doing || r.stop_doing) && <p className="text-xs">{r.start_doing && <>Start: {r.start_doing}. </>}{r.continue_doing && <>Continue: {r.continue_doing}. </>}{r.stop_doing && <>Stop: {r.stop_doing}.</>}</p>}
              {r.services_interested.length > 0 && <p className="text-xs text-muted">Interested in: {r.services_interested.map((s) => svcName.get(s) ?? s).join(", ")}</p>}
            </li>))}</ul>
        )}
      </Panel>

      <Panel title="Post-job surveys" sub="Sent automatically when a job closes in Order Management">
        {jobs.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None yet. They go out when a job closes and the client has a contact flagged to receive surveys.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Project</Th><Th>Client / contact</Th><Th>Spend</Th><Th>Status</Th><Th>Overall</Th><Th>Comment</Th></tr></thead>
            <tbody>{jobs.map((j) => (
              <tr key={j.id}><Td><Link className="font-semibold hover:underline" href={`/sourcing/jobs/${j.job_id}`}>{j.project_number}</Link><div className="text-xs text-muted">{j.job_title}</div></Td>
                <Td>{j.client_name}<div className="text-xs text-muted">{j.contact_name}</div></Td>
                <Td>{j.spend != null ? `${j.currency ?? ""} ${Math.round(j.spend).toLocaleString("en-GB")}` : "—"}</Td>
                <Td><Pill tone={j.status === "responded" ? "ok" : "neutral"}>{j.status}</Pill></Td><Td>{j.overall != null ? `${j.overall}/5` : "—"}</Td><Td className="text-xs">{j.comment ?? ""}</Td></tr>))}</tbody>
          </table></div>
        )}
      </Panel>
      <Disclosure summary="How surveys work">
        <p className="text-sm text-muted">Pick the contacts flagged “receive survey” per account, then send. Each contact gets an email signed by their contact owner with their own link; the link works once and only for that person.
          Contacts who opted out, have left or have no legal basis are excluded and the reason is shown. Large sends wait for a CRM owner&apos;s approval. Clients can also answer from the Client Portal.</p>
      </Disclosure>
      <Card className="px-5 py-3 text-xs text-muted">Survey questions are the governed library “Survey templates” in the <Link href="/crm/watchtower" className="underline">CRM Watchtower</Link>.</Card>
    </>
  );
}
