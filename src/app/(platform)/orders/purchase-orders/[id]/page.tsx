import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEvents, getMyAccess, getPeople, one } from "@/lib/sourcing-data";
import { money } from "@/lib/sourcing";
import { PO_STATUS, type PurchaseOrder } from "@/lib/orders";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, StatusPill, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { approvePo, etenderPo, rejectPo } from "../../actions";
import { getJourney, getPlans, reviewableIds } from "@/lib/qaqc-data";
import { QaqcPlans } from "@/components/qaqc/plan-panel";
import { JourneyTimeline } from "@/components/qaqc/journey-timeline";
import { createPlans } from "../../qaqc/actions";
import { getSheetDetails, getSheetRows } from "@/lib/tech-sheet-data";
import { PoTechSheets } from "@/components/tech-sheet/internal-panel";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const p = await one<PurchaseOrder>(supabase, "v_purchase_orders", id);
  if (!p) notFound();
  const [events, people, access, supplier] = await Promise.all([
    getEvents(supabase, { entity_id: id }), getPeople(supabase), getMyAccess(supabase, me.id, me.is_admin, me.srt_role),
    one<{ purchasing_blocked: boolean; active: boolean }>(supabase, "suppliers", p.supplier_id),
  ]);
  const [plans, journey] = await Promise.all([getPlans(supabase, { po: id }), getJourney(supabase, p.job_id)]);
  const reviewable = await reviewableIds(supabase, plans);
  const techSheets = await getSheetDetails(supabase, (await getSheetRows(supabase, { po_id: id })).map((r) => r.id));
  const blocked = !supplier || supplier.purchasing_blocked || !supplier.active;
  const [{ data: etPending }, { data: etCan }] = await Promise.all([
    supabase.rpc("po_etender_pending", { p_po: id }), supabase.rpc("po_etender_can_decide", { p_po: id }),
  ]);
  const canApprove = !etPending && p.status === "pending_approval" && p.created_by !== me.id && access.doa_level != null && access.doa_level >= p.required_doa_level;
  const why = p.status !== "pending_approval" ? null
    : etPending ? "This PO is over the client's e-tender threshold: the Procurement head approves it before DOA approval."
    : p.created_by === me.id ? "You raised this PO, so someone else must approve it."
    : access.doa_level == null ? "You have no delegated approval authority in Sourcing."
    : access.doa_level < p.required_doa_level ? `This PO needs DOA level ${p.required_doa_level}; your level is ${access.doa_level}.` : null;

  return (
    <>
      <PageHead crumbs={[{ label: "Order Management", href: "/orders" }, { label: "Purchase orders", href: "/orders/purchase-orders" }, { label: p.po_number }]}
        title={`Purchase order ${p.po_number}`} sub={`${p.supplier_name} · ${p.job_number} · ${p.client_name} · ${p.market} (${p.region})`}>
        <StatusPill meta={PO_STATUS} value={p.status} />
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Order">
            <Facts items={[
              ["Supplier", `${p.supplier_name} (${p.supplier_code ?? "—"})`], ["Value", money(p.total_value, p.currency, 2)],
              ["Estimate", <Link key="e" className="hover:underline" href={`/orders/estimates/${p.estimate_id}`}>{p.estimate_number}</Link>],
              ["Job", <Link key="j" className="hover:underline" href={`/sourcing/jobs/${p.job_id}`}>{p.job_number}</Link>],
              ["PO date", fmtDate(p.po_date)], ["Delivery date", fmtDate(p.delivery_date)],
              ["SRM status now", blocked ? <Pill key="b" tone="bad">Blocked for purchasing</Pill> : <Pill key="ok" tone="ok">Eligible</Pill>],
              ["E-tender", p.exceeds_e_tender ? "Over the client's e-tender threshold: check the tender was run" : "Under threshold"],
              ["Vendor response", p.vendor_responded_at ? `${fmtDateTime(p.vendor_responded_at)}${p.vendor_decline_reason ? `: ${p.vendor_decline_reason}` : ""}` : "Not yet"],
            ]} />
          </Panel>
          <Panel title="Delegation of authority" sub="Level needed comes from the Watchtower DOA library version in force on the PO date, in the PO currency where levels exist.">
            <Facts items={[
              ["Level needed", `Level ${p.required_doa_level}`], ["Basis", p.doa_basis],
              ["Approved by", p.approved_by_name ? `${p.approved_by_name} (level ${p.approver_doa_level})` : "Not yet"], ["Approved at", fmtDateTime(p.approved_at)],
            ]} />
            {p.rejected_reason && <p className="border-t border-line px-5 py-2 text-sm text-bad">Rejected: {p.rejected_reason}</p>}
          </Panel>
          <div id="qaqc">
            <Panel title="QA/QC" sub="Level per line from the Watchtower threshold rules; evidence comes from the vendor portal and is checked at upload.">
              {plans.length > 0 ? <QaqcPlans plans={plans} reviewable={reviewable} poId={id} />
                : ["issued", "accepted"].includes(p.status)
                  ? <div className="p-5 text-sm"><p className="mb-3 text-muted">This PO was issued before QA/QC plans existed.</p><ActionForm action={createPlans} hidden={{ po: id }} submit="Create QA/QC plans" variant="secondary" /></div>
                  : <p className="p-5 text-sm text-muted">QA/QC plans are created when the PO is approved and issued.</p>}
            </Panel>
          </div>
          <div id="tech-sheet">
            <Panel title="Technical & packaging data" sub="Declared by the vendor; the pre-shipment QA/QC check is held until the sheet is complete and compares a packed carton with it.">
              <PoTechSheets sheets={techSheets} />
            </Panel>
          </div>
        </div>
        <div className="space-y-4">
          <Panel title="Job timeline" sub="Every step from brief to close, timestamped"><JourneyTimeline rows={journey} compact /></Panel>
          <Panel title="Next step">
            <div className="space-y-3 p-5 text-sm">
              {p.status === "pending_approval" && (
                <>
                  {why && <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">{why}</p>}
                  {etPending && etCan && (
                    <div className="space-y-2 rounded-lg border border-line p-3">
                      <p className="font-semibold">E-tender approval</p>
                      <ActionForm action={etenderPo} hidden={{ id, decision: "approve" }} submit="Approve e-tender">
                        <Field label="Note (optional)" htmlFor="et_note"><input id="et_note" name="note" className="input" placeholder="e.g. tender run, framework agreement" /></Field>
                      </ActionForm>
                      <ActionForm action={etenderPo} hidden={{ id, decision: "reject" }} submit="Reject PO" variant="danger">
                        <Field label="Reason" htmlFor="et_reason"><input id="et_reason" name="note" required className="input" /></Field>
                      </ActionForm>
                    </div>
                  )}
                  {blocked && <p className="rounded-lg bg-bad-soft px-3 py-2 text-bad">The supplier is blocked in SRM; approval will be refused until that is cleared.</p>}
                  {canApprove && (
                    <ActionForm action={approvePo} hidden={{ id }} submit="Approve and issue to vendor" confirm="Approve this PO and issue it to the vendor?">
                      <Field label="Note (optional)" htmlFor="note"><input id="note" name="note" className="input" /></Field>
                    </ActionForm>
                  )}
                  <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer font-semibold">Reject</summary>
                    <div className="mt-3"><ActionForm action={rejectPo} hidden={{ id }} submit="Reject PO" variant="danger"><Field label="Reason" htmlFor="reason"><input id="reason" name="reason" required className="input" /></Field></ActionForm></div>
                  </details>
                </>
              )}
              {p.status === "issued" && <p>Issued to the vendor. They accept or decline in the vendor portal.</p>}
              {p.status === "accepted" && <p className="text-ok">The vendor accepted this PO; the job is in production.</p>}
              {p.status === "declined" && <p className="text-bad">The vendor declined: {p.vendor_decline_reason}. Raise a new PO from the estimate if needed.</p>}
            </div>
          </Panel>
          <Panel title="History"><ActivityList events={events} people={people} /></Panel>
        </div>
      </div>
    </>
  );
}
