import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShipments } from "@/lib/logistics-data";
import { POD_STATUS } from "@/lib/logistics";
import { Card, Empty, PageHead } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Proof of delivery" };

export default async function PodsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const status = sp.status ?? "received";
  const supabase = await createClient();
  const all = await getShipments(supabase);
  const list = status === "all" ? all : all.filter((s) => s.pod_status === status);
  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Proof of delivery" }]} title="Proof of delivery"
        sub="Every POD is checked against the 8-point list from the Logistics+ Watchtower. Whoever uploaded a POD can't verify it, and vendors never can." />
      <nav className="flex flex-wrap gap-2 text-sm">
        {[["received", "To verify"], ["rejected", "Rejected"], ["not_received", "Waiting for POD"], ["verified", "Verified"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/logistics/pods?status=${k}`} className={`rounded-full border px-3 py-1 font-semibold ${status === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
            {l} ({k === "all" ? all.length : all.filter((s) => s.pod_status === k).length})
          </Link>
        ))}
      </nav>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="Nothing here" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Shipment</Th><Th>Delivery</Th><Th>Supplier</Th><Th>Quantity</Th><Th>Dispatched</Th><Th>POD received</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id}>
                <Td className="font-semibold">{s.shipment_number}<div className="text-xs font-normal text-muted">{s.carrier_name ?? "—"} {s.tracking_reference ?? ""}</div></Td>
                <Td><Link className="hover:underline" href={`/logistics/deliveries/${s.delivery_id}`}>{s.delivery_number}</Link><div className="text-xs text-muted">{s.po_number} · {s.market} ({s.region})</div></Td>
                <Td>{s.supplier_name}</Td><Td className="tabular-nums">{s.quantity_shipped}</Td><Td>{fmtDate(s.dispatch_date)}</Td>
                <Td>{fmtDateTime(s.pod_received_at)}<div className="text-xs text-muted">{s.pod_uploaded_by === me.id ? "Uploaded by you" : s.pod_uploaded_by_name ? `by ${s.pod_uploaded_by_name}` : s.pod_received_at ? "by the vendor" : ""}</div></Td>
                <Td><StatusPill meta={POD_STATUS} value={s.pod_status} />{s.pod_rejection_reason && <div className="text-xs text-bad">{s.pod_rejection_reason}</div>}</Td>
                <Td><Link className="font-semibold text-accent hover:underline" href={`/logistics/deliveries/${s.delivery_id}`}>{s.pod_status === "received" && s.pod_uploaded_by !== me.id ? "Check" : "Open"}</Link></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
