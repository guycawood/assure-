import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDeployments, getOutlets, getTickets, getVisits } from "@/lib/execution-data";
import { AUDIT_STATUS, STAGE, STAGES, TICKET_STATUS, cap, retailMetrics } from "@/lib/execution";
import { ButtonLink, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Execution+" };

export default async function ExecutionDashboard() {
  await requireInternal();
  const supabase = await createClient();
  const [deps, tickets, outlets, visits] = await Promise.all([getDeployments(supabase), getTickets(supabase), getOutlets(supabase), getVisits(supabase)]);
  const awaiting = deps.filter((d) => d.stage === "delivered");
  const openTickets = tickets.filter((t) => ["open", "in_progress"].includes(t.status));
  const flagged = deps.filter((d) => d.gps_flag && ["installed", "audited", "rejected"].includes(d.stage));
  const toAudit = deps.filter((d) => d.stage === "installed");
  const m = retailMetrics(deps, tickets, outlets.length);
  const upcoming = visits.filter((v) => v.status === "scheduled").slice(0, 6);

  return (
    <>
      <PageHead title="Execution+" sub="Outlets, recces, installs with photo and GPS evidence, audits scored against the governed display criteria, maintenance and the quality gates that close a job.">
        <ButtonLink href="/execution/outlets">Outlets</ButtonLink>
        <ButtonLink href="/execution/deployments" variant="primary">Deployments</ButtonLink>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Awaiting install" value={awaiting.length} hint="Delivered to the outlet, not yet installed" icon={<MSymbol name="handyman" />} />
        <Stat label="Open maintenance tickets" value={openTickets.length} tone={openTickets.length ? "warn" : "ok"} hint={<Link className="underline" href="/execution/tickets">See tickets</Link>} icon={<MSymbol name="build" />} />
        <Stat label="Audit pass rate" value={m.auditPassRate == null ? "—" : `${m.auditPassRate}%`} tone={m.auditPassRate == null ? undefined : m.auditPassRate >= 90 ? "ok" : m.auditPassRate >= 75 ? "warn" : "bad"} hint={`${m.audited} audited · ${toAudit.length} waiting`} icon={<MSymbol name="fact_check" />} />
        <Stat label="Installs flagged > 200 m" value={flagged.length} tone={flagged.length ? "warn" : "ok"} hint="GPS position too far from the outlet" icon={<MSymbol name="location_off" />} />
      </div>

      <Panel title="Pipeline" sub="Deployments by stage. Planned, in transit and delivered follow the delivery automatically.">
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((s) => (
            <Link key={s} href={`/execution/deployments?stage=${s}`} className="bg-surface px-4 py-3 hover:bg-surface-2">
              <p className="eyebrow">{STAGE[s].label}</p>
              <p className="font-display text-2xl font-bold tabular-nums">{deps.filter((d) => d.stage === s).length}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Needs attention" actions={<ButtonLink href="/execution/deployments">All</ButtonLink>}>
          {[...toAudit, ...awaiting].length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <table className="w-full text-sm"><thead><tr><Th>Deployment</Th><Th>Outlet</Th><Th>Stage</Th><Th>Audit</Th></tr></thead>
              <tbody>{[...toAudit, ...awaiting].slice(0, 10).map((d) => (
                <tr key={d.id}><Td><Link className="font-semibold hover:underline" href={`/execution/deployments/${d.id}`}>{d.deployment_code}</Link><div className="text-xs text-muted">{d.spec_title}</div></Td>
                  <Td>{d.outlet_name}<div className="text-xs text-muted">{d.market} · {d.region}</div></Td>
                  <Td><StatusPill meta={STAGE} value={d.stage} />{d.gps_flag && <div className="text-xs text-warn">GPS {d.gps_distance_m != null ? `${Math.round(Number(d.gps_distance_m))} m` : "missing"}</div>}</Td>
                  <Td><StatusPill meta={AUDIT_STATUS} value={d.audit_status} /></Td></tr>))}</tbody></table>
          )}
        </Panel>
        <Panel title="Open maintenance tickets" actions={<ButtonLink href="/execution/tickets">All</ButtonLink>}>
          {openTickets.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No open tickets.</p> : (
            <table className="w-full text-sm"><thead><tr><Th>Ticket</Th><Th>Outlet</Th><Th>Issue</Th><Th>Status</Th></tr></thead>
              <tbody>{openTickets.slice(0, 10).map((t) => (
                <tr key={t.id}><Td><Link className="font-semibold hover:underline" href={`/execution/tickets/${t.id}`}>{t.ticket_code}</Link><div className="text-xs text-muted">{fmtDate(t.reported_at)}</div></Td>
                  <Td>{t.outlet_name}</Td><Td>{cap(t.issue_type)}<div className="text-xs text-muted">{cap(t.severity)}</div></Td><Td><StatusPill meta={TICKET_STATUS} value={t.status} /></Td></tr>))}</tbody></table>
          )}
        </Panel>
      </div>

      <Panel title="Upcoming visits" actions={<ButtonLink href="/execution/visits">All visits</ButtonLink>}>
        {upcoming.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing scheduled.</p> : (
          <table className="w-full text-sm"><thead><tr><Th>Date</Th><Th>Type</Th><Th>Outlet</Th><Th>Assigned to</Th></tr></thead>
            <tbody>{upcoming.map((v) => <tr key={v.id}><Td>{fmtDate(v.scheduled_date)}</Td><Td>{cap(v.visit_type)}</Td><Td>{v.outlet_name}</Td><Td>{v.assigned_to ?? "—"}</Td></tr>)}</tbody></table>
        )}
      </Panel>
    </>
  );
}
