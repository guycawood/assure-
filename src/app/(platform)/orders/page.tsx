import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { money } from "@/lib/sourcing";
import { ESTIMATE_STATUS, PO_STATUS, type Estimate, type PurchaseOrder } from "@/lib/orders";
import { handoffStats, ORDER_FLAG, type HandoffRow, type OrderFlag } from "@/lib/sourcing-hub";
import { ButtonLink, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Order Management+" };

export default async function OrdersDashboard() {
  await requireInternal();
  const supabase = await createClient();
  const [ests, pos, outbox, psa, handoffRows] = await Promise.all([
    rows<Estimate & { order_flag: OrderFlag | null }>(supabase, "v_estimates", { order: [["created_at", false]], limit: 2000 }),
    rows<PurchaseOrder>(supabase, "v_purchase_orders", { order: [["created_at", false]], limit: 2000 }),
    rows<{ id: string; status: string }>(supabase, "integration_outbox", { eq: { event: "estimate.approved" }, limit: 2000 }),
    rows<{ id: string; stage: string }>(supabase, "psa_exceptions", { limit: 2000 }),
    rows<HandoffRow>(supabase, "v_sourcing_handoff", { order: [["approved_at", false]], limit: 2000 }),
  ]);
  const hc = handoffStats(handoffRows);
  const flagCount = (f: OrderFlag) => ests.filter((e) => e.order_flag === f).length;
  const drafts = ests.filter((e) => e.status === "draft");
  const withClient = ests.filter((e) => e.status === "sent");
  const awaitingPo = ests.filter((e) => e.status === "approved" && !pos.some((p) => p.estimate_id === e.id && !["rejected", "cancelled", "declined"].includes(p.status)));
  const doa = pos.filter((p) => p.status === "pending_approval");
  const issued = pos.filter((p) => p.status === "issued");
  const psaOpen = psa.filter((x) => !["applied", "resolved", "rejected"].includes(x.stage));

  return (
    <>
      <PageHead title="Order Management+" sub="Estimates to the client, supplier purchase orders with delegation-of-authority approval, vendor acceptance and the hand-off to Stocktool.">
        <ButtonLink href="/orders/estimates">Estimates</ButtonLink>
        <ButtonLink href="/orders/purchase-orders" variant="primary">Purchase orders</ButtonLink>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Draft estimates" value={drafts.length} hint="Set markup or margin and send" icon={<MSymbol name="edit_note" />} />
        <Stat label="With clients" value={withClient.length} hint="Waiting for client approval" icon={<MSymbol name="hourglass_top" />} />
        <Stat label="Approved, no PO yet" value={awaitingPo.length} tone={awaitingPo.length ? "warn" : undefined} hint="Raise the supplier PO" icon={<MSymbol name="playlist_add" />} />
        <Stat label="POs awaiting DOA" value={doa.length} tone={doa.length ? "warn" : "ok"} hint="Need enough delegated authority" icon={<MSymbol name="verified_user" />} />
        <Stat label="Waiting for the vendor" value={issued.length} hint="Issued, not yet accepted" icon={<MSymbol name="local_shipping" />} />
        <Stat label="Stocktool hand-offs queued" value={outbox.filter((o) => o.status === "queued").length} hint={<Link className="underline" href="/orders/outbox">See the outbox</Link>} icon={<MSymbol name="outbox" />} />
      </div>

      <Panel title="Hand-off to Stocktool (hypercare)" sub="Approved estimates and where their Stocktool hand-off stands. Orders on hold are waiting for data Stocktool needs." actions={<ButtonLink href="/orders/outbox">Outbox</ButtonLink>}>
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Handed to Stocktool" value={hc.handedOffPercent != null ? `${hc.handedOffPercent}%` : "—"} hint={`${hc.handedOff} of ${hc.approved} approved estimates`} tone={hc.handedOffPercent == null ? undefined : hc.handedOffPercent >= 90 ? "ok" : "warn"} icon={<MSymbol name="sync_alt" />} />
          <Stat label="Awaiting action" value={hc.awaitingPercent != null ? `${hc.awaitingPercent}%` : "—"} hint={`${hc.awaiting} approved, not yet handed off`} tone={hc.awaiting ? "warn" : "ok"} icon={<MSymbol name="pending_actions" />} />
          <Stat label="Approval to hand-off" value={hc.avgDaysToHandoff != null ? `${hc.avgDaysToHandoff} days` : "—"} hint="Average, estimate approved to sent to Stocktool" icon={<MSymbol name="timer" />} />
          <Stat label="On hold for missing data" value={hc.onHold.length} tone={hc.onHold.length ? "bad" : "ok"} hint={hc.missingCounts.length ? hc.missingCounts.map((m) => `${m.field} ${m.count}`).join(" · ") : "Nothing missing"} icon={<MSymbol name="report" />} />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3 text-sm">
          <span className="text-muted">Order flags:</span>
          {(Object.keys(ORDER_FLAG) as OrderFlag[]).map((f) => (
            <Link key={f} href={`/orders/estimates?flag=${f}`}><Pill tone={ORDER_FLAG[f].tone}>{ORDER_FLAG[f].label}: {flagCount(f)}</Pill></Link>
          ))}
        </div>
        {hc.onHold.length > 0 && (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead><tr><Th>Estimate</Th><Th>Job</Th><Th>Approved</Th><Th>Waiting</Th><Th>Missing</Th><Th>Hand-off</Th></tr></thead>
              <tbody>{hc.onHold.map((r) => (
                <tr key={r.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${r.id}`}>{r.estimate_number}</Link><div className="text-xs text-muted">{money(r.sell_price, r.currency)}</div></Td>
                  <Td><Link className="hover:underline" href={`/sourcing/jobs/${r.job_id}`}>{r.job_number}</Link><div className="text-xs text-muted">{r.client_name}</div></Td>
                  <Td>{fmtDate(r.approved_at)}</Td>
                  <Td className="tabular-nums">{r.days_since_approval != null ? `${r.days_since_approval} days` : "—"}</Td>
                  <Td><div className="flex flex-wrap gap-1">{(r.missing_fields ?? []).map((f) => <Pill key={f} tone="bad">{f}</Pill>)}</div></Td>
                  <Td>{r.outbox_status ? <Pill tone={r.outbox_status === "failed" ? "bad" : "info"}>{r.outbox_status}</Pill> : <Pill>Not queued</Pill>}</Td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="POs awaiting DOA approval" actions={<ButtonLink href="/orders/purchase-orders?status=pending_approval">All</ButtonLink>}>
          {doa.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <table className="w-full text-sm"><thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Value</Th><Th>Level needed</Th></tr></thead>
              <tbody>{doa.map((p) => <tr key={p.id}><Td><Link className="font-semibold hover:underline" href={`/orders/purchase-orders/${p.id}`}>{p.po_number}</Link><div className="text-xs text-muted">{p.job_number}</div></Td><Td>{p.supplier_name}</Td><Td>{money(p.total_value, p.currency)}</Td><Td>Level {p.required_doa_level}</Td></tr>)}</tbody></table>
          )}
        </Panel>
        <Panel title="Estimates needing action" actions={<ButtonLink href="/orders/estimates">All</ButtonLink>}>
          {[...drafts, ...awaitingPo].length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <table className="w-full text-sm"><thead><tr><Th>Estimate</Th><Th>Job</Th><Th>Sell</Th><Th>Status</Th></tr></thead>
              <tbody>{[...drafts, ...awaitingPo].map((e) => <tr key={e.id}><Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link></Td><Td>{e.job_number}<div className="text-xs text-muted">{e.client_name}</div></Td><Td>{money(e.sell_price, e.currency)}</Td><Td><StatusPill meta={ESTIMATE_STATUS} value={e.status} /></Td></tr>)}</tbody></table>
          )}
        </Panel>
      </div>

      <Panel title="Order tracking" sub="Every supplier PO and where it stands">
        {pos.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No purchase orders yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr><Th>PO</Th><Th>Job</Th><Th>Supplier</Th><Th>Value</Th><Th>PO date</Th><Th>Delivery</Th><Th>Status</Th></tr></thead>
              <tbody>{pos.map((p) => <tr key={p.id}><Td><Link className="font-semibold hover:underline" href={`/orders/purchase-orders/${p.id}`}>{p.po_number}</Link></Td><Td><Link className="hover:underline" href={`/sourcing/jobs/${p.job_id}`}>{p.job_number}</Link></Td><Td>{p.supplier_name}</Td><Td>{money(p.total_value, p.currency)}</Td><Td>{fmtDate(p.po_date)}</Td><Td>{fmtDate(p.delivery_date)}</Td><Td><StatusPill meta={PO_STATUS} value={p.status} /></Td></tr>)}</tbody></table>
          </div>
        )}
      </Panel>

      <Panel title="PSA exceptions" actions={<ButtonLink href="/orders/psa">Open PSA exceptions</ButtonLink>}>
        <p className="px-5 py-4 text-sm">{psaOpen.length} open request(s) going through line manager, procurement and delegated approval.</p>
      </Panel>
    </>
  );
}
