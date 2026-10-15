import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getContacts, getLibrary, getPeople, getPerformance } from "@/lib/crm-data";
import { OPEN_STAGES, STAGE, money, moneyByCurrency, type PerformanceRow } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, StagePill, clientOptions, libOptions, peopleOptions } from "@/components/crm/bits";
import { savePerformance } from "../actions";

export const metadata: Metadata = { title: "Performance Tracker · CRM" };

type Cut = "next" | "stage" | "cs" | "sme" | "company" | "service";
const CUTS: { key: Cut; label: string; get: (r: PerformanceRow) => string }[] = [
  { key: "next", label: "Next steps", get: (r) => r.next_step_name ?? "Not set" },
  { key: "stage", label: "Stage", get: (r) => STAGE[r.stage]?.label ?? r.stage },
  { key: "cs", label: "CS lead", get: (r) => r.cs_lead_name ?? "Not set" },
  { key: "sme", label: "SME", get: (r) => r.sme_name ?? "Not set" },
  { key: "company", label: "Company", get: (r) => r.client_name },
  { key: "service", label: "Service", get: (r) => r.service_name ?? "Not set" },
];

// The Performance Tracker (HubSpot's "Client Stakeholder Performance"), reviewed weekly.
export default async function CrmPerformance({ searchParams }: { searchParams: Promise<{ cut?: string; open?: string; p50?: string; stale?: string; client?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, clients, contacts, services, steps, people] = await Promise.all([getPerformance(supabase, { client_id: sp.client }), getClients(supabase), getContacts(supabase),
    getLibrary(supabase, "crm_services"), getLibrary(supabase, "crm_next_steps"), getPeople(supabase)]);
  const showClosed = sp.open === "0";
  const rows = all.filter((r) => (showClosed || OPEN_STAGES.includes(r.stage)) && (sp.p50 !== "1" || r.probability >= 50) && (sp.stale !== "1" || r.needs_updating));
  const cut = CUTS.find((c) => c.key === sp.cut) ?? CUTS[0];
  const groups = new Map<string, PerformanceRow[]>();
  for (const r of rows) groups.set(cut.get(r), [...(groups.get(cut.get(r)) ?? []), r]);
  const sorted = [...groups.entries()].sort((a, b) => b[1].reduce((n, r) => n + Number(r.weighted_budget), 0) - a[1].reduce((n, r) => n + Number(r.weighted_budget), 0));
  const link = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
    return `/crm/performance${p ? `?${p}` : ""}`;
  };
  const staleCount = all.filter((r) => r.needs_updating).length;

  return (
    <>
      <PageHead title="Performance Tracker" sub="Opportunities with the client contact, service, next steps, CS lead and SME. Weighted budget is budget times probability. Review weekly; anything untouched for a while is flagged."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Performance Tracker" }]}>
        <Link prefetch={false} href="/crm/export/opportunities" className="text-sm font-semibold text-accent underline">Export CSV</Link>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total budget" value={moneyByCurrency(rows.map((r) => ({ value: r.total_budget, currency: r.currency })))} hint={`${rows.length} opportunities`} icon={<MSymbol name="payments" />} />
        <Stat label="Weighted budget" value={moneyByCurrency(rows.map((r) => ({ value: r.weighted_budget, currency: r.currency })))} icon={<MSymbol name="balance" />} />
        <Stat label="Probability 50%+" value={rows.filter((r) => r.probability >= 50).length} hint={<Link className="underline" href={link({ p50: sp.p50 === "1" ? undefined : "1" })}>{sp.p50 === "1" ? "Show all" : "Show only these"}</Link>} icon={<MSymbol name="trending_up" />} />
        <Stat label="Needs updating" value={staleCount} tone={staleCount ? "warn" : "ok"} hint={<Link className="underline" href={link({ stale: sp.stale === "1" ? undefined : "1" })}>{sp.stale === "1" ? "Show all" : "Show only these"}</Link>} icon={<MSymbol name="update" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">View by:</span>
        {CUTS.map((c) => <Link key={c.key} href={link({ cut: c.key })} className={c.key === cut.key ? "rounded-full bg-accent px-3 py-1 font-semibold text-accent-fg" : "rounded-full border border-line px-3 py-1 hover:bg-surface-2"}>{c.label}</Link>)}
        <Link href={link({ open: showClosed ? undefined : "0" })} className="ml-auto text-accent underline">{showClosed ? "Open only" : "Include won and lost"}</Link>
      </div>

      {sorted.length === 0 ? <Card><Empty title="Nothing to show" /></Card> : sorted.map(([k, list]) => (
        <Panel key={k} title={k} sub={`${list.length} · total ${moneyByCurrency(list.map((r) => ({ value: r.total_budget, currency: r.currency })))} · weighted ${moneyByCurrency(list.map((r) => ({ value: r.weighted_budget, currency: r.currency })))}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Opportunity</Th><Th>Company / contact</Th><Th>Service</Th><Th>Stage</Th><Th>Next steps</Th><Th>CS lead / SME</Th><Th className="text-right">Budget</Th><Th className="text-right">Weighted</Th><Th>Updated</Th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.id} className="align-top">
                  <Td><Link className="font-semibold hover:underline" href={`/crm/pipeline?opp=${r.id}`}>{r.title}</Link><div className="text-xs text-muted">{r.opp_code}</div>
                    <details className="mt-1"><summary className="cursor-pointer text-xs text-accent">Edit tracker fields</summary>
                      <PerfForm r={r} contacts={contacts.filter((c) => c.client_id === r.client_id).map((c) => ({ value: c.id, label: c.full_name }))}
                        services={libOptions(services)} steps={libOptions(steps)} people={peopleOptions(people)} /></details></Td>
                  <Td><ClientLink id={r.client_id} name={r.client_name} /><div className="text-xs text-muted">{r.contact_name ?? <span className="text-warn">No contact</span>}</div></Td>
                  <Td>{r.service_name ?? "—"}</Td>
                  <Td><StagePill stage={r.stage} /><div className="text-xs text-muted">{r.probability}%</div></Td>
                  <Td>{r.next_step_name ?? "—"}{r.next_steps && <div className="text-xs text-muted">{r.next_steps}</div>}</Td>
                  <Td>{r.cs_lead_name ?? "—"}<div className="text-xs text-muted">{r.sme_name ?? ""}</div></Td>
                  <Td className="text-right tabular-nums">{money(r.total_budget, r.currency)}</Td>
                  <Td className="text-right tabular-nums">{money(r.weighted_budget, r.currency)}</Td>
                  <Td>{fmtDate(r.updated_at)}{r.needs_updating && <div><Pill tone="warn">Needs updating</Pill></div>}</Td>
                </tr>))}</tbody>
            </table>
          </div>
        </Panel>
      ))}

      <Disclosure summary="Add to the Performance Tracker">
        <ActionForm action={savePerformance} submit="Add" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="client_id" label="Company" options={clientOptions(clients.filter((c) => c.active))} empty="Choose…" required />
          <Select name="contact_id" label="Contact (required)" options={contacts.map((c) => ({ value: c.id, label: `${c.full_name} (${c.client_name})` }))} empty="Choose…" required />
          <Input name="title" label="Name" required />
          <Select name="service_id" label="Service" options={libOptions(services)} empty="—" />
          <Select name="stage" label="Stage" options={OPEN_STAGES.map((s) => ({ value: s, label: STAGE[s].label }))} value="lead" />
          <Select name="next_step_id" label="Next step" options={libOptions(steps)} empty="—" />
          <Input name="next_steps" label="Next steps detail" />
          <Select name="cs_lead" label="CS lead" options={peopleOptions(people)} empty="—" />
          <Select name="sme" label="SME" options={peopleOptions(people)} empty="—" />
          <Input name="budget" label="Total budget" type="number" step="100" required />
          <Input name="currency" label="Currency" placeholder="Client default" />
          <Input name="probability" label="Probability %" type="number" placeholder="Stage default" />
          <Input name="expected_close" label="Expected close" type="date" />
        </ActionForm>
      </Disclosure>
    </>
  );
}

function PerfForm({ r, contacts, services, steps, people }: { r: PerformanceRow; contacts: { value: string; label: string }[]; services: { value: string; label: string }[];
  steps: { value: string; label: string }[]; people: { value: string; label: string }[] }) {
  if (!OPEN_STAGES.includes(r.stage)) return <p className="mt-1 text-xs text-muted">Closed opportunities can&apos;t be edited.</p>;
  return (
    <ActionForm action={savePerformance} hidden={{ id: r.id }} submit="Save" className="mt-2 grid w-[32rem] max-w-full gap-2 sm:grid-cols-2">
      <Input name="title" label="Name" value={r.title} required className="sm:col-span-2" />
      <Select name="contact_id" label="Contact" options={contacts} value={r.contact_id} empty="Choose…" required />
      <Select name="service_id" label="Service" options={services} value={r.service_id} empty="—" />
      <Select name="next_step_id" label="Next step" options={steps} value={r.next_step_id} empty="—" />
      <Input name="next_steps" label="Next steps detail" value={r.next_steps} />
      <Select name="cs_lead" label="CS lead" options={people} value={r.cs_lead} empty="—" />
      <Select name="sme" label="SME" options={people} value={r.sme} empty="—" />
      <Input name="budget" label="Total budget" type="number" value={r.total_budget} required />
      <Input name="probability" label="Probability %" type="number" value={r.probability} />
      <Input name="currency" label="Currency" value={r.currency} />
      <Input name="expected_close" label="Expected close" type="date" value={r.expected_close} />
    </ActionForm>
  );
}
