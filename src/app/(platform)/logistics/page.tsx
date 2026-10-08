import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDeliveries, getPlannablePos, getShipments } from "@/lib/logistics-data";
import { DELIVERY_STATUS, kg, onTimePercent, pct, thisWeek } from "@/lib/logistics";
import { ButtonLink, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Logistics+" };

export default async function LogisticsDashboard() {
  await requireInternal();
  const supabase = await createClient();
  const [dels, ships, pos] = await Promise.all([getDeliveries(supabase), getShipments(supabase), getPlannablePos(supabase)]);
  const [wkStart, wkEnd] = thisWeek();
  const today = new Date().toISOString().slice(0, 10);
  const live = dels.filter((d) => !["delivered", "cancelled"].includes(d.status));
  const dueThisWeek = live.filter((d) => d.planned_delivery_date && d.planned_delivery_date >= wkStart && d.planned_delivery_date <= wkEnd);
  const overdue = live.filter((d) => d.planned_delivery_date && d.planned_delivery_date < today);
  const pods = ships.filter((s) => s.pod_status === "received");
  const onTime = onTimePercent(dels);
  const co2e = dels.reduce((s, d) => s + (d.kgco2e != null ? Number(d.kgco2e) : 0), 0);
  const toPlan = pos.filter((p) => p.deliveries === 0);

  return (
    <>
      <PageHead title="Logistics+" sub="Deliveries per destination for every supplier PO, shipments and proof of delivery checked against the 8-point list, and the transport CO2e of each delivery.">
        <ButtonLink href="/logistics/plan">Plan from a PO</ButtonLink>
        <ButtonLink href="/logistics/deliveries" variant="primary">Deliveries</ButtonLink>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Due this week" value={dueThisWeek.length} hint={overdue.length ? `${overdue.length} past their planned date` : "Nothing overdue"} tone={overdue.length ? "warn" : undefined} icon={<MSymbol name="event_upcoming" />} />
        <Stat label="PODs to verify" value={pods.length} tone={pods.length ? "warn" : "ok"} hint={<Link className="underline" href="/logistics/pods">Open the queue</Link>} icon={<MSymbol name="fact_check" />} />
        <Stat label="Delivered on time" value={pct(onTime)} tone={onTime == null ? undefined : onTime >= 95 ? "ok" : onTime >= 80 ? "warn" : "bad"} hint="On or before the planned date" icon={<MSymbol name="schedule" />} />
        <Stat label="Transport CO2e" value={kg(co2e)} hint="Delivered so far (Scope 3 Cat. 4)" icon={<MSymbol name="eco" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="PODs waiting for verification" sub="Someone other than the uploader checks all eight points" actions={<ButtonLink href="/logistics/pods">All</ButtonLink>}>
          {pods.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <table className="w-full text-sm"><thead><tr><Th>Shipment</Th><Th>Delivery</Th><Th>Supplier</Th><Th>Received</Th></tr></thead>
              <tbody>{pods.slice(0, 8).map((s) => (
                <tr key={s.id}><Td className="font-semibold">{s.shipment_number}</Td>
                  <Td><Link className="hover:underline" href={`/logistics/deliveries/${s.delivery_id}`}>{s.delivery_number}</Link><div className="text-xs text-muted">{s.po_number}</div></Td>
                  <Td>{s.supplier_name}</Td><Td>{fmtDate(s.pod_received_at)}</Td></tr>))}</tbody></table>
          )}
        </Panel>
        <Panel title="Approved POs with no deliveries planned" actions={<ButtonLink href="/logistics/plan">Plan</ButtonLink>}>
          {toPlan.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Every approved PO has a delivery plan.</p> : (
            <table className="w-full text-sm"><thead><tr><Th>PO</Th><Th>Job</Th><Th>Supplier</Th><Th>Due</Th></tr></thead>
              <tbody>{toPlan.slice(0, 8).map((p) => (
                <tr key={p.id}><Td className="font-semibold">{p.po_number}</Td><Td>{p.job_number}<div className="text-xs text-muted">{p.client_name}</div></Td><Td>{p.supplier_name}</Td><Td>{fmtDate(p.delivery_date)}</Td></tr>))}</tbody></table>
          )}
        </Panel>
      </div>

      <Panel title="Due this week and overdue" actions={<ButtonLink href="/logistics/deliveries">All deliveries</ButtonLink>}>
        {[...overdue, ...dueThisWeek.filter((d) => !overdue.includes(d))].length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing due.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr><Th>Delivery</Th><Th>Destination</Th><Th>Supplier</Th><Th>Spec</Th><Th>Planned</Th><Th>Shipped</Th><Th>Status</Th></tr></thead>
              <tbody>{[...overdue, ...dueThisWeek.filter((d) => !overdue.includes(d))].map((d) => (
                <tr key={d.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/logistics/deliveries/${d.id}`}>{d.delivery_number}</Link><div className="text-xs text-muted">{d.po_number}</div></Td>
                  <Td>{d.outlet_name ?? d.recipient_name ?? "—"}<div className="text-xs text-muted">{d.city ?? ""} {d.market} · {d.region}</div></Td>
                  <Td>{d.supplier_name}</Td><Td>{d.spec_title}{d.spec_version_name ? <div className="text-xs text-muted">{d.spec_version_name}</div> : null}</Td>
                  <Td className={d.planned_delivery_date && d.planned_delivery_date < today ? "text-bad" : ""}>{fmtDate(d.planned_delivery_date)}</Td>
                  <Td className="tabular-nums">{d.quantity_shipped} / {d.quantity}</Td><Td><StatusPill meta={DELIVERY_STATUS} value={d.status} /></Td>
                </tr>))}</tbody></table>
          </div>
        )}
      </Panel>
    </>
  );
}
