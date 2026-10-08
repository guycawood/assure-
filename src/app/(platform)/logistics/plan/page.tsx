import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPlannablePos } from "@/lib/logistics-data";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { planFromPo } from "../actions";

export const metadata: Metadata = { title: "Plan deliveries" };

export default async function PlanPage() {
  await requireInternal();
  const supabase = await createClient();
  const pos = await getPlannablePos(supabase);
  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Plan from a PO" }]} title="Plan deliveries from a purchase order"
        sub="Approved supplier POs from Order Management+. Planning creates one delivery per spec version, due on the PO delivery date and to the job's market; then add each destination's address, weight and distance." />
      <Card className="min-w-0 overflow-x-auto">
        {pos.length === 0 ? <Empty title="No approved purchase orders yet"><p>POs appear here once they are approved and issued to the vendor.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>PO</Th><Th>Job</Th><Th>Supplier</Th><Th>Market</Th><Th>Delivery date</Th><Th>Deliveries</Th><Th /></tr></thead>
            <tbody>{pos.map((p) => (
              <tr key={p.id}>
                <Td><Link className="font-semibold hover:underline" href={`/orders/purchase-orders/${p.id}`}>{p.po_number}</Link><div className="text-xs text-muted">{p.status}</div></Td>
                <Td>{p.job_number}<div className="text-xs text-muted">{p.client_name}</div></Td>
                <Td>{p.supplier_name}</Td><Td>{p.market} · {p.region}</Td><Td>{fmtDate(p.delivery_date)}</Td>
                <Td>{p.deliveries ? <Link className="hover:underline" href={`/logistics/deliveries?po=${p.id}`}>{p.deliveries} planned</Link> : <Pill tone="warn">Not planned</Pill>}</Td>
                <Td className="space-y-1.5">
                  {p.deliveries === 0 && <ActionForm action={planFromPo} hidden={{ id: p.id }} submit="Plan deliveries" inline />}
                  <Link className="block text-xs font-semibold text-accent hover:underline" href={`/logistics/deliveries/new?po=${p.id}`}>Add a destination</Link>
                </Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
