import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSheetRows, type TechSheetRow } from "@/lib/tech-sheet-data";
import { pctTone, sheetStatus, SOURCE_LABEL } from "@/lib/tech-sheet";
import { Card, Empty, PageHead, Pill, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Technical & packaging data" };

const d = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

export default async function TechSheetsPage({ searchParams }: { searchParams: Promise<{ missing?: string; status?: string; supplier?: string; blocking?: string }> }) {
  await requireInternal();
  const f = await searchParams;
  const supabase = await createClient();
  const all = await getSheetRows(supabase);
  const missingAt = (r: TechSheetRow, st: string) =>
    st === "quote" ? r.quote_pct < 100 : st === "po_acceptance" ? r.po_pct < 100 : st === "pre_shipment" ? r.pre_shipment_pct < 100 : true;
  const rows = all.filter((r) => (!f.missing || missingAt(r, f.missing)) && (!f.status || r.status === f.status)
    && (!f.supplier || r.supplier_id === f.supplier) && (f.blocking !== "1" || r.blocking));
  const suppliers = [...new Map(all.map((r) => [r.supplier_id, r.supplier_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const measured = all.filter((r) => r.status === "verified" || r.status === "mismatch");
  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Technical & packaging data" }]} title="Technical & packaging data"
        sub="Vendor data sheets per spec and supplier: the product as built and its packaging (unit pack, carton, pallet), declared in stages and checked against a packed carton at pre-shipment." />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Data sheets" value={all.length} />
        <Stat label="Holding up a pre-shipment check" value={all.filter((r) => r.blocking).length} />
        <Stat label="Mismatch at pre-shipment" value={all.filter((r) => r.status === "mismatch").length} />
        <Stat label="Verified rate" value={measured.length ? `${Math.round((100 * measured.filter((r) => r.status === "verified").length) / measured.length)}%` : "–"} />
      </div>
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="label">Missing at stage</span>
            <select name="missing" defaultValue={f.missing ?? ""} className="input"><option value="">Any</option><option value="quote">Quote</option><option value="po_acceptance">PO acceptance</option><option value="pre_shipment">Pre-shipment</option></select></label>
          <label className="block"><span className="label">Status</span>
            <select name="status" defaultValue={f.status ?? ""} className="input"><option value="">Any</option><option value="draft">Draft</option><option value="declared">Declared</option><option value="verified">Verified</option><option value="mismatch">Mismatch</option></select></label>
          <label className="block"><span className="label">Supplier</span>
            <select name="supplier" defaultValue={f.supplier ?? ""} className="input"><option value="">All suppliers</option>{suppliers.map(([sid, n]) => <option key={sid} value={sid}>{n}</option>)}</select></label>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="blocking" value="1" defaultChecked={f.blocking === "1"} /> Holding up pre-shipment only</label>
          <button className="rounded-lg bg-accent px-3 py-2 font-semibold text-white">Filter</button>
          <Link href="/sourcing/tech-sheets" className="pb-2 text-xs text-muted hover:underline">Clear</Link>
        </form>
      </Card>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No data sheets match">Sheets open when a vendor quotes with packaging, when a PO is issued and a requirement rule applies, or from a spec page.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Sheet</th><th className="th">Spec</th><th className="th">Supplier</th><th className="th">PO</th><th className="th">Quote</th><th className="th">PO acceptance</th><th className="th">Pre-shipment</th><th className="th">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = sheetStatus(r.status);
                return (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <td className="td font-semibold"><Link href={`/sourcing/specs/${r.spec_id}?tab=tech`} className="hover:underline">{r.sheet_ref}</Link>
                      <span className="block text-xs font-normal text-muted">{SOURCE_LABEL[r.source] ?? r.source}</span></td>
                    <td className="td">{r.spec_title}{r.version_name ? ` (${r.version_name})` : ""}<span className="block text-xs text-muted">{r.job_number} · {r.client_name}</span></td>
                    <td className="td">{r.supplier_name}</td>
                    <td className="td">{r.po_id ? <Link href={`/orders/purchase-orders/${r.po_id}#tech-sheet`} className="hover:underline">{r.po_number}</Link> : "–"}</td>
                    {([[r.quote_pct, r.quote_required, r.missing_quote], [r.po_pct, r.po_required, r.missing_po], [r.pre_shipment_pct, r.pre_shipment_required, r.missing_pre_shipment]] as [number, number, string[]][]).map(([p, req, miss], i) => (
                      <td key={i} className="td"><Pill tone={req === 0 ? "neutral" : pctTone(p)}>{req === 0 ? "–" : `${p}%`}</Pill>
                        {miss?.length > 0 && <span className="block max-w-[220px] text-xs text-muted" title={miss.join("; ")}>{miss.slice(0, 2).join("; ")}{miss.length > 2 ? ` +${miss.length - 2}` : ""}</span>}</td>
                    ))}
                    <td className="td"><Pill tone={r.blocking ? "bad" : st.tone}>{r.blocking ? "Holding up pre-shipment" : st.label}</Pill>
                      {r.tbc_by && <span className="block text-xs text-warn">Confirm by {d(r.tbc_by)}</span>}
                      {r.pre_shipment_due && <span className="block text-xs text-muted">Pre-shipment due {d(r.pre_shipment_due)}</span>}</td>
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
