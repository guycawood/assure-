import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOutlets, getTickets } from "@/lib/execution-data";
import { ISSUE_TYPES, SEVERITIES, TICKET_STATUS, cap } from "@/lib/execution";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { createTicket } from "../actions";

export const metadata: Metadata = { title: "Maintenance tickets" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const status = sp.status ?? "live";
  const supabase = await createClient();
  const [all, outlets] = await Promise.all([getTickets(supabase), getOutlets(supabase)]);
  const list = status === "all" ? all : status === "live" ? all.filter((t) => ["open", "in_progress", "resolved"].includes(t.status)) : all.filter((t) => t.status === status);
  const sevTone = (s: string) => (s === "critical" || s === "high" ? "bad" : s === "medium" ? "warn" : "neutral");
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Maintenance" }]} title="Maintenance tickets"
        sub="Faults on installed displays, from report to resolution with a root cause, so quality trends show up by installer and outlet. Failed audits open a ticket automatically." />
      <nav className="flex flex-wrap gap-2 text-sm">
        {[["live", "Not closed"], ...Object.entries(TICKET_STATUS).map(([k, v]) => [k, v.label]), ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/execution/tickets?status=${k}`} className={`rounded-full border px-3 py-1 font-semibold ${status === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{l}</Link>
        ))}
      </nav>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No tickets here" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Ticket</Th><Th>Outlet</Th><Th>Deployment</Th><Th>Issue</Th><Th>Severity</Th><Th>Root cause</Th><Th>Reported</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((t) => (
              <tr key={t.id}>
                <Td><Link className="font-semibold hover:underline" href={`/execution/tickets/${t.id}`}>{t.ticket_code}</Link><div className="max-w-[28ch] truncate text-xs text-muted">{t.description}</div></Td>
                <Td>{t.outlet_name}<div className="text-xs text-muted">{t.market} · {t.region}</div></Td>
                <Td>{t.deployment_id ? <Link className="hover:underline" href={`/execution/deployments/${t.deployment_id}`}>{t.deployment_code}</Link> : "—"}<div className="text-xs text-muted">{t.supplier_name}</div></Td>
                <Td>{cap(t.issue_type)}</Td><Td><Pill tone={sevTone(t.severity)}>{cap(t.severity)}</Pill></Td><Td>{cap(t.root_cause)}</Td>
                <Td>{fmtDate(t.reported_at)}</Td><Td><StatusPill meta={TICKET_STATUS} value={t.status} /></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Panel title="Raise a ticket">
        <details className="p-5"><summary className="cursor-pointer text-sm font-semibold">New ticket at an outlet</summary>
          <div className="mt-4"><ActionForm action={createTicket} submit="Raise ticket">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Outlet" htmlFor="outlet_id"><select id="outlet_id" name="outlet_id" className="input" required><option value="">Choose…</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              <Field label="Issue" htmlFor="issue_type"><select id="issue_type" name="issue_type" className="input">{ISSUE_TYPES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
              <Field label="Severity" htmlFor="severity"><select id="severity" name="severity" defaultValue="medium" className="input">{SEVERITIES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
            </div>
            <Field label="Description" htmlFor="description"><textarea id="description" name="description" rows={2} className="input" required /></Field>
            <p className="text-xs text-muted">For a fault on a specific install, raise it from the deployment so the supplier is linked.</p>
          </ActionForm></div>
        </details>
      </Panel>
    </>
  );
}
