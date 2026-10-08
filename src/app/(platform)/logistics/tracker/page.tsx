import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLegs, getShipments } from "@/lib/logistics-data";
import { STAGE_KEYS, STAGE_LABELS, currentLocation, currentMilestone, shipmentMilestones } from "@/lib/logistics";
import { Card, Empty, PageHead, Stat } from "@/components/ui";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Milestones } from "@/components/logistics/milestones";

export const metadata: Metadata = { title: "Tracker" };

export default async function TrackerPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [ships, legs] = await Promise.all([getShipments(supabase), getLegs(supabase)]);
  const withStage = ships.map((s) => {
    const state = shipmentMilestones(s, s.delivery_status);
    return { s, stage: currentMilestone(state), done: state.pod_verified, legs: legs.filter((l) => l.shipment_id === s.id) };
  });
  const active = withStage.filter((x) => !x.done);
  const list = sp.stage ? withStage.filter((x) => x.stage === sp.stage && !x.done) : active;
  const count = (k: string) => active.filter((x) => x.stage === k).length;
  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Tracker" }]} title="Shipment tracker"
        sub="Where every open shipment sits on the journey from planned to POD verified, and where the goods are from the recorded legs." />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STAGE_KEYS.slice(1).map((k) => (
          <Link key={k} href={`/logistics/tracker?stage=${k}`}><Stat label={`Next: ${STAGE_LABELS[k]}`} value={count(k)} /></Link>
        ))}
      </div>
      {sp.stage && <p className="text-sm">Showing shipments waiting for <b>{STAGE_LABELS[sp.stage as keyof typeof STAGE_LABELS] ?? sp.stage}</b>. <Link className="underline" href="/logistics/tracker">Show all</Link></p>}
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No open shipments" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Shipment</Th><Th>Supplier</Th><Th>Journey</Th><Th>Where now</Th><Th>Due</Th></tr></thead>
            <tbody>{list.map(({ s, legs: ls }) => (
              <tr key={s.id}>
                <Td><Link className="font-semibold hover:underline" href={`/logistics/deliveries/${s.delivery_id}`}>{s.shipment_number}</Link><div className="text-xs text-muted">{s.delivery_number} · {s.market}</div></Td>
                <Td>{s.supplier_name}</Td>
                <Td><Milestones shipment={s} deliveryStatus={s.delivery_status} compact /></Td>
                <Td>{currentLocation(ls) ?? <span className="text-muted">No legs recorded</span>}</Td>
                <Td className={s.planned_delivery_date && s.planned_delivery_date < new Date().toISOString().slice(0, 10) && !s.actual_delivery_date ? "text-bad" : ""}>{fmtDate(s.planned_delivery_date)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
