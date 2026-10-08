import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { getClientsLite, getDeployments, getOutlet, getRecces, getSuppliersLite, getTickets, getVisits } from "@/lib/execution-data";
import { getMarkets } from "@/lib/logistics-data";
import { AUDIT_STATUS, RECCE_STATUS, STAGE, TICKET_STATUS, VISIT_STATUS, cap, grade } from "@/lib/execution";
import { ButtonLink, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Facts, StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { OutletFields } from "@/components/execution/outlet-fields";
import { saveOutlet, setOutletSupplier } from "../../actions";

export const metadata: Metadata = { title: "Outlet" };

export default async function OutletPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const o = await getOutlet(supabase, id);
  if (!o) notFound();
  const [recces, deps, visits, tickets, vis, suppliers, markets, clients] = await Promise.all([
    getRecces(supabase, { outlet_id: id }), getDeployments(supabase, { outlet_id: id }), getVisits(supabase, { outlet_id: id }), getTickets(supabase, { outlet_id: id }),
    rows<{ supplier_id: string; source: string; added_at: string }>(supabase, "outlet_suppliers", { eq: { outlet_id: id } }),
    getSuppliersLite(supabase), getMarkets(supabase), getClientsLite(supabase),
  ]);
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));
  const g = grade(o.avg_audit_score);

  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Outlets", href: "/execution/outlets" }, { label: o.name }]}
        title={o.name} sub={`${o.outlet_code} · ${o.client_name ?? "No client"} · ${o.city ?? ""} ${o.market_name ?? o.market} (${o.region})`}>
        <Pill tone={o.status === "active" ? "ok" : o.status === "pending_survey" ? "warn" : "neutral"}>{cap(o.status)}</Pill>
        <ButtonLink href={`/execution/recces?new=${id}`}>New recce</ButtonLink>
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Outlet">
            <Facts items={[
              ["Address", [o.address_line, o.city, o.postcode].filter(Boolean).join(", ") || "—"], ["Region / market", `${o.region} / ${o.market_name ?? o.market}`],
              ["Coordinates", o.latitude != null ? `${o.latitude}, ${o.longitude}` : <span key="c" className="text-warn">Missing: installs can&apos;t be GPS-checked</span>],
              ["Store type", cap(o.store_type)], ["Contact", [o.contact_name, o.contact_phone, o.contact_email].filter(Boolean).join(" · ") || "—"],
              ["Average audit score", o.avg_audit_score != null ? <Pill key="g" tone={g.tone}>{g.letter} · {o.avg_audit_score}%</Pill> : "—"],
            ]} />
          </Panel>
          <Panel title="Deployments" actions={<ButtonLink href={`/execution/deployments?new=${id}`}>Plan an install</ButtonLink>}>
            {deps.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing installed here yet.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Deployment</Th><Th>Job / spec</Th><Th>Supplier</Th><Th>Qty</Th><Th>Stage</Th><Th>Audit</Th></tr></thead>
                <tbody>{deps.map((d) => (
                  <tr key={d.id}><Td><Link className="font-semibold hover:underline" href={`/execution/deployments/${d.id}`}>{d.deployment_code}</Link></Td>
                    <Td>{d.job_number}<div className="text-xs text-muted">{d.spec_title}</div></Td><Td>{d.supplier_name}</Td><Td className="tabular-nums">{d.quantity}</Td>
                    <Td><StatusPill meta={STAGE} value={d.stage} /></Td><Td><StatusPill meta={AUDIT_STATUS} value={d.audit_status} />{d.audit_score != null && <span className="ml-1 text-xs">{d.audit_score}%</span>}</Td></tr>))}</tbody></table>
            )}
          </Panel>
          <Panel title="Recces">
            {recces.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No surveys yet.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Recce</Th><Th>Product / location</Th><Th>Surface</Th><Th>Units fit</Th><Th>Status</Th></tr></thead>
                <tbody>{recces.map((r) => (
                  <tr key={r.id}><Td><Link className="font-semibold hover:underline" href={`/execution/recces/${r.id}`}>{r.recce_code}</Link><div className="text-xs text-muted">{fmtDate(r.survey_date)}{r.captured_by_vendor ? " · vendor" : ""}</div></Td>
                    <Td>{r.product_name ?? "—"}<div className="text-xs text-muted">{r.location_in_store}</div></Td><Td>{cap(r.surface_type)}</Td>
                    <Td className="tabular-nums">{r.units_fit ?? "—"}</Td><Td><StatusPill meta={RECCE_STATUS} value={r.status} /></Td></tr>))}</tbody></table>
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Visits">
              {visits.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
                <ul className="divide-y divide-line text-sm">{visits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-5 py-2.5"><span>{fmtDate(v.scheduled_date)} · {cap(v.visit_type)}{v.outcome ? ` · ${cap(v.outcome)}` : ""}</span><StatusPill meta={VISIT_STATUS} value={v.status} /></li>))}</ul>
              )}
            </Panel>
            <Panel title="Maintenance tickets">
              {tickets.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
                <ul className="divide-y divide-line text-sm">{tickets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5"><Link className="hover:underline" href={`/execution/tickets/${t.id}`}>{t.ticket_code} · {cap(t.issue_type)}</Link><StatusPill meta={TICKET_STATUS} value={t.status} /></li>))}</ul>
              )}
            </Panel>
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Visible to suppliers" sub="Added automatically for deliveries and deployments here; add one by hand to let a vendor survey it.">
            <ul className="divide-y divide-line text-sm">
              {vis.length === 0 && <li className="px-5 py-3 text-muted">No supplier can see this outlet.</li>}
              {vis.map((v) => (
                <li key={v.supplier_id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span>{supName.get(v.supplier_id) ?? "Supplier"} <span className="text-xs text-muted">({v.source})</span></span>
                  <ActionForm action={setOutletSupplier} hidden={{ id, supplier_id: v.supplier_id, visible: "false" }} submit="Remove" variant="secondary" inline />
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-5">
              <ActionForm action={setOutletSupplier} hidden={{ id, visible: "true" }} submit="Share with supplier" variant="secondary">
                <Field label="Supplier" htmlFor="supplier_id"><select id="supplier_id" name="supplier_id" className="input" required><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              </ActionForm>
            </div>
          </Panel>
          <Panel title="Edit outlet">
            <details className="p-5"><summary className="cursor-pointer text-sm font-semibold">Details</summary>
              <div className="mt-4"><ActionForm action={saveOutlet} hidden={{ id }} submit="Save outlet"><OutletFields o={o} markets={markets} clients={clients} /></ActionForm></div>
            </details>
          </Panel>
        </div>
      </div>
    </>
  );
}
