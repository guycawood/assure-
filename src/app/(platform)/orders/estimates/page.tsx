import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { money, pct } from "@/lib/sourcing";
import { ESTIMATE_STATUS, savingsPercent, type Estimate } from "@/lib/orders";
import { ORDER_FLAG, type OrderFlag } from "@/lib/sourcing-hub";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ActionForm } from "@/components/sourcing/action-form";
import { chaseClientPo } from "../actions";

type PoWaiting = {
  estimate_id: string; estimate_number: string; job_number: string; job_title: string; client_name: string; sell_price: number; currency: string;
  days_waiting: number; chases: number; last_chased_at: string | null; chase_due: boolean;
};

export const metadata: Metadata = { title: "Estimates" };

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  let list = await rows<Estimate & { order_flag: OrderFlag | null }>(supabase, "v_estimates", { order: [["created_at", false]], limit: 2000 });
  const total = list.length;
  const awaiting = ((await supabase.rpc("estimate_po_waiting")).data ?? []) as PoWaiting[];
  if (sp.status) list = list.filter((e) => e.status === sp.status);
  if (sp.flag) list = list.filter((e) => e.order_flag === sp.flag);
  return (
    <>
      <PageHead crumbs={[{ label: "Order Management", href: "/orders" }, { label: "Estimates" }]} title="Estimates" sub="What the client is charged: the supplier cost plus markup or margin, with the savings achieved." />
      {awaiting.length > 0 && (
        <Panel title="Waiting for the client's PO" sub="The client approved these estimates but no purchase order is on record. Chase them: it reaches their approvers in the portal and by email, at most once every 3 days.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Estimate</Th><Th>Client</Th><Th>Sell</Th><Th>Waiting</Th><Th>Chased</Th><Th /></tr></thead>
              <tbody>{awaiting.slice(0, 25).map((w) => (
                <tr key={w.estimate_id} className="align-top">
                  <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${w.estimate_id}`}>{w.estimate_number}</Link><div className="text-xs text-muted">{w.job_number} · {w.job_title}</div></Td>
                  <Td>{w.client_name}</Td>
                  <Td className="tabular-nums">{money(w.sell_price, w.currency)}</Td>
                  <Td className={w.days_waiting >= 7 ? "font-semibold text-bad" : w.days_waiting >= 3 ? "text-warn" : ""}>{w.days_waiting} day{w.days_waiting === 1 ? "" : "s"}</Td>
                  <Td className="text-xs">{w.chases ? `${w.chases}× · last ${fmtDate(w.last_chased_at)}` : "Not yet"}</Td>
                  <Td>{w.chase_due ? (
                    <ActionForm action={chaseClientPo} hidden={{ id: w.estimate_id }} submit="Chase the client" variant="secondary" inline>
                      <input name="note" className="input w-56" placeholder="Note for the client (optional)" aria-label="Note for the client" />
                    </ActionForm>
                  ) : <Pill>Chased recently</Pill>}</Td>
                </tr>))}</tbody>
            </table>
          </div>
        </Panel>
      )}
      <form method="get" className="flex gap-2">
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">All statuses</option>{Object.entries(ESTIMATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="flag" defaultValue={sp.flag ?? ""} className="input w-auto" aria-label="Order flag"><option value="">Any order flag</option>{Object.entries(ORDER_FLAG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <Card className="min-w-0 overflow-x-auto">
        {total === 0 ? <Empty title="No estimates yet"><p>Awarding an RFQ, or pricing lines at triage, drafts an estimate.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Estimate</Th><Th>Job</Th><Th>Supplier</Th><Th>Source</Th><Th>Cost</Th><Th>Sell</Th><Th>Saving vs benchmark</Th><Th>Saving vs target</Th><Th>Status</Th><Th>Order</Th><Th>Created</Th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id}>
                <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link></Td>
                <Td><Link className="hover:underline" href={`/sourcing/jobs/${e.job_id}`}>{e.job_number}</Link><div className="text-xs text-muted">{e.client_name}</div></Td>
                <Td>{e.supplier_name}</Td><Td className="capitalize">{e.source}{e.rfq_number ? ` · ${e.rfq_number}` : ""}</Td>
                <Td className="tabular-nums">{money(e.base_cost, e.currency)}</Td><Td className="tabular-nums">{money(e.sell_price, e.currency)}</Td>
                <Td className="tabular-nums">{money(e.savings_vs_benchmark, e.currency)} <span className="text-xs text-muted">{pct(savingsPercent(e.savings_vs_benchmark, e.benchmark_value))}</span></Td>
                <Td className="tabular-nums">{money(e.savings_vs_target, e.currency)} <span className="text-xs text-muted">{pct(savingsPercent(e.savings_vs_target, e.target_value))}</span></Td>
                <Td><StatusPill meta={ESTIMATE_STATUS} value={e.status} /></Td>
                <Td>{e.order_flag ? <Pill tone={ORDER_FLAG[e.order_flag].tone}>{ORDER_FLAG[e.order_flag].label}</Pill> : "—"}</Td>
                <Td>{fmtDate(e.created_at)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
