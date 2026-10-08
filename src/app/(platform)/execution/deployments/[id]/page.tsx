import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/sourcing-data";
import { getAudits, getCriteria, getDeployment, getExecEvents, getRule, getTickets } from "@/lib/execution-data";
import { AUDIT_STATUS, ISSUE_TYPES, SEVERITIES, STAGE, TICKET_STATUS, cap, grade } from "@/lib/execution";
import { FileList } from "@/components/file-list";
import { FileUpload } from "@/components/file-upload";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Facts, StatusPill, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { AuditForm } from "@/components/execution/audit-form";
import { auditDeployment, createTicket, recordInstall } from "../../actions";

export const metadata: Metadata = { title: "Deployment" };

export default async function DeploymentPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const d = await getDeployment(supabase, id);
  if (!d) notFound();
  const [audits, tickets, criteria, passMark, tolerance, events, people] = await Promise.all([
    getAudits(supabase, { deployment_id: id }), getTickets(supabase, { deployment_id: id }), getCriteria(supabase),
    getRule(supabase, "EXR-PASS", 70), getRule(supabase, "EXR-GPS", 200), getExecEvents(supabase, { entity_id: id }), getPeople(supabase),
  ]);
  const canInstall = ["planned", "in_transit", "delivered"].includes(d.stage) && (!d.delivery_id || d.stage === "delivered");
  const canAudit = ["installed", "audited", "rejected"].includes(d.stage) && d.installed_by !== me.id;
  const g = grade(d.audit_score);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Deployments", href: "/execution/deployments" }, { label: d.deployment_code }]}
        title={`Deployment ${d.deployment_code}`} sub={`${d.spec_title} at ${d.outlet_name} · ${d.supplier_name} · ${d.job_number} (${d.client_name})`}>
        <StatusPill meta={STAGE} value={d.stage} /><StatusPill meta={AUDIT_STATUS} value={d.audit_status} />
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Deployment">
            <Facts items={[
              ["Outlet", <Link key="o" className="hover:underline" href={`/execution/outlets/${d.outlet_id}`}>{d.outlet_name} ({d.outlet_code})</Link>],
              ["Region / market", `${d.region} / ${d.market}`],
              ["Job", <Link key="j" className="hover:underline" href={`/execution/jobs/${d.job_id}`}>{d.job_number}</Link>],
              ["PO", <Link key="p" className="hover:underline" href={`/orders/purchase-orders/${d.po_id}`}>{d.po_number}</Link>],
              ["Spec", `${d.spec_title}${d.spec_version_name ? ` · ${d.spec_version_name}` : ""}`], ["Quantity", d.quantity],
              ["Delivery", d.delivery_id ? <Link key="d" className="hover:underline" href={`/logistics/deliveries/${d.delivery_id}`}>{d.delivery_number} ({cap(d.delivery_status)})</Link> : "Not linked"],
              ["Planned install", fmtDate(d.planned_date)], ["Campaign", d.campaign_name ?? "—"],
            ]} />
          </Panel>
          <Panel title="Install evidence" sub={`Before and after photos are required. The GPS position is checked against the outlet: more than ${tolerance} m away is flagged.`}>
            <Facts items={[
              ["Installed", d.installation_date ? `${fmtDate(d.installation_date)} by ${d.installer_name ?? "—"}${d.installed_by_vendor ? " (vendor)" : ""}` : "Not yet"],
              ["Quantity installed", d.installed_quantity ?? "—"],
              ["GPS position", d.gps_lat != null ? `${d.gps_lat}, ${d.gps_lon}` : "—"],
              ["Distance from outlet", d.gps_flag == null ? "—" : <span key="g" className={d.gps_flag ? "font-semibold text-warn" : "text-ok"}>{d.gps_distance_m != null ? `${Math.round(Number(d.gps_distance_m))} m` : "Can't check (no GPS or outlet coordinates)"}{d.gps_flag ? ` · flagged (over ${d.gps_tolerance_m ?? tolerance} m)` : " · within tolerance"}</span>],
              ["Install notes", d.install_notes],
            ]} />
            <div className="grid gap-4 border-t border-line p-5 lg:grid-cols-2">
              <div className="space-y-2"><p className="eyebrow">Photos</p><FileList entityType="deployment" entityId={d.id} empty="No photos yet." /></div>
              {canInstall && (
                <div className="space-y-2">
                  <FileUpload module="execution" entityType="deployment" entityId={d.id} supplierId={d.supplier_id} label="Before" accept="image/*" compact />
                  <FileUpload module="execution" entityType="deployment" entityId={d.id} supplierId={d.supplier_id} label="After" accept="image/*" compact />
                </div>
              )}
            </div>
          </Panel>
          {canInstall && (
            <Panel title="Record the install" sub="Installers usually do this in the vendor portal on their phone.">
              <div className="p-5">
                <ActionForm action={recordInstall} hidden={{ id }} submit="Record install">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Installation date" htmlFor="installation_date"><input id="installation_date" name="installation_date" type="date" max={today} defaultValue={today} className="input" required /></Field>
                    <Field label="Installer" htmlFor="installer_name"><input id="installer_name" name="installer_name" className="input" required /></Field>
                    <Field label={`Quantity (max ${d.quantity})`} htmlFor="quantity"><input id="quantity" name="quantity" type="number" min={0} max={d.quantity} defaultValue={d.quantity} className="input" required /></Field>
                    <Field label="GPS latitude" htmlFor="lat"><input id="lat" name="lat" type="number" step="0.000001" className="input" /></Field>
                    <Field label="GPS longitude" htmlFor="lon"><input id="lon" name="lon" type="number" step="0.000001" className="input" /></Field>
                    <Field label="Notes" htmlFor="notes"><input id="notes" name="notes" className="input" /></Field>
                  </div>
                </ActionForm>
              </div>
            </Panel>
          )}
          <Panel title="Audits" sub="Scored against the display criteria in the Execution+ Watchtower; weights must total 100%.">
            {audits.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Not audited yet.</p> : (
              <ul className="divide-y divide-line">
                {audits.map((a) => (
                  <li key={a.id} className="space-y-1.5 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><b className="tabular-nums">{a.total_score}%</b> <span className="text-muted">(pass mark {a.pass_mark}%)</span></span>
                      <StatusPill meta={AUDIT_STATUS} value={a.result} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{a.scores.map((s) => <span key={s.code}>{s.name} {s.score} × {s.weight}%</span>)}</div>
                    {a.notes && <p>{a.notes}</p>}
                    <p className="text-xs text-muted">{a.audited_by_name ?? "—"} · {fmtDateTime(a.audited_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Audit">
            <div className="p-5">
              {d.audit_score != null && <p className="mb-3 text-sm">Latest score <Pill tone={g.tone}>{g.letter} · {d.audit_score}%</Pill></p>}
              {canAudit ? <AuditForm deploymentId={id} criteria={criteria} passMark={passMark} action={auditDeployment} />
                : d.installed_by === me.id && d.stage === "installed" ? <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">You recorded this install, so someone else must audit it.</p>
                : <p className="text-sm text-muted">Audits open once the install is recorded.</p>}
            </div>
          </Panel>
          <Panel title="Maintenance">
            <ul className="divide-y divide-line text-sm">
              {tickets.length === 0 && <li className="px-5 py-3 text-muted">No tickets.</li>}
              {tickets.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5"><Link className="hover:underline" href={`/execution/tickets/${t.id}`}>{t.ticket_code} · {cap(t.issue_type)}</Link><StatusPill meta={TICKET_STATUS} value={t.status} /></li>)}
            </ul>
            <details className="border-t border-line p-5 text-sm"><summary className="cursor-pointer font-semibold">Raise a ticket</summary>
              <div className="mt-3"><ActionForm action={createTicket} hidden={{ deployment_id: id }} submit="Raise ticket" variant="secondary">
                <Field label="Issue" htmlFor="issue_type"><select id="issue_type" name="issue_type" className="input">{ISSUE_TYPES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
                <Field label="Severity" htmlFor="severity"><select id="severity" name="severity" defaultValue="medium" className="input">{SEVERITIES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
                <Field label="Description" htmlFor="description"><textarea id="description" name="description" rows={2} className="input" required /></Field>
              </ActionForm></div>
            </details>
          </Panel>
          <Panel title="History">
            {events.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="divide-y divide-line text-sm">{events.map((e) => (
                <li key={e.id} className="px-5 py-2.5"><div className="flex justify-between gap-2"><span className="font-semibold">{cap(e.event)}</span><span className="text-xs text-muted">{fmtDateTime(e.at)}</span></div>
                  <div className="text-xs text-muted">{e.actor ? people.get(e.actor) ?? "Vendor" : "System"}{e.detail?.result ? ` · ${String(e.detail.result)} ${String(e.detail.score ?? "")}` : ""}{e.detail?.gps_flag ? " · GPS flagged" : ""}</div></li>))}</ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
