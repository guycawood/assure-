import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines } from "@/lib/conscious-ordering-data";
import { eur, int, mass, specGroup, STATUS_META } from "@/lib/conscious-ordering";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { CO_BASE, ConsciousNav } from "../sub-nav";

export const metadata: Metadata = { title: "Conscious ordering order lines" };

const SHOWN = 100;

// Tracked order lines, biggest wasted spend first. Each opens its order's reconciliation, where stock counts are recorded.
export default async function ConsciousOrderingLines() {
  await requireInternal();
  const supabase = await createClient();
  const lines = await getOrderLines(supabase);
  const cost = (l: (typeof lines)[number]) => l.wasted * Number(l.unit_cost_eur ?? 0);
  const tracked = lines.filter((l) => l.status !== "untracked").sort((a, b) => cost(b) - cost(a) || b.ordered - a.ordered);
  const untracked = lines.length - tracked.length;

  return (
    <>
      <PageHead crumbs={[{ label: "Sustainability", href: "/sustainability" }, { label: "Conscious ordering", href: CO_BASE }, { label: "Order lines" }]}
        title="Order lines" sub="Order lines with install or stock evidence, biggest wasted spend first. Open one to see its counts or record a stock count." />
      <ConsciousNav current="orders" />
      {tracked.length === 0 ? <Card><Empty title="No order has install or stock evidence yet" /></Card> : (
        <Card className="min-w-0">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Order</Th><Th>Brand and market</Th><Th>Item</Th><Th>Status</Th><Th className="text-right">Ordered</Th><Th className="text-right">Delivered</Th>
              <Th className="text-right">Installed</Th><Th className="text-right">In stock</Th><Th className="text-right">Unaccounted</Th><Th className="text-right">Cost</Th><Th className="text-right">Material</Th></tr></thead>
            <tbody>{tracked.slice(0, SHOWN).map((l) => (
              <tr key={`${l.po_id}-${l.spec_id}`}>
                <Td><Link className="font-semibold hover:underline" href={`${CO_BASE}/${l.po_id}`}>{l.po_number}</Link><div className="text-xs text-muted">{fmtDate(l.po_date)}</div></Td>
                <Td>{l.brand}<div className="text-xs text-muted">{l.market}</div></Td>
                <Td>{l.spec_title}<div className="text-xs text-muted">{specGroup(l.spec_type)}</div></Td>
                <Td><Pill tone={STATUS_META[l.status].tone}>{STATUS_META[l.status].label}</Pill></Td>
                <Td className="text-right tabular-nums">{int(l.ordered)}</Td><Td className="text-right tabular-nums">{int(l.delivered)}</Td>
                <Td className="text-right tabular-nums">{int(l.installed)}</Td>
                <Td className="text-right tabular-nums">{int(l.in_stock)}{l.aged_stock > 0 && <div className="text-xs text-warn">{int(l.aged_stock)} past age limit</div>}</Td>
                <Td className="text-right tabular-nums">{int(l.unaccounted)}</Td>
                <Td className="text-right tabular-nums">{eur(cost(l))}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{l.unit_weight_g ? mass((l.wasted * Number(l.unit_weight_g)) / 1000) : "—"}</Td>
              </tr>))}</tbody>
          </table></div>
          <p className="border-t border-line px-5 py-2 text-[0.7rem] text-muted">
            Showing {Math.min(SHOWN, tracked.length)} of {tracked.length} tracked order lines. {untracked} more have no install or stock evidence and are covered by the spend-based estimate.
          </p>
        </Card>
      )}
    </>
  );
}
