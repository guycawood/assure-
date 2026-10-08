import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOtif, getSnapshots, latestByDelivery } from "@/lib/logistics-data";
import { cap, kg, pct } from "@/lib/logistics";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "OTIF and transport CO2e" };

export default async function PerformancePage() {
  await requireInternal();
  const supabase = await createClient();
  const [otif, snaps] = await Promise.all([getOtif(supabase), getSnapshots(supabase)]);
  const latest = [...latestByDelivery(snaps).values()];
  const group = (key: (x: (typeof latest)[number]) => string) => {
    const m = new Map<string, { kg: number; n: number; incomplete: number }>();
    for (const x of latest) {
      const k = key(x);
      const g = m.get(k) ?? { kg: 0, n: 0, incomplete: 0 };
      g.kg += Number(x.kgco2e ?? 0); g.n += 1; if (!x.complete) g.incomplete += 1;
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].kg - a[1].kg);
  };
  const tone = (v: number | null) => (v == null ? "neutral" : v >= 95 ? "ok" : v >= 80 ? "warn" : "bad");
  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "OTIF and CO2e" }]} title="OTIF and transport CO2e"
        sub="On time = delivered on or before the planned date. In full = everything planned was shipped. Failed deliveries count against both. The Assure+ scorecard reads the same figures." />
      <Card className="min-w-0 overflow-x-auto">
        {otif.length === 0 ? <Empty title="No completed deliveries yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Supplier</Th><Th>Deliveries</Th><Th>On time</Th><Th>In full</Th><Th>OTIF</Th></tr></thead>
            <tbody>{otif.map((o) => (
              <tr key={o.supplier_id}>
                <Td><Link className="font-semibold hover:underline" href={`/logistics/deliveries?supplier=${o.supplier_id}`}>{o.supplier_name}</Link><div className="text-xs text-muted">{o.supplier_code}</div></Td>
                <Td className="tabular-nums">{o.deliveries}</Td>
                <Td>{o.on_time} · {pct(o.on_time_percent)}</Td><Td>{o.in_full} · {pct(o.in_full_percent)}</Td>
                <Td><Pill tone={tone(o.otif_percent == null ? null : Number(o.otif_percent))}>{pct(o.otif_percent)}</Pill></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        {([["By supplier", (x) => x.supplier_name ?? "—"], ["By market", (x) => `${x.market} (${x.region})`], ["By mode", (x) => cap(x.mode)]] as [string, (x: (typeof latest)[number]) => string][]).map(([title, fn]) => (
          <Panel key={title} title={`Transport CO2e ${title.toLowerCase()}`}>
            {latest.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing delivered yet.</p> : (
              <table className="w-full text-sm"><tbody>{group(fn).map(([k, g]) => (
                <tr key={k}><Td>{k}</Td><Td className="text-right tabular-nums">{kg(g.kg, 2)}</Td><Td className="text-right text-xs text-muted">{g.n} deliver{g.n === 1 ? "y" : "ies"}{g.incomplete ? ` · ${g.incomplete} incomplete` : ""}</Td></tr>
              ))}</tbody></table>
            )}
          </Panel>
        ))}
      </div>
      <Panel title="Snapshots" sub="Immutable; factor code and version are the ones in force on the delivery date.">
        {snaps.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Delivery</Th><Th>Delivered</Th><Th>Mode</Th><Th>Weight</Th><Th>Distance</Th><Th>Factor</Th><Th>Planned</Th><Th>Actual</Th></tr></thead>
            <tbody>{snaps.map((x) => (
              <tr key={x.id}><Td><Link className="hover:underline" href={`/logistics/deliveries/${x.delivery_id}`}>{x.delivery_number}</Link><div className="text-xs text-muted">{x.job_number}</div></Td>
                <Td>{fmtDate(x.delivery_date)}</Td><Td>{cap(x.mode)}</Td><Td>{kg(x.actual_weight_kg ?? x.planned_weight_kg)}</Td><Td>{x.distance_km ?? "—"} km</Td>
                <Td>{x.factor_code ? `${x.factor_code} v${x.factor_version}` : "—"}</Td><Td>{kg(x.planned_kgco2e, 3)}</Td>
                <Td>{kg(x.kgco2e, 3)}{!x.complete && <div className="text-xs text-warn">Missing {x.missing.join(", ")}</div>}</Td></tr>))}</tbody>
          </table></div>
        )}
        <p className="border-t border-line px-5 py-2 text-[0.7rem] text-muted">Transport emissions only (GHG Protocol Scope 3 Cat. 4); not a product carbon footprint.</p>
      </Panel>
    </>
  );
}
