import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFinanceEstimates, getInvoices, getPayments, getQuoteQueue, getSpend } from "@/lib/finance-data";
import { INVOICE_STATUS, MATCH_STATUS, currencies, money, moneyShort, type SpendRow } from "@/lib/finance-logic";
import { ButtonLink, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Bars } from "@/components/finance/bits";

export const metadata: Metadata = { title: "Finance+" };

export default async function FinanceDashboard() {
  await requireInternal();
  const supabase = await createClient();
  const [invoices, payments, quotes, estimates, spend] = await Promise.all([
    getInvoices(supabase), getPayments(supabase), getQuoteQueue(supabase), getFinanceEstimates(supabase, { needs_review: true }), getSpend(supabase),
  ]);
  const toMatch = invoices.filter((i) => i.status === "submitted");
  const inReview = invoices.filter((i) => i.status === "matching");
  const unmatched = inReview.filter((i) => i.match_status !== "matched");
  const quotesPending = quotes.filter((q) => q.finance_status === "pending");
  const overdue = payments.filter((p) => p.status === "overdue");
  const dueSoon = payments.filter((p) => p.status === "due");
  const overPo = spend.filter((r) => r.over_po);

  // Spend vs budget per job, in the most-used currency (no FX conversion yet).
  const cur = currencies(spend)[0];
  const byJob = new Map<string, { job: SpendRow; cost: number; invoiced: number }>();
  for (const r of spend.filter((x) => x.currency === cur)) {
    const g = byJob.get(r.job_id) ?? { job: r, cost: 0, invoiced: 0 };
    g.cost += Number(r.po_value);
    g.invoiced += Number(r.invoiced);
    byJob.set(r.job_id, g);
  }
  const budgetRows = [...byJob.values()].filter((g) => g.job.budget != null && (g.cost > 0 || g.invoiced > 0))
    .sort((a, b) => b.cost - a.cost).slice(0, 8);

  return (
    <>
      <PageHead title="Finance+" sub="Approve quotes and estimates, match supplier invoices against the PO and the delivery and install evidence, schedule and record payments, and bill clients.">
        <ButtonLink href="/finance/approvals">Approvals</ButtonLink>
        <ButtonLink href="/finance/invoices" variant="primary">Supplier invoices</ButtonLink>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Invoices to match" value={toMatch.length} tone={toMatch.length ? "warn" : "ok"}
          hint={unmatched.length ? `${unmatched.length} in review with a variance or missing evidence` : "Nothing stuck in review"} icon={<MSymbol name="receipt_long" />} />
        <Stat label="Approvals waiting" value={quotesPending.length + estimates.length} tone={quotesPending.length + estimates.length ? "warn" : "ok"}
          hint={<Link className="underline" href="/finance/approvals">{quotesPending.length} quote(s), {estimates.length} estimate(s)</Link>} icon={<MSymbol name="approval" />} />
        <Stat label="Overdue payments" value={overdue.length} tone={overdue.length ? "bad" : "ok"}
          hint={dueSoon.length ? `${dueSoon.length} more due this week` : "Nothing due this week"} icon={<MSymbol name="schedule" />} />
        <Stat label="POs invoiced above value" value={overPo.length} tone={overPo.length ? "bad" : "ok"} hint={<Link className="underline" href="/finance/reports">See spend and savings</Link>} icon={<MSymbol name="warning" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Invoices waiting for Finance" sub="New invoices to match, and those in review" actions={<ButtonLink href="/finance/invoices">All</ButtonLink>}>
          {[...toMatch, ...inReview].length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr><Th>Invoice</Th><Th>Supplier</Th><Th>Gross</Th><Th>Status</Th></tr></thead>
                <tbody>{[...toMatch, ...inReview].slice(0, 8).map((i) => (
                  <tr key={i.id}>
                    <Td><Link className="font-semibold hover:underline" href={`/finance/invoices/${i.id}`}>{i.invoice_number}</Link><div className="text-xs text-muted">{i.invoice_ref} · {i.po_number}</div></Td>
                    <Td>{i.supplier_name}</Td><Td className="tabular-nums">{money(i.gross_amount, i.currency)}</Td>
                    <Td><StatusPill meta={INVOICE_STATUS} value={i.status} />{i.status === "matching" && <div className="mt-1"><StatusPill meta={MATCH_STATUS} value={i.match_status} /></div>}</Td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </Panel>
        <Panel title="Payments overdue and due this week" actions={<ButtonLink href="/finance/payments">Payments</ButtonLink>}>
          {[...overdue, ...dueSoon].length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing due.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr><Th>Due</Th><Th>Supplier</Th><Th>Invoice</Th><Th>Amount</Th></tr></thead>
                <tbody>{[...overdue, ...dueSoon].slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <Td className={p.status === "overdue" ? "text-bad" : ""}>{fmtDate(p.due_date)}</Td><Td>{p.supplier_name}</Td>
                    <Td><Link className="hover:underline" href={`/finance/invoices/${p.invoice_id}`}>{p.invoice_number}</Link><div className="text-xs text-muted">Payment {p.seq}</div></Td>
                    <Td className="tabular-nums">{money(p.amount, p.currency)}</Td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Spend vs budget" sub={cur ? `Committed (PO) and invoiced against the job budget, in ${cur}. Other currencies are on the reports page.` : undefined}
        actions={<ButtonLink href="/finance/reports">Reports</ButtonLink>}>
        <Bars currency={cur} primaryLabel="Committed on POs" secondaryLabel="Invoiced"
          rows={budgetRows.map((g) => ({
            key: g.job.job_id, value: g.cost, secondary: g.invoiced, flag: g.invoiced > g.cost,
            label: <span>{g.job.job_number} <span className="font-normal text-muted">{g.job.client_name}</span></span>,
            hint: `Budget ${moneyShort(Number(g.job.budget), cur)} · ${g.cost > Number(g.job.budget) ? "over budget" : `${Math.round((100 * g.cost) / Math.max(1, Number(g.job.budget)))}% used`}`,
          }))} />
      </Panel>
    </>
  );
}
