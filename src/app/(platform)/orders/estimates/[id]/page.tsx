import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEvents, getLibrary, getPeople, getSpecs, one, rows } from "@/lib/sourcing-data";
import { money, pct, unitMoney } from "@/lib/sourcing";
import { ESTIMATE_STATUS, PO_STATUS, savingsPercent, type Estimate, type EstimateLine, type PurchaseOrder } from "@/lib/orders";
import {
  COST_CATEGORIES, costLabel, estimateSell, ORDER_FLAG, sellBreakdown, type ClientPo, type CostLine, type HandoffRow, type OrderFlag,
} from "@/lib/sourcing-hub";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import {
  addClientPo, approveEstimate, createPo, declineEstimate, refreshHandoff, removeClientPo, sendEstimate, setCommercials, setCostLines, setLogistics, setPricing,
} from "../../actions";

export const metadata: Metadata = { title: "Estimate" };

type EstimateHub = Estimate & {
  gsc_commission_percent: number; rebate_percent: number; additional_cost: number; port_of_loading: string | null; forwarder: string | null;
  consignee: string | null; hub: string | null; incoterm_code: string | null; order_flag: OrderFlag | null; client_po_total: number; client_po_count: number;
};

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const e = await one<EstimateHub>(supabase, "v_estimates", id);
  if (!e) notFound();
  const [lines, specs, pos, events, people, outbox, costLines, clientPos, incoterms, handoff] = await Promise.all([
    rows<EstimateLine>(supabase, "estimate_lines", { eq: { estimate_id: id } }), getSpecs(supabase, e.job_id),
    rows<PurchaseOrder>(supabase, "v_purchase_orders", { eq: { estimate_id: id } }), getEvents(supabase, { entity_id: id }), getPeople(supabase),
    rows<{ id: string; status: string; created_at: string; sent_at: string | null; payload: unknown }>(supabase, "integration_outbox", { eq: { aggregate_id: id } }),
    rows<CostLine>(supabase, "estimate_cost_lines", { eq: { estimate_id: id }, order: [["sort"]] }),
    rows<ClientPo>(supabase, "client_pos", { eq: { estimate_id: id }, order: [["po_date"], ["created_at"]] }),
    getLibrary(supabase, "incoterms"), one<HandoffRow>(supabase, "v_sourcing_handoff", id),
  ]);
  const specById = new Map(specs.map((s) => [s.id, s]));
  const cost = Number(e.base_cost);
  const extra = Number(e.additional_cost ?? 0);
  const totalCost = cost + extra;
  const sell = Number(e.sell_price);
  const commission = Number(e.gsc_commission_percent ?? 0);
  const rebate = Number(e.rebate_percent ?? 0);
  const br = sellBreakdown(totalCost, sell, commission, rebate);
  const livePo = pos.find((p) => !["rejected", "cancelled", "declined"].includes(p.status));
  const poTotal = Number(e.client_po_total ?? 0);
  const handedOff = outbox.some((o) => o.status === "sent");
  const waiting = outbox.some((o) => o.status === "queued" || o.status === "failed");
  const flag = e.order_flag ? ORDER_FLAG[e.order_flag] : null;

  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "Estimates", href: "/orders/estimates" }, { label: e.estimate_number }]}
        title={`Estimate ${e.estimate_number}`} sub={`${e.job_number} · ${e.job_title} · ${e.client_name} · supplier ${e.supplier_name}`}>
        <StatusPill meta={ESTIMATE_STATUS} value={e.status} />
        {flag && <Pill tone={flag.tone}>{flag.label}</Pill>}
      </PageHead>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Commercials">
            <Facts items={[
              ["Supplier (product) cost", money(cost, e.currency, 2)], ["Other costs", money(extra, e.currency, 2)], ["Total cost", money(totalCost, e.currency, 2)],
              ["Pricing", `${e.pricing_mode === "margin" ? "Margin" : "Markup"} ${e.pricing_percent}%`],
              ["GSC commission", `${commission}% · ${money(br.commissionAmount, e.currency, 2)}`], ["Client year-end rebate", `${rebate}% · ${money(br.rebateAmount, e.currency, 2)}`],
              ["Sell price to client", money(sell, e.currency, 2)],
              ["Gross profit after commission and rebate", `${money(br.grossProfit, e.currency, 2)} (${pct(sell ? (br.grossProfit / sell) * 100 : 0)} of sell)`],
              ["Benchmark", `${money(e.benchmark_value, e.currency, 2)} (${e.benchmark_source ?? "—"})`],
              ["Saving vs benchmark", `${money(e.savings_vs_benchmark, e.currency, 2)} · ${pct(savingsPercent(e.savings_vs_benchmark, e.benchmark_value))}`],
              ["Saving vs target prices", e.target_value != null ? `${money(e.savings_vs_target, e.currency, 2)} · ${pct(savingsPercent(e.savings_vs_target, e.target_value))}` : "No targets set"],
              ["Client savings target", pct(e.savings_target_percent)], ["Source", `${e.source}${e.rfq_number ? ` (${e.rfq_number})` : ""}`],
              ["Why this supplier", e.selection_reason], ["Bypass reason", e.bypass_reason_code ?? "None"],
              ["Client POs", `${e.client_po_count ?? 0} · ${money(poTotal, e.currency, 2)} of ${money(sell, e.currency, 2)}`], ["Client order ref", e.client_order_ref],
            ]} />
          </Panel>
          <Panel title="Lines">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Spec</Th><Th>Quantity</Th><Th>Unit cost</Th><Th>Benchmark</Th><Th>Target</Th><Th>Line cost</Th><Th>Unit sell</Th></tr></thead>
                <tbody>{lines.map((l) => (
                  <tr key={l.id}>
                    <Td><Link className="font-semibold hover:underline" href={`/sourcing/specs/${l.spec_id}`}>{specById.get(l.spec_id)?.title ?? "Spec"}</Link></Td>
                    <Td className="tabular-nums">{Number(l.quantity).toLocaleString("en-GB")}</Td><Td className="tabular-nums">{unitMoney(Number(l.unit_cost), e.currency)}</Td>
                    <Td className="tabular-nums">{l.benchmark_unit != null ? unitMoney(Number(l.benchmark_unit), e.currency) : "—"}</Td>
                    <Td className="tabular-nums">{l.target_unit != null ? unitMoney(Number(l.target_unit), e.currency) : "—"}</Td>
                    <Td className="tabular-nums">{money(Number(l.line_cost), e.currency, 2)}</Td>
                    <Td className="tabular-nums">{unitMoney(estimateSell(Number(l.unit_cost), e.pricing_mode, Number(e.pricing_percent), commission, rebate), e.currency)}</Td>
                  </tr>))}</tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Cost split" sub="So Stocktool can split the sales order: product cost from the supplier, plus testing, inspection, samples, logistics, design and installation.">
            <table className="w-full text-sm">
              <thead><tr><Th>Category</Th><Th>Description</Th><Th className="text-right">Amount</Th></tr></thead>
              <tbody>
                <tr><Td className="font-semibold">Product</Td><Td className="text-muted">Supplier lines</Td><Td className="text-right tabular-nums">{money(cost, e.currency, 2)}</Td></tr>
                {costLines.map((c) => <tr key={c.id}><Td className="font-semibold">{costLabel(c.category)}</Td><Td>{c.description ?? "—"}</Td><Td className="text-right tabular-nums">{money(Number(c.amount), e.currency, 2)}</Td></tr>)}
                <tr className="bg-surface-2/50"><Td className="font-semibold">Total cost</Td><Td /><Td className="text-right tabular-nums font-semibold">{money(totalCost, e.currency, 2)}</Td></tr>
              </tbody>
            </table>
            {e.status === "draft" && (
              <div className="border-t border-line p-5">
                <ActionForm action={setCostLines} hidden={{ id }} submit="Save cost split" variant="secondary">
                  <div className="grid gap-2 sm:grid-cols-[140px_160px_1fr]">
                    {COST_CATEGORIES.map((c) => {
                      const cur = costLines.find((x) => x.category === c.value);
                      return (
                        <div key={c.value} className="contents">
                          <span className="self-center text-sm font-semibold">{c.label}</span>
                          <input name={`cost_${c.value}`} inputMode="decimal" defaultValue={cur ? String(cur.amount) : ""} className="input" aria-label={`${c.label} amount`} placeholder="Amount" />
                          <input name={`costdesc_${c.value}`} defaultValue={cur?.description ?? ""} className="input" aria-label={`${c.label} description`} placeholder="Description (optional)" />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted">These costs are added to the supplier cost before markup or margin.</p>
                </ActionForm>
              </div>
            )}
          </Panel>

          <Panel title="Client POs" sub="A client can send several POs against one estimate. Together they can't be more than the sell price.">
            {clientPos.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No client POs yet{e.client_order_ref ? ` (order reference ${e.client_order_ref} recorded at approval)` : ""}.</p> : (
              <table className="w-full text-sm">
                <thead><tr><Th>PO number</Th><Th>Date</Th><Th className="text-right">Amount</Th><Th>File</Th><Th /></tr></thead>
                <tbody>{clientPos.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-semibold">{p.po_number}</Td><Td>{fmtDate(p.po_date)}</Td><Td className="text-right tabular-nums">{money(Number(p.amount), p.currency, 2)}</Td>
                    <Td>{p.file_id ? <a className="text-accent hover:underline" href={`/api/files/${p.file_id}`} target="_blank" rel="noreferrer">View</a> : "—"}</Td>
                    <Td className="text-right">{!handedOff && (
                      <ActionForm action={removeClientPo} hidden={{ id, po_id: p.id }} submit="Remove" variant="danger" inline confirm="Remove this client PO?">
                        <input name="reason" required placeholder="Why" className="input w-32" aria-label="Reason" />
                      </ActionForm>
                    )}</Td>
                  </tr>
                ))}
                  <tr className="bg-surface-2/50"><Td className="font-semibold">Total</Td><Td /><Td className="text-right tabular-nums font-semibold">{money(poTotal, e.currency, 2)}</Td><Td colSpan={2} className="text-xs text-muted">{money(Math.max(sell - poTotal, 0), e.currency, 2)} still to come</Td></tr>
                </tbody>
              </table>
            )}
            {(e.status === "sent" || e.status === "approved") && (
              <div className="border-t border-line p-5">
                <ActionForm action={addClientPo} hidden={{ id }} submit="Add client PO" variant="secondary">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="PO number" htmlFor="po_number"><input id="po_number" name="po_number" required className="input" /></Field>
                    <Field label={`Amount (${e.currency})`} htmlFor="amount"><input id="amount" name="amount" required inputMode="decimal" className="input" /></Field>
                    <Field label="PO date" htmlFor="po_date"><input id="po_date" name="po_date" type="date" className="input" /></Field>
                    <Field label="PO file (optional)" htmlFor="file"><input id="file" name="file" type="file" className="input" /></Field>
                  </div>
                </ActionForm>
              </div>
            )}
          </Panel>

          {outbox.length > 0 && (
            <Panel title="Stocktool hand-off" sub="estimate.approved event in the integration outbox">
              {outbox.map((o) => (
                <details key={o.id} className="px-5 py-3 text-sm"><summary className="cursor-pointer"><Pill tone={o.status === "sent" ? "ok" : o.status === "failed" ? "bad" : "info"}>{o.status}</Pill> queued {fmtDateTime(o.created_at)}{o.sent_at ? ` · sent ${fmtDateTime(o.sent_at)}` : ""}</summary>
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
                    <p className="text-xs text-muted">Markup 15% on {money(totalCost, e.currency)} sells at {money(estimateSell(totalCost, "markup", 15, commission, rebate), e.currency)}; a 15% margin sells at {money(estimateSell(totalCost, "margin", 15, commission, rebate), e.currency)} (with this estimate&apos;s commission and rebate).</p>
                  </ActionForm>
                  <ActionForm action={setCommercials} hidden={{ id }} submit="Save commission and rebate" variant="secondary">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="GSC commission %" htmlFor="gsc_commission_percent"><input id="gsc_commission_percent" name="gsc_commission_percent" defaultValue={commission} inputMode="decimal" className="input" /></Field>
                      <Field label="Client year-end rebate %" htmlFor="rebate_percent"><input id="rebate_percent" name="rebate_percent" defaultValue={rebate} inputMode="decimal" className="input" /></Field>
                    </div>
                    <p className="text-xs text-muted">Defaults come from the client&apos;s commercial rules. The sell price is grossed up so both come out of the sell price, not the margin.</p>
                  </ActionForm>
                  <ActionForm action={sendEstimate} hidden={{ id }} submit="Mark as sent to client" />
                </>
              )}
              {e.status === "sent" && (
                <ActionForm action={approveEstimate} hidden={{ id }} submit="Record client approval" confirm="Record that the client approved this estimate? This queues the Stocktool hand-off.">
                  <Field label="Client's PO / order reference" htmlFor="client_order_ref"><input id="client_order_ref" name="client_order_ref" className="input" /></Field>
                  <p className="text-xs text-muted">Add the client&apos;s PO documents under Client POs; there can be more than one.</p>
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

          {e.status !== "declined" && (
            <Panel title="Stocktool hand-off data" sub="Logistics details Stocktool needs for the SO and PO. Editable until the hand-off is sent.">
              <div className="space-y-3 p-5 text-sm">
                {handoff && (
                  (handoff.missing_fields ?? []).length > 0
                    ? <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">On hold for missing data: <b>{(handoff.missing_fields ?? []).join(", ")}</b>. Fill it in on the spec (Revise spec) or here, then refresh the hand-off.</p>
                    : <p className="rounded-lg bg-ok-soft px-3 py-2 text-ok">Nothing missing for Stocktool.</p>
                )}
                {!handedOff ? (
                  <ActionForm action={setLogistics} hidden={{ id }} submit="Save hand-off details" variant="secondary">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Incoterm" htmlFor="h_incoterm">
                        <select id="h_incoterm" name="incoterm" defaultValue={e.incoterm_code ?? ""} className="input">
                          <option value="">As on the RFQ (DDP if none)</option>
                          {incoterms.map((r) => <option key={r.id} value={r.code ?? ""}>{r.code}</option>)}
                        </select>
                      </Field>
                      <Field label="Port of loading" htmlFor="port_of_loading"><input id="port_of_loading" name="port_of_loading" defaultValue={e.port_of_loading ?? ""} className="input" /></Field>
                      <Field label="Forwarder" htmlFor="forwarder"><input id="forwarder" name="forwarder" defaultValue={e.forwarder ?? ""} className="input" /></Field>
                      <Field label="Consignee" htmlFor="consignee"><input id="consignee" name="consignee" defaultValue={e.consignee ?? ""} className="input" /></Field>
                      <Field label="Hub" htmlFor="hub" className="col-span-2"><input id="hub" name="hub" defaultValue={e.hub ?? ""} className="input" /></Field>
                    </div>
                  </ActionForm>
                ) : (
                  <Facts items={[["Incoterm", e.incoterm_code ?? "As on the RFQ"], ["Port of loading", e.port_of_loading], ["Forwarder", e.forwarder], ["Consignee", e.consignee], ["Hub", e.hub]]} />
                )}
                {e.status === "approved" && waiting && <ActionForm action={refreshHandoff} hidden={{ id }} submit="Refresh the waiting hand-off" variant="secondary" />}
              </div>
            </Panel>
          )}
          <Panel title="History"><ActivityList events={events} people={people} /></Panel>
        </div>
      </div>
    </>
  );
}
