import Link from "next/link";
import { requireVendorCompany, rpcList } from "@/lib/vendor-data";
import { formatDate } from "@/lib/srt";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { pctTone, sheetStatus, type Completeness } from "@/lib/tech-sheet";

export const metadata = { title: "Technical & packaging data" };

type Row = {
  sheet_id: string | null; sheet_ref: string | null; status: string; source: string | null; spec_title: string; version_name: string | null;
  po_id: string | null; po_number: string | null; po_status: string | null; stage: string; completeness: Completeness | null; required_count: number;
  tbc_by: string | null; due: string | null; blocking: boolean;
};
const STAGE: Record<string, string> = { quote: "Quote (proposal)", po_acceptance: "To declare", pre_shipment: "Ready for pre-shipment" };

export default async function TechSheetsPage() {
  await requireVendorCompany();
  const rows = await rpcList<Row>("tech_sheet_vendor_list");
  const blocking = rows.filter((r) => r.blocking).length;
  return (
    <>
      <PageHead title="Technical & packaging data" sub={`One data sheet per item you quote or make for adm Indicia: the product as built and how it is packed. ${blocking ? `${blocking} order line(s) can't go to the pre-shipment check until the sheet is complete.` : "Nothing is holding up a pre-shipment check."}`} />
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No data sheets due">When you quote with packaging or accept a purchase order, the item appears here.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Item</th><th className="th">Order</th><th className="th">Stage</th><th className="th">Complete</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const st = sheetStatus(r.status);
                const href = r.po_id ? `/vendor/orders/${r.po_id}#tech-sheet` : null;
                return (
                  <tr key={r.sheet_id ?? `${r.po_id}-${i}`} className="hover:bg-surface-2">
                    <td className="td font-semibold">{href ? <Link href={href} className="hover:underline">{r.spec_title}</Link> : r.spec_title}{r.version_name ? ` (${r.version_name})` : ""}
                      <span className="block text-xs font-normal text-muted">{r.sheet_ref ?? "Not started"}</span></td>
                    <td className="td">{r.po_number ?? "Quote"}</td>
                    <td className="td">{STAGE[r.stage] ?? r.stage}</td>
                    <td className="td">{r.completeness ? <Pill tone={r.required_count === 0 ? "neutral" : pctTone(r.completeness.percent)}>{r.required_count === 0 ? "Nothing required" : `${r.completeness.percent}%`}</Pill> : r.required_count > 0 ? <Pill tone="bad">0%</Pill> : "–"}
                      {r.completeness && r.completeness.missing.length > 0 && <span className="block max-w-[360px] text-xs text-muted">Missing: {r.completeness.missing.slice(0, 3).join("; ")}{r.completeness.missing.length > 3 ? "…" : ""}</span>}</td>
                    <td className="td">{r.due ? formatDate(r.due) : r.tbc_by ? `Confirm by ${formatDate(r.tbc_by)}` : "–"}</td>
                    <td className="td"><Pill tone={r.blocking ? "bad" : st.tone}>{r.blocking ? "Holding up pre-shipment" : st.label}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
