import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFinanceEstimates, getQuoteQueue, isFinance } from "@/lib/finance-data";
import { money, pct } from "@/lib/finance-logic";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ActionForm } from "@/components/sourcing/action-form";
import { FilterLinks } from "@/components/finance/bits";
import { decideEstimate, decideQuote } from "../actions";

export const metadata: Metadata = { title: "Finance approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const show = sp.show === "decided" ? "decided" : "waiting";
  const supabase = await createClient();
  const [quotes, estimates, canDecide] = await Promise.all([getQuoteQueue(supabase), getFinanceEstimates(supabase), isFinance(supabase)]);
  const qList = quotes.filter((q) => (show === "waiting" ? q.finance_status === "pending" : q.finance_status !== "pending"));
  const eList = estimates.filter((e) => (show === "waiting" ? e.needs_review : e.review_status != null && !e.review_stale));

  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Approvals" }]} title="Quote and estimate approvals"
        sub="RFQ quotes need Finance before they can be awarded. Estimates come here when the margin is thin, the value is high or the minimum-quotes rule was bypassed (rules in the Finance+ Watchtower)." />
      {!canDecide && <Card className="px-5 py-3 text-sm text-muted">You can see the queue, but only Finance can approve or decline.</Card>}
      <FilterLinks base="/finance/approvals" param="show" current={show} options={[
        { key: "waiting", label: "Waiting", count: quotes.filter((q) => q.finance_status === "pending").length + estimates.filter((e) => e.needs_review).length },
        { key: "decided", label: "Decided" },
      ]} />

      <Panel title="RFQ quotes" sub="Decided with the same check RFQ+ uses; RFQ+ shows the result straight away">
        {qList.length === 0 ? <Empty title={show === "waiting" ? "No quotes waiting" : "No decisions yet"} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>RFQ</Th><Th>Supplier</Th><Th>Quote</Th><Th>Against</Th><Th>Bidding closes</Th><Th>{show === "waiting" ? "Decision" : "Finance"}</Th></tr></thead>
              <tbody>{qList.map((q) => (
                <tr key={q.response_id} className="align-top">
                  <Td><Link className="font-semibold hover:underline" href={`/rfq/${q.rfq_id}`}>{q.rfq_number}</Link><div className="text-xs text-muted">{q.rfq_title} · {q.job_number} · {q.client_name}</div><div className="text-xs text-muted">{q.market} · {q.region}</div></Td>
                  <Td>{q.supplier_name}<div className="text-xs text-muted">{q.source === "internal_entry" ? "Logged by a buyer" : "Vendor portal"}{q.lead_time_days != null ? ` · ${q.lead_time_days} days` : ""}</div></Td>
                  <Td className="tabular-nums font-semibold">{money(q.total_value, q.currency)}</Td>
                  <Td className="text-xs">
                    {q.estimated_value != null && <div>Estimate {money(q.estimated_value, q.currency)}</div>}
                    <div>Lowest of {q.quote_count}: {money(q.lowest_quote, q.currency)}</div>
                    {q.lowest_quote != null && q.total_value != null && Number(q.total_value) > Number(q.lowest_quote) && <Pill tone="warn">Not the lowest</Pill>}
                  </Td>
                  <Td>{fmtDateTime(q.due_at)}</Td>
                  <Td className="min-w-[16rem]">
                    {show === "waiting" ? (canDecide ? (
                      <ActionForm action={decideQuote} hidden={{ id: q.response_id }} submit="Record decision" variant="secondary">
                        <select name="decision" className="input" defaultValue="approve" aria-label="Decision"><option value="approve">Approve</option><option value="decline">Decline</option></select>
                        <input name="notes" className="input" placeholder="Notes (required to decline)" aria-label="Notes" />
                      </ActionForm>
                    ) : <span className="text-muted">Waiting for Finance</span>) : (
                      <div><Pill tone={q.finance_status === "approved" ? "ok" : "bad"}>{q.finance_status}</Pill><div className="text-xs text-muted">{fmtDateTime(q.finance_at)}{q.finance_notes ? ` · ${q.finance_notes}` : ""}</div></div>
                    )}
                  </Td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Estimates" sub="A review goes stale if the estimate is repriced afterwards">
        {eList.length === 0 ? <Empty title={show === "waiting" ? "No estimates need a finance review" : "No reviews yet"} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Estimate</Th><Th>Supplier</Th><Th>Cost</Th><Th>Sell</Th><Th>Margin</Th><Th>Why it is here</Th><Th>{show === "waiting" ? "Decision" : "Finance"}</Th></tr></thead>
              <tbody>{eList.map((e) => (
                <tr key={e.id} className="align-top">
                  <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link><div className="text-xs text-muted">{e.job_number} · {e.client_name} · {e.status}</div></Td>
                  <Td>{e.supplier_name}</Td>
                  <Td className="tabular-nums">{money(e.base_cost, e.currency)}</Td>
                  <Td className="tabular-nums font-semibold">{money(e.sell_price, e.currency)}<div className="text-xs font-normal text-muted">{e.pricing_mode} {pct(e.pricing_percent)}</div></Td>
                  <Td className="tabular-nums">{pct(e.margin_percent)}</Td>
                  <Td className="text-xs">{e.review_triggers.length ? e.review_triggers.join("; ") : "—"}{e.review_stale && <div><Pill tone="warn">Repriced since review</Pill></div>}</Td>
                  <Td className="min-w-[16rem]">
                    {show === "waiting" ? (canDecide ? (
                      <ActionForm action={decideEstimate} hidden={{ id: e.id }} submit="Record decision" variant="secondary">
                        <select name="decision" className="input" defaultValue="approve" aria-label="Decision"><option value="approve">Approve</option><option value="decline">Decline</option></select>
                        <input name="reason" className="input" placeholder="Reason (required to decline)" aria-label="Reason" />
                      </ActionForm>
                    ) : <span className="text-muted">Waiting for Finance</span>) : (
                      <div><Pill tone={e.review_status === "approved" ? "ok" : "bad"}>{e.review_status}</Pill><div className="text-xs text-muted">{fmtDate(e.reviewed_at)}{e.review_reason ? ` · ${e.review_reason}` : ""}</div></div>
                    )}
                  </Td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
