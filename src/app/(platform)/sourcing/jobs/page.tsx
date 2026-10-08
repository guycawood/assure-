import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getJobs } from "@/lib/sourcing-data";
import { JOB_STATUS, money, REGIONS } from "@/lib/sourcing";
import { ButtonLink, Card, Empty, PageHead } from "@/components/ui";
import { JobStatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const status = sp.status ?? "active";
  const q = (sp.q ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const [jobs, clients] = await Promise.all([getJobs(supabase), getClients(supabase)]);
  const markets = [...new Set(jobs.map((j) => j.market))].sort();

  let list = jobs;
  if (status === "active") list = list.filter((j) => !["closed", "cancelled"].includes(j.status));
  else if (status !== "all") list = list.filter((j) => j.status === status);
  if (sp.client) list = list.filter((j) => j.client_id === sp.client);
  if (sp.region) list = list.filter((j) => j.region === sp.region);
  if (sp.market) list = list.filter((j) => j.market === sp.market);
  if (q) list = list.filter((j) => `${j.job_number} ${j.title} ${j.brand ?? ""} ${j.campaign_name ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: "Jobs" }]} title="Jobs" sub="Every job bag: its specs, RFQs, estimate and POs hang off it.">
        <ButtonLink href="/sourcing/jobs/new" variant="primary">New job</ButtonLink>
      </PageHead>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search number, title, brand" className="input w-60" aria-label="Search jobs" />
        <select name="status" defaultValue={status} className="input w-auto" aria-label="Status">
          <option value="active">All active</option>
          <option value="all">All</option>
          {JOB_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select name="client" defaultValue={sp.client ?? ""} className="input w-auto" aria-label="Client">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="region" defaultValue={sp.region ?? ""} className="input w-auto" aria-label="Region">
          <option value="">All regions</option>
          {REGIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select name="market" defaultValue={sp.market ?? ""} className="input w-auto" aria-label="Market">
          <option value="">All markets</option>
          {markets.map((m) => <option key={m}>{m}</option>)}
        </select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>

      <Card className="min-w-0 overflow-x-auto">
        {jobs.length === 0 ? (
          <Empty title="No jobs yet"><p>Open a job for each piece of work. Specs, RFQs, estimates and POs all hang off it.</p></Empty>
        ) : list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No jobs match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr><Th>Job</Th><Th>Client</Th><Th>Region</Th><Th>Market</Th><Th>Status</Th><Th>Specs</Th><Th>RFQs</Th><Th>Budget</Th><Th>Delivery</Th></tr></thead>
            <tbody>
              {list.map((j) => (
                <tr key={j.id} className="hover:bg-surface-2/50">
                  <Td><Link href={`/sourcing/jobs/${j.id}`} className="font-semibold hover:underline">{j.job_number}</Link><div className="text-xs text-muted">{j.title}</div></Td>
                  <Td>{j.client_name}</Td>
                  <Td>{j.region}</Td>
                  <Td>{j.market}</Td>
                  <Td><JobStatusPill status={j.status} /></Td>
                  <Td className="tabular-nums">{j.spec_count}</Td>
                  <Td className="tabular-nums">{j.rfq_count}</Td>
                  <Td className="tabular-nums">{money(j.budget, j.currency)}</Td>
                  <Td>{fmtDate(j.target_delivery_date)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
