import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEvents, getPeople, getSpecs, one, rows } from "@/lib/sourcing-data";
import { money, pct, unitMoney } from "@/lib/sourcing";
import { ESTIMATE_STATUS, grossProfit, marginPercent, PO_STATUS, savingsPercent, sellPrice, type Estimate, type EstimateLine, type PurchaseOrder } from "@/lib/orders";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { approveEstimate, createPo, declineEstimate, sendEstimate, setPricing } from "../../actions";

export const metadata: Metadata = { title: "Estimate" };

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const e = await one<Estimate>(supabase, "v_estimates", id);
  if (!e) notFound();
  const [lines, specs, pos, events, people, outbox] = await Promise.all([
    rows<EstimateLine>(supabase, "estimate_lines", { eq: { estimate_id: id } }), getSpecs(supabase, e.job_id),
    rows<PurchaseOrder>(supabase, "v_purchase_orders", { eq: { estimate_id: id } }), getEvents(supabase, { entity_id: id }), getPeople(supabase),
    rows<{ id: string; status: string; created_at: string; payload: unknown }>(supabase, "integration_outbox", { eq: { aggregate_id: id } }),
  ]);
  const specById = new Map(specs.map((s) => [s.id, s]));
  const cost = Number(e.base_cost);
  const sell = Number(e.sell_price);
  const livePo = pos.find((p) => !["rejected", "cancelled", "declined"].includes(p.status));

  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "Estimates", href: "/orders/estimates" }, { label: e.estimate_number }]}
        title={`Estimate ${e.estimate_number}`} sub={`${e.job_number} · ${e.job_title} · ${e.client_name} · supplier ${e.supplier_name}`}>
        <StatusPill meta={ESTIMATE_STATUS} value={e.status} />
      </PageHead>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Commercials">
            <Facts items={[
              ["Supplier cost", money(cost, e.currency, 2)], ["Sell price to client", money(sell, e.currency, 2)],
              ["Pricing", `${e.pricing_mode === "margin" ? "Margin" : "Markup"} ${e.pricing_percent}%`],
              ["Gross profit", `${money(grossProfit(cost, sell), e.currency, 2)} (${pct(marginPercent(cost, sell))} of sell)`],
              ["Benchmark", `${money(e.benchmark_value, e.currency, 2)} (${e.benchmark_source ?? "—"})`],
              ["Saving vs benchmark", `${money(e.savings_vs_benchmark, e.currency, 2)} · ${pct(savingsPercent(e.savings_vs_benchmark, e.benchmark_value))}`],
              ["Saving vs target prices", e.target_value != null ? `${money(e.savings_vs_target, e.currency, 2)} · ${pct(savingsPercent(e.savings_vs_target, e.target_value))}` : "No targets set"],
              ["Client savings target", pct(e.savings_target_percent)], ["Source", `${e.source}${e.rfq_number ? ` (${e.rfq_number})` : ""}`],
              ["Why this supplier", e.selection_reason], ["Bypass reason", e.bypass_reason_code ?? "None"], ["Client order ref", e.client_order_ref],
            ]} />
          </Panel>
          <Panel title="Lines">
            <table className="w-full text-sm">
              <thead><tr><Th>Spec</Th><Th>Quantity</Th><Th>Unit cost</Th><Th>Benchmark</Th><Th>Target</Th><Th>Line cost</Th><Th>Unit sell</Th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/sourcing/specs/${l.spec_id}`}>{specById.get(l.spec_id)?.title ?? "Spec"}</Link></Td>
                  <Td className="tabular-nums">{Number(l.quantity).toLocaleString("en-GB")}</Td><Td className="tabular-nums">{unitMoney(Number(l.unit_cost), e.currency)}</Td>
                  <Td className="tabular-nums">{l.benchmark_unit != null ? unitMoney(Number(l.benchmark_unit), e.currency) : "—"}</Td>
                  <Td className="tabular-nums">{l.target_unit != null ? unitMoney(Number(l.target_unit), e.currency) : "—"}</Td>
                  <Td className="tabular-nums">{money(Number(l.line_cost), e.currency, 2)}</Td>
                  <Td className="tabular-nums">{unitMoney(sellPrice(Number(l.unit_cost), e.pricing_mode, Number(e.pricing_percent)), e.currency)}</Td>
                </tr>))}</tbody>
            </table>
          </Panel>
          {outbox.length > 0 && (
            <Panel title="Stocktool hand-off" sub="estimate.approved event in the integration outbox">
              {outbox.map((o) => (
                <details key={o.id} className="px-5 py-3 text-sm"><summary className="cursor-pointer"><Pill tone={o.status === "sent" ? "ok" : "info"}>{o.status}</Pill> queued {fmtDateTime(o.created_at)}</summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(o.payload, null, 2)}</pre></details>
              ))}
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Next step">
            <div className="space-y-4 p-5 text-sm">
              {e.status === "draft" && (
                <>
                  <ActionForm action={setPricing} hidden={{ id }} submit="Save pricing" variant="secondary">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Pricing" htmlFor="mode"><select id="mode" name="mode" defaultValue={e.pricing_mode} className="input"><option value="markup">Markup on cost</option><option value="margin">Margin on sell</option></select></Field>
                      <Field label="Percent" htmlFor="percent"><input id="percent" name="percent" defaultValue={e.pricing_percent} className="input" /></Field>
                    </div>
                    <p className="text-xs text-muted">Markup 15% on {money(cost, e.currency)} sells at {money(sellPrice(cost, "markup", 15), e.currency)}; a 15% margin sells at {money(sellPrice(cost, "margin", 15), e.currency)}.</p>
                  </ActionForm>
                  <ActionForm action={sendEstimate} hidden={{ id }} submit="Mark as sent to client" />
                </>
              )}
              {e.status === "sent" && (
                <ActionForm action={approveEstimate} hidden={{ id }} submit="Record client approval" confirm="Record that the client approved this estimate? This queues the Stocktool hand-off.">
                  <Field label="Client's PO / order reference" htmlFor="client_order_ref"><input id="client_order_ref" name="client_order_ref" className="input" /></Field>
                </ActionForm>
              )}
              {(e.status === "draft" || e.status === "sent") && (
                <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer font-semibold">Client declined</summary>
                  <div className="mt-3"><ActionForm action={declineEstimate} hidden={{ id }} submit="Record decline" variant="danger"><Field label="Reason" htmlFor="reason"><input id="reason" name="reason" required className="input" /></Field></ActionForm></div>
                </details>
              )}
              {e.status === "approved" && !livePo && (
                <ActionForm action={createPo} hidden={{ id }} submit="Raise supplier PO">
                  <Field label="Delivery date" htmlFor="delivery_date"><input id="delivery_date" name="delivery_date" type="date" className="input" /></Field>
                  <Field label="Notes" htmlFor="notes"><input id="notes" name="notes" className="input" /></Field>
                  <p className="text-xs text-muted">The DOA level needed is worked out from the matrix in force today. Someone else with that level approves it.</p>
                </ActionForm>
              )}
              {livePo && <p>Supplier PO <Link className="font-semibold underline" href={`/orders/purchase-orders/${livePo.id}`}>{livePo.po_number}</Link> · <StatusPill meta={PO_STATUS} value={livePo.status} /></p>}
              {e.status === "declined" && <p className="text-bad">Declined: {e.declined_reason}</p>}
              <p className="text-xs text-muted">Sent {fmtDate(e.sent_at)} · approved {fmtDate(e.approved_at)}</p>
            </div>
          </Panel>
          <Panel title="History"><ActivityList events={events} people={people} /></Panel>
        </div>
      </div>
    </>
  );
}
