import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines, getStockCounts } from "@/lib/conscious-ordering-data";
import { eur, int, pct, specGroup, STATUS_META } from "@/lib/conscious-ordering";
import { UUID } from "@/lib/sourcing-actions";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { PageHead, Panel, Pill } from "@/components/ui";
import { Facts, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { recordStockCount } from "../../actions";

export const metadata: Metadata = { title: "Order reconciliation" };

const BASE = "/watchtower/sustainability/conscious-ordering";
const SOURCES = [{ value: "warehouse", label: "Warehouse" }, { value: "vendor", label: "Vendor" }, { value: "market", label: "Market" }];

// One purchase order: each line's ordered / delivered / installed / in stock, its stock counts, and a form to add a count.
export default async function OrderReconciliation({ params }: { params: Promise<{ po: string }> }) {
  await requireInternal();
  const { po } = await params;
  if (!UUID.test(po)) notFound();
  const supabase = await createClient();
  const [all, counts] = await Promise.all([getOrderLines(supabase), getStockCounts(supabase, po)]);
  const lines = all.filter((l) => l.po_id === po);
  if (lines.length === 0) notFound();
  const head = lines[0];
  const title = new Map(lines.map((l) => [l.spec_id, l.spec_title]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Sustainability", href: "/watchtower/sustainability" }, { label: "Conscious ordering", href: BASE }, { label: head.po_number }]}
        title={`Order ${head.po_number}`} sub={`${head.brand} · ${head.market} (${head.region}) · ${head.client_name} · ${head.job_number}`} />

      <Panel title="Ordered against delivered, installed and in stock"
        actions={<Link href={`/orders/purchase-orders/${po}`} className="text-sm font-semibold text-accent hover:underline">Open the purchase order</Link>}>
        <Facts items={[["Order date", fmtDate(head.po_date)], ["Currency", head.currency], ["Lines", lines.length]]} />
        <div className="overflow-x-auto border-t border-line"><table className="w-full text-sm">
          <thead><tr><Th>Item</Th><Th>Status</Th><Th className="text-right">Ordered</Th><Th className="text-right">Delivered</Th><Th className="text-right">Installed</Th>
            <Th className="text-right">In stock</Th><Th className="text-right">Unaccounted</Th><Th className="text-right">Installed of ordered</Th><Th className="text-right">Wasted spend</Th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.spec_id}>
              <Td><span className="font-semibold">{l.spec_title}</span><div className="text-xs text-muted">{specGroup(l.spec_type)}</div></Td>
              <Td><Pill tone={STATUS_META[l.status].tone}>{STATUS_META[l.status].label}</Pill>
                {l.open_installs > 0 && <div className="mt-0.5 text-xs text-muted">{l.open_installs} install{l.open_installs === 1 ? "" : "s"} still open</div>}</Td>
              <Td className="text-right tabular-nums">{int(l.ordered)}</Td><Td className="text-right tabular-nums">{int(l.delivered)}</Td>
              <Td className="text-right tabular-nums">{int(l.installed)}</Td>
              <Td className="text-right tabular-nums">{int(l.in_stock)}{l.aged_stock > 0 && <div className="text-xs text-warn">{int(l.aged_stock)} past age limit</div>}</Td>
              <Td className="text-right tabular-nums">{l.status === "reconciled" ? int(l.unaccounted) : "—"}</Td>
              <Td className="text-right tabular-nums">{l.status === "reconciled" ? pct(l.ordered ? (100 * l.installed) / l.ordered : null) : "—"}</Td>
              <Td className="text-right tabular-nums">{l.status === "reconciled" ? eur(l.wasted * Number(l.unit_cost_eur ?? 0)) : "—"}</Td>
            </tr>))}</tbody>
        </table></div>
        <p className="border-t border-line px-5 py-2 text-[0.7rem] text-muted">
          Delivered counts shipments with a verified proof of delivery. Installed comes from Execution. A line is reconciled once something has been delivered and no install is still open.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Stock counts" sub="Every count is kept. The latest count at each location is the stock on hand.">
          {counts.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No stock has been counted for this order.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr><Th>Counted</Th><Th>Item</Th><Th>Location</Th><Th>Held by</Th><Th className="text-right">Quantity</Th><Th>Notes</Th></tr></thead>
              <tbody>{counts.map((c) => (
                <tr key={c.id}><Td>{fmtDate(c.counted_on)}</Td><Td>{title.get(c.spec_id) ?? "—"}</Td><Td>{c.location}</Td>
                  <Td className="capitalize">{c.source}</Td><Td className="text-right tabular-nums">{int(c.quantity)}</Td><Td className="text-xs text-muted">{c.notes ?? "—"}</Td></tr>))}</tbody>
            </table></div>
          )}
        </Panel>
        <Panel className="xl:col-span-2" title="Record a stock count" sub="From a warehouse, the vendor or the market. Enter 0 when a location is empty.">
          <ActionForm action={recordStockCount} submit="Record count" hidden={{ po_id: po }} resetOnOk className="px-5 py-4">
            <Field label="Item"><Select name="spec_id" required options={lines.map((l) => ({ value: l.spec_id, label: `${l.spec_title} (${int(l.ordered)} ordered)` }))} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quantity counted"><input name="quantity" type="number" min={0} step={1} required className="input" /></Field>
              <Field label="Counted on"><input name="counted_on" type="date" defaultValue={today} max={today} required className="input" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Location" hint="For example: Central warehouse"><input name="location" required className="input" /></Field>
              <Field label="Held by"><Select name="source" options={SOURCES} defaultValue="warehouse" /></Field>
            </div>
            <Field label="Notes"><input name="notes" className="input" /></Field>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
