import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHealth } from "@/lib/health";
import { getOtifSummary, getPlanRows, getSpeed, getSupplierQuality } from "@/lib/qaqc-data";
import { fmtDays, fmtPct, levelLabel, planStatus } from "@/lib/qaqc";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Tabs, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "QA/QC and OTIF" };

const BY = [
  { key: "supplier", label: "Supplier" }, { key: "client", label: "Client" }, { key: "market", label: "Market" }, { key: "region", label: "Region" },
  { key: "category", label: "Category" }, { key: "month", label: "Month" }, { key: "job", label: "Job" }, { key: "po", label: "PO" },
];

export default async function QaqcDashboard({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const by = BY.some((b) => b.key === sp.tab) ? sp.tab! : "supplier";
  const supabase = await createClient();
  const [plans, otif, total, quality, speed, health] = await Promise.all([
    getPlanRows(supabase), getOtifSummary(supabase, by), getOtifSummary(supabase, "total"), getSupplierQuality(supabase), getSpeed(supabase),
    getHealth(supabase, "orders"),
  ]);
  const h = (m: string) => health.find((x) => x.metric === m);
  const shown = sp.status ? plans.filter((p) => p.status === sp.status || (sp.status === "review" && p.checkpoints_to_review > 0)) : plans;
  const delivered = speed.filter((s) => s.brief_to_delivery_days != null);
  const t = total[0];

  return (
    <>
      <PageHead title="QA/QC and OTIF" crumbs={[{ label: "Order Management", href: "/orders" }, { label: "QA/QC and OTIF" }]}
        sub="QA/QC level and progress per PO line, on time in full per delivery (POD timestamp against the promised date) and speed to market from brief to delivery." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="OTIF (12 months)" value={fmtPct(h("otif_percent")?.value)} hint={`Target ${fmtPct(h("otif_percent")?.target)} · ${t?.deliveries ?? 0} deliveries measured`} tone={h("otif_percent")?.status} />
        <Stat label="QA/QC first-time pass" value={fmtPct(h("qaqc_first_time_pass")?.value)} hint={`Target ${fmtPct(h("qaqc_first_time_pass")?.target)}`} />
        <Stat label="Waiting for a quality review" value={plans.reduce((s, p) => s + p.checkpoints_to_review, 0)} hint={`Oldest ${fmtDays(h("qaqc_review_age_days")?.value)}`} />
        <Stat label="Checkpoints overdue" value={h("qaqc_overdue_checkpoints")?.value ?? 0} tone={(h("qaqc_overdue_checkpoints")?.value ?? 0) > 0 ? "warn" : "ok"} />
        <Stat label="Speed to market (median)" value={fmtDays(h("speed_to_market_days")?.value)} hint={`Brief to delivery · target ${fmtDays(h("speed_to_market_days")?.target)}`} />
      </div>

      <Panel title="QA/QC plans" sub="One plan per PO line, created when the PO is issued"
        actions={<div className="flex flex-wrap gap-1 text-xs">{["", "review", "in_progress", "failed", "passed"].map((s) => (
          <Link key={s} href={s ? `/orders/qaqc?tab=${by}&status=${s}` : `/orders/qaqc?tab=${by}`} className={`rounded-full px-2.5 py-1 font-semibold ${(sp.status ?? "") === s ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}>
            {s === "" ? "All" : s === "review" ? "To review" : planStatus(s).label}</Link>))}</div>}>
        {shown.length === 0 ? <Empty title="No QA/QC plans here" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Plan</Th><Th>PO / job</Th><Th>Line</Th><Th>Supplier</Th><Th>Level</Th><Th>Progress</Th><Th>Next due</Th><Th>Status</Th></tr></thead>
              <tbody>{shown.map((p) => (
                <tr key={p.id}>
                  <Td className="font-semibold">{p.plan_ref}</Td>
                  <Td>{p.po_id ? <Link className="hover:underline" href={`/orders/purchase-orders/${p.po_id}#qaqc`}>{p.po_number}</Link> : "Spec plan"}<div className="text-xs text-muted">{p.job_number} · {p.client_name}</div></Td>
                  <Td>{p.spec_title ?? "Whole order"}</Td><Td>{p.supplier_name ?? "–"}</Td>
                  <Td>{levelLabel(p.required_level)}{p.required_level !== p.computed_level && <div className="text-xs text-muted">rules: {levelLabel(p.computed_level)}</div>}</Td>
                  <Td>{p.checkpoints_done}/{p.checkpoints}{p.checkpoints_to_review > 0 && <div className="text-xs text-warn">{p.checkpoints_to_review} to review</div>}{p.checkpoints_overdue > 0 && <div className="text-xs text-bad">{p.checkpoints_overdue} overdue</div>}</Td>
                  <Td>{fmtDate(p.next_due)}</Td><Td><Pill tone={planStatus(p.status).tone}>{planStatus(p.status).label}</Pill></Td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="font-display text-[0.95rem] font-bold">On time in full</h2>
          <p className="text-xs text-muted">On time = POD timestamp on or before the promised date (plus the Watchtower tolerance); in full = delivered quantity covers the ordered quantity.</p>
        </div>
        <div className="px-5 pt-3"><Tabs base="/orders/qaqc" current={by} tabs={BY.map((b) => ({ key: b.key, label: b.label }))} /></div>
        {otif.length === 0 ? <Empty title="No delivered or failed deliveries yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>{BY.find((b) => b.key === by)?.label}</Th><Th className="text-right">Deliveries</Th><Th className="text-right">On time</Th><Th className="text-right">In full</Th><Th className="text-right">OTIF</Th><Th className="text-right">Avg days late</Th></tr></thead>
              <tbody>{otif.map((o) => (
                <tr key={o.key}><Td className="font-semibold">{o.label}</Td><Td className="text-right tabular-nums">{o.deliveries}</Td>
                  <Td className="text-right tabular-nums">{o.on_time} · {fmtPct(o.on_time_percent)}</Td><Td className="text-right tabular-nums">{o.in_full} · {fmtPct(o.in_full_percent)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{fmtPct(o.otif_percent)}</Td><Td className="text-right tabular-nums">{o.avg_days_late ?? "–"}</Td></tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Supplier quality" sub="First-time pass rate and NCRs from QA/QC (SRM scorecard input)">
          {quality.length === 0 ? <Empty title="No QA/QC results yet" /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr><Th>Supplier</Th><Th className="text-right">Plans</Th><Th className="text-right">Avg level</Th><Th className="text-right">First-time pass</Th><Th className="text-right">Rejected</Th><Th className="text-right">NCRs (open)</Th></tr></thead>
              <tbody>{quality.map((q) => (
                <tr key={q.supplier_id}><Td className="font-semibold">{q.supplier_name}</Td><Td className="text-right">{q.plans} <span className="text-xs text-muted">({q.plans_passed} passed)</span></Td>
                  <Td className="text-right">{q.avg_level ?? "–"}</Td><Td className="text-right">{fmtPct(q.first_time_pass_rate)}</Td><Td className="text-right">{q.checkpoints_rejected}</Td>
                  <Td className="text-right">{q.ncrs_raised} ({q.ncrs_open})</Td></tr>))}</tbody>
            </table></div>
          )}
        </Panel>
        <Panel title="Speed to market" sub="Days per stage for delivered jobs">
          {delivered.length === 0 ? <Empty title="No delivered jobs yet" /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr><Th>Job</Th><Th className="text-right">Brief → approval</Th><Th className="text-right">Approval → PO</Th><Th className="text-right">PO → POD</Th><Th className="text-right">POD → installed</Th><Th className="text-right">Brief → delivery</Th></tr></thead>
              <tbody>{delivered.map((s) => (
                <tr key={s.job_id}><Td className="font-semibold"><Link className="hover:underline" href={`/execution/jobs/${s.job_id}`}>{s.job_number}</Link><div className="text-xs text-muted">{s.client_name}</div></Td>
                  <Td className="text-right">{fmtDays(s.brief_to_approval_days)}</Td><Td className="text-right">{fmtDays(s.approval_to_po_days)}</Td><Td className="text-right">{fmtDays(s.po_to_pod_days)}</Td>
                  <Td className="text-right">{fmtDays(s.pod_to_installed_days)}</Td><Td className="text-right font-semibold">{fmtDays(s.brief_to_delivery_days)}</Td></tr>))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
    </>
  );
}
