import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMarkets } from "@/lib/logistics-data";
import { Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { planFromPo } from "@/app/(platform)/logistics/actions";
import { JobDeliveryForm, type PoOption } from "@/components/logistics/job-delivery-form";

type Po = { id: string; po_number: string; supplier_name: string; status: string; estimate_id: string; delivery_date: string | null };
type Spec = { id: string; spec_no: number; title: string };
type Delivery = { id: string; delivery_number: string; po_id: string; spec_id: string; quantity: number; recipient_name: string | null; city: string | null; market: string;
  planned_delivery_date: string | null; status: string };

const TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = { planned: "neutral", booked: "info", dispatched: "info", in_transit: "info", delivered: "ok", failed: "bad", cancelled: "neutral" };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * Every delivery on a job, and the way to add more than one: a PO can go to many destinations, each its own delivery
 * (one destination for one spec). Shows how much of each spec on the PO is planned, and adds several destinations in one go.
 */
export async function JobDeliveries({ jobId, jobMarket, pos, specs }: { jobId: string; jobMarket: string; pos: Po[]; specs: Spec[] }) {
  const supabase = await createClient();
  const live = pos.filter((p) => ["issued", "accepted"].includes(p.status));
  const [{ data: dRows }, { data: lRows }, markets] = await Promise.all([
    supabase.from("deliveries").select("id, delivery_number, po_id, spec_id, quantity, recipient_name, city, market, planned_delivery_date, status").eq("job_id", jobId).order("delivery_number"),
    live.length ? supabase.from("estimate_lines").select("estimate_id, spec_id, quantity").in("estimate_id", live.map((p) => p.estimate_id)) : Promise.resolve({ data: [] }),
    getMarkets(supabase),
  ]);
  const deliveries = (dRows ?? []) as Delivery[];
  const lines = (lRows ?? []) as { estimate_id: string; spec_id: string; quantity: number }[];
  const specById = new Map(specs.map((s) => [s.id, s]));
  const poById = new Map(pos.map((p) => [p.id, p]));
  const active = deliveries.filter((d) => d.status !== "cancelled");
  const label = (id: string) => { const s = specById.get(id); return s ? `#${s.spec_no} ${s.title}` : "Spec"; };
  const defaultMarket = markets.find((m) => m.code === jobMarket || m.name.toLowerCase() === jobMarket.toLowerCase())?.code ?? markets[0]?.code ?? "";

  const options: PoOption[] = live.map((p) => ({
    id: p.id, po_number: p.po_number, supplier_name: p.supplier_name, delivery_date: p.delivery_date,
    lines: lines.filter((l) => l.estimate_id === p.estimate_id).map((l) => ({
      spec_id: l.spec_id, label: label(l.spec_id), on_po: l.quantity, planned: active.filter((d) => d.po_id === p.id && d.spec_id === l.spec_id).reduce((a, d) => a + d.quantity, 0),
    })),
  }));
  const unplanned = live.filter((p) => !active.some((d) => d.po_id === p.id));

  return (
    <div className="space-y-4">
      <Panel title={`Deliveries (${active.length})`} sub="A job can go to many destinations. Each delivery is one destination for one spec on a supplier PO; open one to book, track and confirm it.">
        {deliveries.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No deliveries planned yet.{live.length === 0 ? " They can be added once a supplier PO is issued." : ""}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Delivery", "PO", "Spec", "Quantity", "Destination", "Deliver by", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="td"><Link href={`/logistics/deliveries/${d.id}`} className="font-semibold hover:underline">{d.delivery_number}</Link></td>
                    <td className="td">{poById.get(d.po_id)?.po_number ?? "—"}</td>
                    <td className="td">{label(d.spec_id)}</td>
                    <td className="td tabular-nums">{d.quantity.toLocaleString("en-GB")}</td>
                    <td className="td">{[d.recipient_name, d.city, d.market].filter(Boolean).join(", ")}</td>
                    <td className="td">{day(d.planned_delivery_date)}</td>
                    <td className="td"><Pill tone={TONE[d.status] ?? "neutral"}>{d.status.replace(/_/g, " ")}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unplanned.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 text-sm">
            <span className="text-muted">Not planned yet: {unplanned.map((p) => p.po_number).join(", ")}.</span>
            {unplanned.map((p) => <ActionForm key={p.id} action={planFromPo} hidden={{ id: p.id }} submit={`Plan ${p.po_number} as one delivery per spec`} variant="secondary" inline />)}
          </div>
        )}
      </Panel>

      <Panel title="Add deliveries" sub="Add one or several destinations in one go. Quantities for a spec can be split across destinations; the totals above show how much of each spec on the PO is planned.">
        <div className="p-5"><JobDeliveryForm jobId={jobId} pos={options} markets={markets} defaultMarket={defaultMarket} /></div>
      </Panel>
    </div>
  );
}
