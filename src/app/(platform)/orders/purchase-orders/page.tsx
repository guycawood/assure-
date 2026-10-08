import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { money } from "@/lib/sourcing";
import { PO_STATUS, type PurchaseOrder } from "@/lib/orders";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Purchase orders" };

export default async function PosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  let list = await rows<PurchaseOrder>(supabase, "v_purchase_orders", { order: [["created_at", false]], limit: 2000 });
  const total = list.length;
  if (sp.status) list = list.filter((p) => p.status === sp.status);
  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "Purchase orders" }]} title="Supplier purchase orders"
        sub="Raised only from a client-approved estimate. Approval needs someone other than the buyer with enough delegated authority for the value." />
      <form method="get" className="flex gap-2">
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">All statuses</option>{Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {total === 0 ? <Empty title="No purchase orders yet"><p>Raise one from an approved estimate.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>PO</Th><Th>Job</Th><Th>Supplier</Th><Th>Value</Th><Th>DOA level</Th><Th>Approved by</Th><Th>PO date</Th><Th>Delivery</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <Td><Link className="font-semibold hover:underline" href={`/orders/purchase-orders/${p.id}`}>{p.po_number}</Link><div className="text-xs text-muted">{p.estimate_number}</div></Td>
                <Td><Link className="hover:underline" href={`/sourcing/jobs/${p.job_id}`}>{p.job_number}</Link><div className="text-xs text-muted">{p.client_name} · {p.market}</div></Td>
                <Td>{p.supplier_name}</Td><Td className="tabular-nums">{money(p.total_value, p.currency)}{p.exceeds_e_tender && <div><Pill tone="warn">Over e-tender threshold</Pill></div>}</Td>
                <Td>Level {p.required_doa_level}</Td><Td>{p.approved_by_name ?? "—"}{p.approver_doa_level != null ? ` (L${p.approver_doa_level})` : ""}</Td>
                <Td>{fmtDate(p.po_date)}</Td><Td>{fmtDate(p.delivery_date)}</Td><Td><StatusPill meta={PO_STATUS} value={p.status} /></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
