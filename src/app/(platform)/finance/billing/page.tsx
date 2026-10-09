import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBills, getFinanceEstimates, isFinance } from "@/lib/finance-data";
import { BILL_STATUS, money } from "@/lib/finance-logic";
import { Card, Empty, PageHead, Panel } from "@/components/ui";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ActionForm } from "@/components/sourcing/action-form";
import { FilterLinks } from "@/components/finance/bits";
import { createBill } from "../actions";

export const metadata: Metadata = { title: "Client billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const status = ["draft", "sent", "paid", "cancelled", "all"].includes(sp.status ?? "") ? sp.status! : "all";
  const supabase = await createClient();
  const [bills, approved, canAct] = await Promise.all([getBills(supabase), getFinanceEstimates(supabase, { status: "approved" }), isFinance(supabase)]);
  const billed = new Set(bills.filter((b) => b.status !== "cancelled").map((b) => b.estimate_id));
  const toBill = approved.filter((e) => !billed.has(e.id));
  const list = bills.filter((b) => status === "all" || b.status === status);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Client billing" }]} title="Client billing"
        sub="Bills are raised from estimates the client has approved, at the sell price, to the job's billing entity. Numbers come from a sequence." />

      <Panel title="Approved estimates not yet billed" sub={`${toBill.length} waiting`}>
        {toBill.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Every approved estimate has a bill.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Estimate</Th><Th>Client</Th><Th>Client order</Th><Th>Sell</Th><Th>Approved</Th><Th /></tr></thead>
              <tbody>{toBill.map((e) => (
                <tr key={e.id} className="align-top">
                  <Td><Link className="font-semibold hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link><div className="text-xs text-muted">{e.job_number} · {e.job_title}</div></Td>
                  <Td>{e.client_name}<div className="text-xs text-muted">{e.market} · {e.region}</div></Td>
                  <Td>{e.client_order_ref ?? "—"}</Td>
                  <Td className="tabular-nums">{money(e.sell_price, e.currency)}</Td>
                  <Td>{fmtDate(e.approved_at)}</Td>
                  <Td>{canAct && (
                    <ActionForm action={createBill} hidden={{ estimate_id: e.id }} submit="Create bill" variant="secondary" inline>
                      <input name="vat_percent" className="input w-24" inputMode="decimal" placeholder="VAT %" aria-label="VAT rate %" defaultValue="0" />
                    </ActionForm>
                  )}</Td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <FilterLinks base="/finance/billing" param="status" current={status}
        options={[["all", "All"], ["draft", "Draft"], ["sent", "Sent"], ["paid", "Paid"], ["cancelled", "Cancelled"]].map(([k, l]) => ({ key: k, label: l, count: bills.filter((b) => k === "all" || b.status === k).length }))} />
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No bills here" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Bill</Th><Th>Client</Th><Th>Billing entity</Th><Th>Net</Th><Th>Gross</Th><Th>Due</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((b) => (
              <tr key={b.id}>
                <Td><Link className="font-semibold hover:underline" href={`/finance/billing/${b.id}`}>{b.bill_number}</Link><div className="text-xs text-muted">{b.estimate_number} · {b.job_number}</div></Td>
                <Td>{b.client_name}<div className="text-xs text-muted">{b.client_order_ref ?? ""}</div></Td>
                <Td>{b.billing_entity_name ?? "—"}</Td>
                <Td className="tabular-nums">{money(b.net_amount, b.currency)}</Td>
                <Td className="tabular-nums">{money(b.gross_amount, b.currency)}</Td>
                <Td className={b.status === "sent" && b.due_date && b.due_date < today ? "text-bad" : ""}>{fmtDate(b.due_date)}</Td>
                <Td><StatusPill meta={BILL_STATUS} value={b.status} /></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
