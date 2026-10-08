import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows } from "@/lib/assure-data";
import { monthGrid, monthLabel, type Certificate, type Contract, type Ncr, type Task } from "@/lib/assure";
import { formatDate } from "@/lib/srt";
import { Card, PageHead, Panel, Stat } from "@/components/ui";
import { MonthCalendar, MonthNav, type CalEvent } from "@/components/assure/bits";

export const metadata: Metadata = { title: "Audit calendar" };

// Certificate expiries, NCR response deadlines, action-plan due dates and contract end dates in one month view.
// Dates are changed on the record itself (with its audit trail), not by dragging on the calendar.
export default async function AuditCalendar({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const supabase = await createClient();
  const [certs, ncrs, tasks, contracts, suppliers] = await Promise.all([
    rows<Certificate>(supabase, "supplier_certificates_v", { cols: "id, supplier_id, cert_type_name, expiry_date, status" }),
    rows<Ncr>(supabase, "ncrs", { cols: "id, supplier_id, ncr_ref, title, due_date, status, severity" }),
    rows<Task>(supabase, "action_plan_tasks", { cols: "id, supplier_id, title, due_date, status, priority" }),
    rows<Contract>(supabase, "contracts", { cols: "id, supplier_id, title, end_date, status" }),
    getSuppliers(supabase),
  ]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const events: CalEvent[] = [
    ...certs.filter((c) => c.expiry_date && c.status !== "not_applicable").map((c) => ({
      date: c.expiry_date!, label: `${c.cert_type_name}: ${name.get(c.supplier_id) ?? ""}`, href: `/assure/suppliers/${c.supplier_id}?tab=compliance`,
      tone: (c.status === "expired" ? "bad" : c.status === "expiring_soon" ? "warn" : "ok") as CalEvent["tone"], icon: "workspace_premium",
    })),
    ...ncrs.filter((n) => n.due_date && n.status === "open").map((n) => ({
      date: n.due_date!, label: `${n.ncr_ref}: ${name.get(n.supplier_id) ?? ""}`, href: `/assure/quality/ncr/${n.id}`, tone: (n.severity === "critical" ? "bad" : "warn") as CalEvent["tone"], icon: "report",
    })),
    ...tasks.filter((t) => t.due_date).map((t) => ({
      date: t.due_date!, label: `${t.title}: ${name.get(t.supplier_id) ?? ""}`, href: `/assure/suppliers/${t.supplier_id}?tab=tasks`,
      tone: (t.status === "verified" || t.status === "completed" ? "neutral" : t.priority === "critical" || t.priority === "high" ? "bad" : "info") as CalEvent["tone"], icon: "task_alt",
    })),
    ...contracts.filter((c) => c.end_date && ["signed", "counter_signed"].includes(c.status)).map((c) => ({
      date: c.end_date!, label: `Contract ends: ${name.get(c.supplier_id ?? "") ?? c.title}`, href: `/assure/contracts/${c.id}`, tone: "accent" as const, icon: "contract",
    })),
  ];
  const inMonth = events.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  const critical = inMonth.filter((e) => e.tone === "bad").length;

  return (
    <>
      <PageHead title="Audit calendar" sub="Certificate expiries, NCR deadlines, action-plan due dates and contract end dates."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Audit calendar" }]} />
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label={`Events in ${monthLabel(month)}`} value={inMonth.length} />
        <Stat label="Critical" value={critical} tone={critical ? "bad" : undefined} hint="Expired certificates, critical NCRs, high-priority tasks" />
        <Stat label="Certificates expiring this month" value={inMonth.filter((e) => e.icon === "workspace_premium").length} />
      </section>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <MonthNav month={month} label={monthLabel(month)} base="/assure/audit-calendar" />
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-ok-soft" />Certificate valid</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-warn-soft" />Expiring or NCR due</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-bad-soft" />Expired or critical</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-info-soft" />Task due</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-accent-soft" />Contract ends</span>
          </div>
        </div>
        <MonthCalendar weeks={monthGrid(month)} month={month} events={events} />
      </Card>
      <Panel title="This month">
        {inMonth.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing due.</p> : (
          <ul className="divide-y divide-line">
            {inMonth.map((e, i) => <li key={i} className="flex justify-between gap-2 px-5 py-2 text-sm"><Link href={e.href ?? "#"} className="hover:text-accent">{e.label}</Link><span className="text-xs text-muted">{formatDate(e.date)}</span></li>)}
          </ul>
        )}
      </Panel>
    </>
  );
}
