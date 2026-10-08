import Link from "next/link";
import { requireVendorCompany, rpcList, type VendorPoRow } from "@/lib/vendor-data";
import { formatDate } from "@/lib/srt";
import { human, money, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  await requireVendorCompany();
  const rows = await rpcList<VendorPoRow>("po_vendor_list");
  const waiting = rows.filter((r) => r.status === "issued").length;
  return (
    <>
      <PageHead title="Orders" sub={`Purchase orders from adm Indicia. Accept each one to start production, then upload control documents and your invoice against it.${waiting ? ` ${waiting} waiting for you.` : ""}`} />
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No purchase orders yet">When adm Indicia issues you a purchase order, it appears here.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">PO</th><th className="th">Job</th><th className="th text-right">Value</th><th className="th">PO date</th><th className="th">Delivery</th><th className="th">Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className="td"><Link href={`/vendor/orders/${p.id}`} className="font-semibold hover:underline">{p.po_number}</Link></td>
                  <td className="td">{p.title}<span className="block text-xs text-muted">{p.job_number}</span></td>
                  <td className="td text-right tabular-nums">{money(p.total_value, p.currency)}</td>
                  <td className="td">{formatDate(p.po_date)}</td>
                  <td className="td">{formatDate(p.delivery_date)}</td>
                  <td className="td"><Pill tone={statusTone(p.status)}>{p.status === "issued" ? "Waiting for you" : human(p.status)}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
