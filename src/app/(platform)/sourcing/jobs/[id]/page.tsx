import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBillingEntities, getClients, getEmissionLibraries, getEvents, getJob, getPeople, getSpecs, rows } from "@/lib/sourcing-data";
import { JOB_NEXT, jobStatus, money, specType, type JobStatus } from "@/lib/sourcing";
import { rfqStatus, type Rfq } from "@/lib/rfq";
import { ESTIMATE_STATUS, PO_STATUS, type Estimate, type PurchaseOrder } from "@/lib/orders";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, JobStatusPill, RoutePill, StatusPill, Tabs, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { JobFields } from "@/components/sourcing/job-fields";
import { NewSpecFields } from "@/components/sourcing/spec-fields";
import { createSpec, moveJob, triageJob, updateJob } from "../../actions";

export const metadata: Metadata = { title: "Job" };

const STEPS: { key: string; label: string }[] = [
  { key: "specs", label: "Specs" }, { key: "triage", label: "Triage" }, { key: "rfq", label: "RFQ" },
  { key: "estimate", label: "Estimate" }, { key: "po", label: "Supplier PO" }, { key: "accepted", label: "Vendor accepted" },
];

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const supabase = await createClient();
  const job = await getJob(supabase, id);
  if (!job) notFound();
  const [specs, rfqs, estimates, pos, events, people, clients, entities, libs] = await Promise.all([
    getSpecs(supabase, id), rows<Rfq>(supabase, "v_rfqs", { eq: { job_id: id }, order: [["created_at", false]] }),
    rows<Estimate>(supabase, "v_estimates", { eq: { job_id: id }, order: [["created_at", false]] }),
    rows<PurchaseOrder>(supabase, "v_purchase_orders", { eq: { job_id: id }, order: [["created_at", false]] }),
    getEvents(supabase, { job_id: id }), getPeople(supabase), getClients(supabase), getBillingEntities(supabase), getEmissionLibraries(supabase),
  ]);
  const live = specs.filter((s) => !s.is_draft);
  const done: Record<string, boolean> = {
    specs: live.length > 0,
    triage: live.length > 0 && live.every((s) => s.route),
    rfq: rfqs.some((r) => r.status !== "draft" && r.status !== "cancelled") || (live.length > 0 && live.every((s) => s.route && s.route !== "create")),
    estimate: estimates.some((e) => e.status === "approved"),
    po: pos.some((p) => ["issued", "accepted"].includes(p.status)),
    accepted: pos.some((p) => p.status === "accepted"),
  };
  const createLines = live.filter((s) => s.route === "create");
  const base = `/sourcing/jobs/${id}`;

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: "Jobs", href: "/sourcing/jobs" }, { label: job.job_number }]}
        title={job.title} sub={`${job.job_number} · ${job.client_name} · ${job.market} (${job.region})`}>
        <JobStatusPill status={job.status} />
        <ButtonLink href={`${base}?tab=specs`} variant="primary">Add spec</ButtonLink>
      </PageHead>

      <ol className="flex flex-wrap gap-1.5 text-xs font-semibold" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${done[s.key] ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-muted"}`}>
            <span className="tabular-nums">{i + 1}</span>{s.label}
          </li>
        ))}
      </ol>

      <Tabs base={base} current={tab} tabs={[
        { key: "overview", label: "Overview", icon: "description" },
        { key: "specs", label: "Specs", icon: "layers", count: specs.length },
        { key: "rfqs", label: "RFQs", icon: "request_quote", count: rfqs.length },
        { key: "estimate", label: "Estimate", icon: "receipt_long", count: estimates.length },
        { key: "po", label: "Supplier POs", icon: "shopping_cart", count: pos.length },
        { key: "activity", label: "Files and activity", icon: "history" },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Panel title="Job details">
              <Facts items={[
                ["Job number", job.job_number], ["Client", job.client_name], ["Billing entity", job.billing_entity_name],
                ["Region", job.region], ["Market", job.market], ["Category", job.category], ["Brand", job.brand], ["Campaign", job.campaign_name],
                ["Budget", money(job.budget, job.currency)], ["Opened", fmtDate(job.opened_date)], ["Quotes needed by", fmtDate(job.quote_due_date)],
                ["Target delivery", fmtDate(job.target_delivery_date)], ["Manager", job.manager ? people.get(job.manager) : null],
                ["Briefing+ brief", job.brief_id ?? "Not linked"], ["Client reference", job.client_job_ref],
              ]} />
            </Panel>
            <Panel title="Edit job">
              <div className="p-5">
                <ActionForm action={updateJob} hidden={{ id }} submit="Save job"><JobFields job={job} clients={clients} entities={entities} /></ActionForm>
              </div>
            </Panel>
          </div>
          <Panel title="Move job" sub="Only legal next steps are offered; each move is logged.">
            <div className="space-y-3 p-5">
              <p className="text-sm">Now: <JobStatusPill status={job.status} /></p>
              {JOB_NEXT[job.status as JobStatus].length === 0 ? (
                <p className="text-sm text-muted">This job is finished.</p>
              ) : (
                <ActionForm action={moveJob} hidden={{ id }} submit="Move" variant="secondary">
                  <Field label="Move to" htmlFor="status">
                    <select id="status" name="status" className="input">{JOB_NEXT[job.status as JobStatus].map((s) => <option key={s} value={s}>{jobStatus(s).label}</option>)}</select>
                  </Field>
                  <Field label="Note (needed to cancel)" htmlFor="note"><input id="note" name="note" className="input" /></Field>
                </ActionForm>
              )}
              <p className="text-xs text-muted">Quoting, ordered and in production also move automatically when an RFQ goes out, a PO is approved and the vendor accepts.</p>
            </div>
          </Panel>
        </div>
      )}

      {tab === "specs" && (
        <>
          <Panel title="Specs" sub="What to produce. Each spec is one line: triage decides whether it needs an RFQ."
            actions={live.length > 0 && <ActionForm action={triageJob} hidden={{ job_id: id }} submit="Triage all specs" variant="secondary" inline />}>
            {specs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No specs yet. Add the first one below.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><Th>#</Th><Th>Spec</Th><Th>Type</Th><Th>Quantity</Th><Th>Unit weight</Th><Th>CO2e (kg)</Th><Th>Route</Th><Th>Applied price</Th></tr></thead>
                  <tbody>
                    {specs.map((s) => (
                      <tr key={s.id}>
                        <Td className="tabular-nums">{s.spec_no}</Td>
                        <Td><Link className="font-semibold hover:underline" href={`/sourcing/specs/${s.id}`}>{s.title}</Link>{s.is_draft && <Pill tone="warn">Draft</Pill>}<div className="text-xs text-muted">{s.substrate_name ?? ""}</div></Td>
                        <Td>{specType(s.spec_type)}</Td>
                        <Td className="tabular-nums">{s.total_quantity.toLocaleString("en-GB")}</Td>
                        <Td className="tabular-nums">{s.unit_weight_grams != null ? `${Number(s.unit_weight_grams).toLocaleString("en-GB")} g` : "—"}</Td>
                        <Td className="tabular-nums">{s.co2e_total_kg != null ? Number(s.co2e_total_kg).toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—"}</Td>
                        <Td><RoutePill route={s.route} confidence={s.confidence} />{s.route === "push" && <div className="text-xs text-muted">Supplier: {s.push_status}</div>}</Td>
                        <Td className="tabular-nums">{s.route && s.route !== "create" ? money(s.triage_unit_price, job.currency, 2) : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {createLines.length > 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <p className="text-sm">{createLines.length} line(s) are routed <RoutePill route="create" /> and need quotes.</p>
              <ButtonLink href={`/rfq/new?job=${id}`} variant="primary">Create an RFQ in RFQ+</ButtonLink>
            </Card>
          )}
          <Panel title="Add a spec">
            <div className="p-5"><ActionForm action={createSpec} hidden={{ job_id: id }} submit="Add spec"><NewSpecFields substrates={libs.substrateList} /></ActionForm></div>
          </Panel>
        </>
      )}

      {tab === "rfqs" && (
        <Panel title="RFQs" sub="Managed in RFQ+" actions={<ButtonLink href={`/rfq/new?job=${id}`} variant="primary">New RFQ</ButtonLink>}>
          {rfqs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No RFQs for this job.</p> : (
            <table className="w-full text-sm">
              <thead><tr><Th>RFQ</Th><Th>Status</Th><Th>Due</Th><Th>Suppliers</Th><Th>Quotes</Th><Th>Minimum</Th><Th>Awarded to</Th></tr></thead>
              <tbody>{rfqs.map((r) => (
                <tr key={r.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/rfq/${r.id}`}>{r.rfq_number}</Link><div className="text-xs text-muted">{r.title}</div></Td>
                  <Td><Pill tone={rfqStatus(r.status).tone}>{rfqStatus(r.status).label}</Pill>{r.high_value_alert && <Pill tone="bad">High value</Pill>}</Td>
                  <Td>{fmtDateTime(r.due_at)}</Td><Td>{r.invited_count}</Td><Td>{r.quote_count}</Td><Td>{r.min_quotes_required ?? "—"}</Td><Td>{r.awarded_supplier_name ?? "—"}</Td>
                </tr>))}</tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === "estimate" && (
        <Panel title="Estimates" sub="Managed in Order Management+">
          {estimates.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No estimates yet. Awarding an RFQ, or Adopt / Adapt / accepted Push lines, create one.</p> : (
            <table className="w-full text-sm">
              <thead><tr><Th>Estimate</Th><Th>Supplier</Th><Th>Source</Th><Th>Cost</Th><Th>Sell</Th><Th>Saving vs target</Th><Th>Status</Th></tr></thead>
              <tbody>{estimates.map((e) => (
                <tr key={e.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link></Td>
                  <Td>{e.supplier_name}</Td><Td className="capitalize">{e.source}</Td><Td>{money(e.base_cost, e.currency)}</Td><Td>{money(e.sell_price, e.currency)}</Td>
                  <Td>{money(e.savings_vs_target, e.currency)}</Td><Td><StatusPill meta={ESTIMATE_STATUS} value={e.status} /></Td>
                </tr>))}</tbody>
            </table>
          )}
          {live.some((s) => s.route && s.route !== "create") && (
            <p className="border-t border-line px-5 py-3 text-sm text-muted">Lines priced at triage go to an estimate from the <Link className="font-semibold text-fg hover:underline" href="/sourcing/triage">triage basket</Link>.</p>
          )}
        </Panel>
      )}

      {tab === "po" && (
        <Panel title="Supplier POs" sub="Managed in Order Management+">
          {pos.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No purchase orders yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Value</Th><Th>DOA level needed</Th><Th>Status</Th><Th>Delivery</Th></tr></thead>
              <tbody>{pos.map((p) => (
                <tr key={p.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/orders/purchase-orders/${p.id}`}>{p.po_number}</Link></Td>
                  <Td>{p.supplier_name}</Td><Td>{money(p.total_value, p.currency)}</Td><Td>Level {p.required_doa_level}</Td>
                  <Td><StatusPill meta={PO_STATUS} value={p.status} /></Td><Td>{fmtDate(p.delivery_date)}</Td>
                </tr>))}</tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === "activity" && (
        <>
          <Panel title="Activity" sub="Every step on this job, its RFQs, estimates and POs (append-only)"><ActivityList events={events} people={people} /></Panel>
          <Card className="px-5 py-4 text-sm text-muted">File uploads (artwork, proofs, control documents) arrive with the shared document store; until then attach files in Sourcing Hub and reference them in the job notes.</Card>
        </>
      )}
    </>
  );
}
