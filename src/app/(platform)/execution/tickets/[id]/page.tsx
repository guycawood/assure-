import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/sourcing-data";
import { getExecEvents, getTicket } from "@/lib/execution-data";
import { ROOT_CAUSES, TICKET_NEXT, TICKET_STATUS, cap } from "@/lib/execution";
import { FileList } from "@/components/file-list";
import { FileUpload } from "@/components/file-upload";
import { PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Facts, StatusPill, fmtDateTime } from "@/components/sourcing/bits";
import { moveTicket } from "../../actions";

export const metadata: Metadata = { title: "Maintenance ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTicket(supabase, id);
  if (!t) notFound();
  const [events, people] = await Promise.all([getExecEvents(supabase, { entity_id: id }), getPeople(supabase)]);
  const next = TICKET_NEXT[t.status] ?? [];
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Maintenance", href: "/execution/tickets" }, { label: t.ticket_code }]}
        title={`Ticket ${t.ticket_code}`} sub={`${cap(t.issue_type)} at ${t.outlet_name} · ${cap(t.severity)} severity`}>
        <StatusPill meta={TICKET_STATUS} value={t.status} />
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Ticket">
            <Facts items={[
              ["Outlet", <Link key="o" className="hover:underline" href={`/execution/outlets/${t.outlet_id}`}>{t.outlet_name}</Link>],
              ["Deployment", t.deployment_id ? <Link key="d" className="hover:underline" href={`/execution/deployments/${t.deployment_id}`}>{t.deployment_code}</Link> : "—"],
              ["Supplier", t.supplier_name], ["Region / market", `${t.region} / ${t.market}`], ["Reported", `${fmtDateTime(t.reported_at)}${t.reported_by_name ? ` by ${t.reported_by_name}` : ""}`],
              ["Root cause", cap(t.root_cause)], ["Resolved", fmtDateTime(t.resolved_at)], ["Closed", fmtDateTime(t.closed_at)],
            ]} />
            <p className="border-t border-line px-5 py-3 text-sm">{t.description}</p>
            {t.resolution_notes && <p className="border-t border-line px-5 py-3 text-sm"><span className="eyebrow mr-2">Resolution</span>{t.resolution_notes}</p>}
          </Panel>
          <Panel title="Photos"><div className="space-y-3 p-5"><FileList entityType="maintenance_ticket" entityId={t.id} empty="No photos." /><FileUpload module="execution" entityType="maintenance_ticket" entityId={t.id} supplierId={t.supplier_id} label="Ticket photo" compact /></div></Panel>
        </div>
        <div className="min-w-0 space-y-4">
          {next.length > 0 && (
            <Panel title="Move the ticket">
              <div className="p-5"><ActionForm action={moveTicket} hidden={{ id }} submit="Update">
                <Field label="Move to" htmlFor="status"><select id="status" name="status" className="input">{next.map((s) => <option key={s} value={s}>{TICKET_STATUS[s].label}</option>)}</select></Field>
                <Field label="Root cause (needed to resolve)" htmlFor="root_cause"><select id="root_cause" name="root_cause" defaultValue={t.root_cause ?? ""} className="input"><option value="">—</option>{ROOT_CAUSES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}</select></Field>
                <Field label="Note (what was done; needed to resolve or cancel)" htmlFor="note"><textarea id="note" name="note" rows={2} className="input" /></Field>
              </ActionForm></div>
            </Panel>
          )}
          <Panel title="History">
            {events.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="divide-y divide-line text-sm">{events.map((e) => (
                <li key={e.id} className="px-5 py-2.5"><div className="flex justify-between gap-2"><span className="font-semibold">{cap(e.event)}{e.detail?.to ? ` → ${cap(String(e.detail.to))}` : ""}</span><span className="text-xs text-muted">{fmtDateTime(e.at)}</span></div>
                  <div className="text-xs text-muted">{e.actor ? people.get(e.actor) ?? "Someone" : "System"}{e.detail?.note ? ` · ${String(e.detail.note)}` : ""}</div></li>))}</ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
