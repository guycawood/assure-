import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDeliveries } from "@/lib/logistics-data";
import { DELIVERY_STATUS, cap, kg } from "@/lib/logistics";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Deliveries" };

type Sp = { status?: string; market?: string; region?: string; supplier?: string; po?: string; q?: string };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const all = await getDeliveries(supabase);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)].filter(Boolean) as T[];
  const suppliers = uniq(all.map((d) => `${d.supplier_id}|${d.supplier_name}`)).sort((a, b) => a.split("|")[1].localeCompare(b.split("|")[1]));
  const pos = uniq(all.map((d) => `${d.po_id}|${d.po_number}`)).sort();
  const markets = uniq(all.map((d) => d.market)).sort();
  const regions = uniq(all.map((d) => d.region)).sort();
  const q = sp.q?.toLowerCase().trim();
  const list = all.filter((d) => (!sp.status || d.status === sp.status) && (!sp.market || d.market === sp.market) && (!sp.region || d.region === sp.region)
    && (!sp.supplier || d.supplier_id === sp.supplier) && (!sp.po || d.po_id === sp.po)
    && (!q || [d.delivery_number, d.po_number, d.job_number, d.recipient_name, d.city, d.outlet_name, d.spec_title].some((x) => x?.toLowerCase().includes(q))));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Deliveries" }]} title="Deliveries"
        sub="One row per destination per spec version on a supplier PO. Shipped quantity can never exceed what was planned." />
      <form method="get" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search number, job, destination…" className="input w-56" aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">All statuses</option>{Object.entries(DELIVERY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="region" defaultValue={sp.region ?? ""} className="input w-auto" aria-label="Region"><option value="">All regions</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>
        <select name="market" defaultValue={sp.market ?? ""} className="input w-auto" aria-label="Market"><option value="">All markets</option>{markets.map((m) => <option key={m}>{m}</option>)}</select>
        <select name="supplier" defaultValue={sp.supplier ?? ""} className="input w-auto" aria-label="Supplier"><option value="">All suppliers</option>{suppliers.map((s) => { const [v, l] = s.split("|"); return <option key={v} value={v}>{l}</option>; })}</select>
        <select name="po" defaultValue={sp.po ?? ""} className="input w-auto" aria-label="PO"><option value="">All POs</option>{pos.map((s) => { const [v, l] = s.split("|"); return <option key={v} value={v}>{l}</option>; })}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
        {Object.values(sp).some(Boolean) && <Link href="/logistics/deliveries" className="self-center text-sm text-muted hover:text-fg">Clear</Link>}
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {all.length === 0 ? <Empty title="No deliveries yet"><p>Plan them from an approved purchase order.</p></Empty> : list.length === 0 ? <Empty title="Nothing matches those filters" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Delivery</Th><Th>Destination</Th><Th>Supplier</Th><Th>Spec</Th><Th>Method</Th><Th>Planned</Th><Th>Shipped</Th><Th>POD</Th><Th>CO2e</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id}>
                <Td><Link className="font-semibold hover:underline" href={`/logistics/deliveries/${d.id}`}>{d.delivery_number}</Link><div className="text-xs text-muted">{d.po_number} · {d.job_number}</div></Td>
                <Td>{d.outlet_name ?? d.recipient_name ?? <span className="text-muted">Address to add</span>}<div className="text-xs text-muted">{d.city ? `${d.city}, ` : ""}{d.market} · {d.region}</div></Td>
                <Td>{d.supplier_name}</Td>
                <Td>{d.spec_title}{d.spec_version_name && <div className="text-xs text-muted">{d.spec_version_name}</div>}</Td>
                <Td>{cap(d.delivery_method)}</Td>
                <Td className={d.planned_delivery_date && d.planned_delivery_date < today && !["delivered", "cancelled"].includes(d.status) ? "text-bad" : ""}>{fmtDate(d.planned_delivery_date)}{d.actual_delivery_date && <div className="text-xs text-muted">Delivered {fmtDate(d.actual_delivery_date)}</div>}</Td>
                <Td className="tabular-nums">{d.quantity_shipped} / {d.quantity}<div className="text-xs text-muted">{d.quantity_remaining} left</div></Td>
                <Td>{d.pods_to_verify ? <Pill tone="info">{d.pods_to_verify} to verify</Pill> : d.shipment_count ? <span className="text-xs text-muted">{d.pods_verified}/{d.shipment_count} verified</span> : "—"}</Td>
                <Td className="tabular-nums">{kg(d.kgco2e, 2)}</Td>
                <Td><StatusPill meta={DELIVERY_STATUS} value={d.status} /></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
