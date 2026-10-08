import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveLibrary, getDeliveries, getShipments } from "@/lib/logistics-data";
import { pct } from "@/lib/logistics";
import { ButtonLink, Card, Empty, PageHead } from "@/components/ui";
import { Td, Th } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Carriers" };

export default async function CarriersPage() {
  await requireInternal();
  const supabase = await createClient();
  const [carriers, ships, dels] = await Promise.all([getActiveLibrary(supabase, "carriers"), getShipments(supabase), getDeliveries(supabase)]);
  const delById = new Map(dels.map((d) => [d.id, d]));
  const stats = carriers.map((c) => {
    const mine = ships.filter((s) => s.carrier_code === c.code);
    const arrived = mine.filter((s) => s.actual_delivery_date);
    const onTime = arrived.filter((s) => { const p = delById.get(s.delivery_id)?.planned_delivery_date; return p && s.actual_delivery_date! <= p; });
    const transitDays = arrived.map((s) => (new Date(s.actual_delivery_date!).getTime() - new Date(s.dispatch_date).getTime()) / 864e5);
    return {
      c, shipments: mine.length, inTransit: mine.filter((s) => !s.actual_delivery_date).length,
      onTime: arrived.length ? Math.round((1000 * onTime.length) / arrived.length) / 10 : null,
      avgDays: transitDays.length ? Math.round((10 * transitDays.reduce((a, b) => a + b, 0)) / transitDays.length) / 10 : null,
      rejected: mine.filter((s) => s.pod_status === "rejected").length,
    };
  });
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "—");
  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Carriers" }]} title="Carriers"
        sub="The approved carrier list lives in the Logistics+ Watchtower library; performance comes from the shipments booked with each one.">
        <ButtonLink href="/logistics/watchtower/libraries/carriers">Manage the library</ButtonLink>
      </PageHead>
      <Card className="min-w-0 overflow-x-auto">
        {carriers.length === 0 ? <Empty title="No carriers set up"><p>Add them in the Watchtower library.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Carrier</Th><Th>Modes</Th><Th>Regions</Th><Th>Shipments</Th><Th>In transit</Th><Th>On time</Th><Th>Avg days in transit</Th><Th>PODs rejected</Th></tr></thead>
            <tbody>{stats.map(({ c, ...s }) => (
              <tr key={c.id}>
                <Td><span className="font-semibold">{c.name}</span><div className="text-xs text-muted">{c.code} · v{c.version}{typeof c.data.tracking_url === "string" ? <> · <a className="underline" href={c.data.tracking_url} target="_blank" rel="noreferrer">tracking</a></> : null}</div></Td>
                <Td>{list(c.data.modes)}</Td><Td>{list(c.data.regions)}</Td>
                <Td className="tabular-nums">{s.shipments}</Td><Td className="tabular-nums">{s.inTransit}</Td><Td>{pct(s.onTime)}</Td>
                <Td className="tabular-nums">{s.avgDays ?? "—"}</Td><Td className="tabular-nums">{s.rejected}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
