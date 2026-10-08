import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOutlets, getSuppliersLite, getVisits } from "@/lib/execution-data";
import { VISIT_OUTCOMES, VISIT_STATUS, VISIT_TYPES, cap } from "@/lib/execution";
import { Card, Empty, PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { createVisit, updateVisit } from "../actions";

export const metadata: Metadata = { title: "Visits" };

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const supabase = await createClient();
  const [all, outlets, suppliers] = await Promise.all([getVisits(supabase), getOutlets(supabase), getSuppliersLite(supabase)]);
  const list = status === "all" ? all : status === "open" ? all.filter((v) => ["scheduled", "in_progress"].includes(v.status)) : all.filter((v) => v.status === status);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Visits" }]} title="Visits"
        sub="Field visits that install, fix, audit or survey, with an outcome for every one: a single forward view of site activity." />
      <nav className="flex flex-wrap gap-2 text-sm">
        {[["open", "Upcoming"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/execution/visits?status=${k}`} className={`rounded-full border px-3 py-1 font-semibold ${status === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{l}</Link>
        ))}
      </nav>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No visits" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Visit</Th><Th>Date</Th><Th>Outlet</Th><Th>For</Th><Th>Who</Th><Th>Status</Th><Th>Outcome</Th></tr></thead>
            <tbody>{list.map((v) => (
              <tr key={v.id}>
                <Td className="font-semibold">{v.visit_code}<div className="text-xs font-normal text-muted">{cap(v.visit_type)}</div></Td>
                <Td className={v.status === "scheduled" && v.scheduled_date < today ? "text-bad" : ""}>{fmtDate(v.scheduled_date)}{v.completed_date && <div className="text-xs text-muted">Done {fmtDate(v.completed_date)}</div>}</Td>
                <Td><Link className="hover:underline" href={`/execution/outlets/${v.outlet_id}`}>{v.outlet_name}</Link><div className="text-xs text-muted">{v.market}</div></Td>
                <Td className="text-xs">
                  {v.deployment_id && <Link className="block hover:underline" href={`/execution/deployments/${v.deployment_id}`}>{v.deployment_code}</Link>}
                  {v.ticket_id && <Link className="block hover:underline" href={`/execution/tickets/${v.ticket_id}`}>{v.ticket_code}</Link>}
                  {v.recce_id && <Link className="block hover:underline" href={`/execution/recces/${v.recce_id}`}>{v.recce_code}</Link>}
                </Td>
                <Td>{v.assigned_to ?? "—"}<div className="text-xs text-muted">{v.supplier_name}</div></Td>
                <Td><StatusPill meta={VISIT_STATUS} value={v.status} /></Td>
                <Td>
                  {["scheduled", "in_progress"].includes(v.status) ? (
                    <ActionForm action={updateVisit} hidden={{ id: v.id }} submit="Save" variant="secondary" inline>
                      <select name="status" className="input w-auto" aria-label="Status">{(v.status === "scheduled" ? ["in_progress", "completed", "cancelled"] : ["completed", "cancelled"]).map((s) => <option key={s} value={s}>{VISIT_STATUS[s].label}</option>)}</select>
                      <select name="outcome" className="input w-auto" aria-label="Outcome"><option value="">Outcome…</option>{VISIT_OUTCOMES.map((o) => <option key={o} value={o}>{cap(o)}</option>)}</select>
                      <input name="notes" placeholder="Notes" className="input w-36" aria-label="Notes" />
                    </ActionForm>
                  ) : <span>{cap(v.outcome)}{v.outcome_notes && <span className="block text-xs text-muted">{v.outcome_notes}</span>}</span>}
                </Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Panel title="Schedule a visit">
        <details className="p-5"><summary className="cursor-pointer text-sm font-semibold">New visit</summary>
          <div className="mt-4"><ActionForm action={createVisit} submit="Schedule">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Outlet" htmlFor="outlet_id"><select id="outlet_id" name="outlet_id" className="input" required><option value="">Choose…</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              <Field label="Type" htmlFor="visit_type"><select id="visit_type" name="visit_type" className="input">{VISIT_TYPES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
              <Field label="Date" htmlFor="scheduled_date"><input id="scheduled_date" name="scheduled_date" type="date" defaultValue={today} className="input" required /></Field>
              <Field label="Supplier (optional)" htmlFor="supplier_id"><select id="supplier_id" name="supplier_id" className="input"><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Assigned to" htmlFor="assigned_to"><input id="assigned_to" name="assigned_to" className="input" /></Field>
              <Field label="Notes" htmlFor="notes"><input id="notes" name="notes" className="input" /></Field>
            </div>
          </ActionForm></div>
        </details>
      </Panel>
    </>
  );
}
