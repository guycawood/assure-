import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPayments, isFinance } from "@/lib/finance-data";
import { PAYMENT_STATUS, cashOutForecast, currencies, money } from "@/lib/finance-logic";
import { Card, Empty, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ActionForm } from "@/components/sourcing/action-form";
import { Bars, FilterLinks } from "@/components/finance/bits";
import { markPaid } from "../actions";

export const metadata: Metadata = { title: "Supplier payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; by?: string; cur?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const status = ["open", "overdue", "due", "upcoming", "paid", "all"].includes(sp.status ?? "") ? sp.status! : "open";
  const by = sp.by === "month" ? "month" : "week";
  const supabase = await createClient();
  const [all, canAct] = await Promise.all([getPayments(supabase), isFinance(supabase)]);
  const curs = currencies(all);
  const cur = sp.cur && curs.includes(sp.cur) ? sp.cur : curs[0];
  const today = new Date().toISOString().slice(0, 10);
  const list = all.filter((p) => (status === "all" ? true : status === "open" ? p.status !== "paid" : p.status === status));
  const inCur = all.filter((p) => p.currency === cur);
  const forecast = cashOutForecast(inCur, by, today, by === "week" ? 8 : 6);
  const sum = (xs: typeof all) => xs.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Payments" }]} title="Supplier payments"
        sub="Every scheduled instalment, with the cash going out by week or month. Only Finance marks a payment paid, with the bank reference." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Overdue" value={money(sum(inCur.filter((p) => p.status === "overdue")), cur)} tone={inCur.some((p) => p.status === "overdue") ? "bad" : "ok"} hint={`${all.filter((p) => p.status === "overdue").length} instalment(s), all currencies`} icon={<MSymbol name="warning" />} />
        <Stat label="Due this week" value={money(sum(inCur.filter((p) => p.status === "due")), cur)} icon={<MSymbol name="event_upcoming" />} />
        <Stat label="Still to pay" value={money(sum(inCur.filter((p) => p.status !== "paid")), cur)} icon={<MSymbol name="account_balance" />} />
        <Stat label="Paid" value={money(sum(inCur.filter((p) => p.status === "paid")), cur)} icon={<MSymbol name="paid" />} />
      </div>

      <Panel title="Cash-out forecast" sub={`Unpaid instalments in ${cur ?? "—"} by due ${by}; overdue amounts are counted in the current ${by}.`}
        actions={
          <div className="flex flex-wrap gap-2 text-sm">
            {(["week", "month"] as const).map((b) => <Link key={b} href={`/finance/payments?status=${status}&by=${b}${cur ? `&cur=${cur}` : ""}`} className={b === by ? "font-semibold text-accent" : "text-muted hover:text-fg"}>By {b}</Link>)}
            {curs.length > 1 && curs.map((c) => <Link key={c} href={`/finance/payments?status=${status}&by=${by}&cur=${c}`} className={c === cur ? "font-semibold text-accent" : "text-muted hover:text-fg"}>{c}</Link>)}
          </div>
        }>
        <Bars currency={cur} primaryLabel="To pay" secondaryLabel="Of which overdue"
          rows={forecast.map((b) => ({ key: b.key, label: b.label, value: b.amount, secondary: b.overdue > 0 ? b.overdue : undefined, hint: b.count ? `${b.count} payment(s)` : undefined }))} />
      </Panel>

      <FilterLinks base="/finance/payments" param="status" current={status} options={[
        ["open", "Not paid"], ["overdue", "Overdue"], ["due", "Due this week"], ["upcoming", "Upcoming"], ["paid", "Paid"], ["all", "All"],
      ].map(([k, l]) => ({ key: k, label: l, count: all.filter((p) => (k === "all" ? true : k === "open" ? p.status !== "paid" : p.status === k)).length }))} />
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No payments here" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Due</Th><Th>Supplier</Th><Th>Invoice</Th><Th>Amount</Th><Th>Status</Th><Th>Paid</Th><Th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} className="align-top">
                <Td className={p.status === "overdue" ? "text-bad" : ""}>{fmtDate(p.due_date)}</Td>
                <Td>{p.supplier_name}<div className="text-xs text-muted">{p.market} · {p.region}</div></Td>
                <Td><Link className="font-semibold hover:underline" href={`/finance/invoices/${p.invoice_id}`}>{p.invoice_number}</Link><div className="text-xs text-muted">{p.invoice_ref} · {p.po_number} · payment {p.seq}</div></Td>
                <Td className="tabular-nums">{money(p.amount, p.currency)}</Td>
                <Td><StatusPill meta={PAYMENT_STATUS} value={p.status} /></Td>
                <Td>{p.paid_on ? <>{fmtDate(p.paid_on)}<div className="text-xs text-muted">{p.payment_reference}</div></> : "—"}</Td>
                <Td>{canAct && !p.paid_at && p.invoice_status === "scheduled" && (
                  <ActionForm action={markPaid} hidden={{ id: p.id }} submit="Mark paid" variant="secondary" inline>
                    <input name="reference" className="input w-36" placeholder="Payment reference" aria-label="Payment reference" required />
                  </ActionForm>
                )}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
