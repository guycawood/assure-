import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHealth, getJobs, getSpecs, rows } from "@/lib/sourcing-data";
import { JOB_STATUS, money, pct, ROUTES } from "@/lib/sourcing";
import type { Rfq } from "@/lib/rfq";
import type { Estimate, PurchaseOrder } from "@/lib/orders";
import { ButtonLink, Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { JobStatusPill, RoutePill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Sourcing+" };

export default async function SourcingDashboard() {
  await requireInternal();
  const supabase = await createClient();
  const [jobs, specs, health, rfqs, pos, ests] = await Promise.all([
    getJobs(supabase), getSpecs(supabase), getHealth(supabase),
    rows<Rfq>(supabase, "v_rfqs", { limit: 2000 }), rows<PurchaseOrder>(supabase, "v_purchase_orders", { limit: 2000 }), rows<Estimate>(supabase, "v_estimates", { limit: 2000 }),
  ]);
  const active = jobs.filter((j) => ["open", "quoting", "ordered", "in_production"].includes(j.status));
  const live = specs.filter((s) => !s.is_draft);
  const untriaged = live.filter((s) => !s.route);
  const triaged = live.filter((s) => s.route);
  const noRfq = triaged.filter((s) => s.route !== "create");
  const pipeline = pos.filter((p) => ["issued", "accepted", "pending_approval"].includes(p.status)).reduce((s, p) => s + Number(p.total_value), 0);
  const co2 = live.reduce((s, x) => s + Number(x.co2e_total_kg ?? 0), 0);
  const needsAction = active
    .map((j) => {
      const js = live.filter((s) => s.job_id === j.id);
      const reasons: string[] = [];
      if (j.spec_count === 0) reasons.push("No specs yet");
      if (js.some((s) => !s.route)) reasons.push("Specs to triage");
      if (js.some((s) => s.route === "create") && j.rfq_count === 0) reasons.push("Create lines without an RFQ");
      if (j.target_delivery_date && j.target_delivery_date < new Date().toISOString().slice(0, 10)) reasons.push("Past delivery date");
      return { j, reasons };
    })
    .filter((x) => x.reasons.length > 0)
    .slice(0, 8);
  const h = Object.fromEntries(health.map((x) => [x.metric, x]));
  const total = jobs.length || 1;

  return (
    <>
      <PageHead title="Sourcing+" sub="Jobs, specs and triage: decide how every line is bought before anyone asks a supplier for a price.">
        <ButtonLink href="/sourcing/triage">Triage basket</ButtonLink>
        <ButtonLink href="/sourcing/jobs/new" variant="primary"><MSymbol name="add" size={18} />New job</ButtonLink>
      </PageHead>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active jobs" value={active.length} hint="Open to in production" icon={<MSymbol name="work" />} />
        <Stat label="Specs to triage" value={untriaged.length} tone={untriaged.length ? "warn" : "ok"} hint="Routed before any RFQ" icon={<MSymbol name="alt_route" />} />
        <Stat label="Lines priced without an RFQ" value={pct(triaged.length ? (100 * noRfq.length) / triaged.length : 0, 0)} hint={`${noRfq.length} of ${triaged.length} triaged lines`} icon={<MSymbol name="bolt" />} />
        <Stat label="Material CO2e in live specs" value={`${Math.round(co2).toLocaleString("en-GB")} kg`} hint="Raw materials only, not a product footprint" icon={<MSymbol name="eco" />} />
      </div>

      <Panel title="Sourcing+ health" sub="The numbers the Watchtower checks for this module">
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/rfq?filter=below_min"><Stat label="RFQs below minimum quotes" value={h.rfqs_below_min_quotes?.value ?? 0} tone={h.rfqs_below_min_quotes?.status} hint="Open RFQs with fewer valid quotes than the control matrix needs" /></Link>
          <Link href="/orders/purchase-orders?status=pending_approval"><Stat label="POs awaiting DOA" value={h.pos_awaiting_doa?.value ?? 0} tone={h.pos_awaiting_doa?.status} hint="Need an approver with enough delegated authority" /></Link>
          <Stat label="Savings vs target" value={pct(h.savings_vs_target?.value)} tone={h.savings_vs_target?.status} hint={`Against RFQ target prices · client target ${pct(h.savings_vs_target?.target)}`} />
          <Link href="/rfq?status=draft"><Stat label="High-value RFQs waiting" value={h.high_value_awaiting_approval?.value ?? 0} tone={h.high_value_awaiting_approval?.status} hint="Over the country threshold; a sourcing lead must approve" /></Link>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Jobs by status" className="xl:col-span-1">
          <div className="space-y-3 p-5">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Jobs by status">
              {JOB_STATUS.map((s) => {
                const n = jobs.filter((j) => j.status === s.value).length;
                return n ? <i key={s.value} title={`${s.label}: ${n}`} style={{ width: `${(100 * n) / total}%` }} className={toneBg(s.tone)} /> : null;
              })}
            </div>
            <ul className="grid grid-cols-2 gap-1.5 text-sm">
              {JOB_STATUS.map((s) => (
                <li key={s.value}><Link href={`/sourcing/jobs?status=${s.value}`} className="flex items-center justify-between gap-2 rounded px-1 hover:bg-surface-2"><span>{s.label}</span><Pill tone={s.tone}>{jobs.filter((j) => j.status === s.value).length}</Pill></Link></li>
              ))}
            </ul>
            <p className="text-xs text-muted">Supplier POs in flight: {money(pipeline)} (mixed currencies shown at face value).</p>
          </div>
        </Panel>

        <Panel title="Route mix" sub="How triaged lines are being bought" className="xl:col-span-1">
          <ul className="space-y-2 p-5 text-sm">
            {ROUTES.map((r) => {
              const n = triaged.filter((s) => s.route === r.value).length;
              return (
                <li key={r.value} className="flex items-center gap-3">
                  <span className="w-16"><RoutePill route={r.value} /></span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><i className={`block h-full ${toneBg(r.tone)}`} style={{ width: `${triaged.length ? (100 * n) / triaged.length : 0}%` }} /></span>
                  <span className="w-8 text-right tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Elsewhere in the flow" className="xl:col-span-1">
          <ul className="divide-y divide-line text-sm">
            <li><Link className="flex items-center justify-between px-5 py-3 hover:bg-surface-2" href="/rfq">RFQs out for quotes <Pill tone="accent">{rfqs.filter((r) => r.status === "sent").length}</Pill></Link></li>
            <li><Link className="flex items-center justify-between px-5 py-3 hover:bg-surface-2" href="/orders/estimates">Estimates with clients <Pill tone="accent">{ests.filter((e) => e.status === "sent").length}</Pill></Link></li>
            <li><Link className="flex items-center justify-between px-5 py-3 hover:bg-surface-2" href="/orders/purchase-orders">Supplier POs <Pill>{pos.length}</Pill></Link></li>
          </ul>
        </Panel>
      </div>

      <Panel title="Jobs needing action" actions={<ButtonLink href="/sourcing/jobs">All jobs</ButtonLink>}>
        {needsAction.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nothing waiting. Every active job has specs, they are triaged, and Create lines are out to RFQ.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Job</Th><Th>Client</Th><Th>Market</Th><Th>Status</Th><Th>Why</Th><Th>Delivery</Th></tr></thead>
              <tbody>
                {needsAction.map(({ j, reasons }) => (
                  <tr key={j.id}>
                    <Td><Link className="font-semibold hover:underline" href={`/sourcing/jobs/${j.id}`}>{j.job_number}</Link><div className="text-xs text-muted">{j.title}</div></Td>
                    <Td>{j.client_name}</Td>
                    <Td>{j.market} <span className="text-xs text-muted">· {j.region}</span></Td>
                    <Td><JobStatusPill status={j.status} /></Td>
                    <Td><div className="flex flex-wrap gap-1">{reasons.map((r) => <Pill key={r} tone="warn">{r}</Pill>)}</div></Td>
                    <Td>{fmtDate(j.target_delivery_date)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {untriaged.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm"><RoutePill route={null} /> <span className="ml-2">{untriaged.length} spec line(s) have not been triaged yet.</span></p>
          <ButtonLink href="/sourcing/triage" variant="primary">Open the triage basket</ButtonLink>
        </Card>
      )}
    </>
  );
}

function toneBg(t: string) {
  return t === "ok" ? "bg-ok" : t === "warn" ? "bg-warn" : t === "bad" ? "bg-bad" : t === "info" ? "bg-info" : t === "accent" ? "bg-accent" : "bg-muted";
}
