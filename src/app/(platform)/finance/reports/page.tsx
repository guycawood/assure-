import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpend } from "@/lib/finance-data";
import { SPEND_DIMENSIONS, currencies, groupSpend, money, moneyShort, pct, type SpendDimension } from "@/lib/finance-logic";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Td, Th } from "@/components/sourcing/bits";
import { Bars } from "@/components/finance/bits";

export const metadata: Metadata = { title: "Spend and savings" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ by?: string; cur?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const by = (SPEND_DIMENSIONS.find((d) => d.key === sp.by)?.key ?? "client") as SpendDimension;
  const supabase = await createClient();
  const all = await getSpend(supabase);
  const curs = currencies(all);
  const cur = sp.cur && curs.includes(sp.cur) ? sp.cur : curs[0];
  const rows = all.filter((r) => r.currency === cur);
  const groups = groupSpend(rows, by);
  const sell = rows.reduce((s, r) => s + Number(r.sell_price), 0);
  const cost = rows.reduce((s, r) => s + Number(r.po_value), 0);
  const invoiced = rows.reduce((s, r) => s + Number(r.invoiced), 0);
  const savings = rows.reduce((s, r) => s + Number(r.savings_vs_benchmark), 0);
  const overPo = rows.filter((r) => r.over_po);
  const href = (b: string, c = cur) => `/finance/reports?by=${b}${c ? `&cur=${c}` : ""}`;

  return (
    <>
      <PageHead crumbs={[{ label: "Finance+", href: "/finance" }, { label: "Spend and savings" }]} title="Spend and savings"
        sub="Sell price and savings from estimates, committed cost from supplier POs, and actual cost from supplier invoices. One currency at a time: there is no currency conversion yet." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Group by</span>
        {SPEND_DIMENSIONS.map((d) => (
          <Link key={d.key} href={href(d.key)} className={`rounded-full border px-3 py-1 font-semibold ${by === d.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{d.label}</Link>
        ))}
        {curs.length > 1 && <span className="ml-3 text-muted">Currency</span>}
        {curs.length > 1 && curs.map((c) => (
          <Link key={c} href={href(by, c)} className={`rounded-full border px-3 py-1 font-semibold ${cur === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{c}</Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sold (estimates)" value={moneyShort(sell, cur)} hint={`${rows.length} live estimate(s)`} icon={<MSymbol name="sell" />} />
        <Stat label="Committed (POs)" value={moneyShort(cost, cur)} hint={sell > 0 ? `Gross margin ${pct((100 * (sell - cost)) / sell)}` : undefined} icon={<MSymbol name="shopping_cart" />} />
        <Stat label="Invoiced (actual)" value={moneyShort(invoiced, cur)} hint={cost > 0 ? `${pct((100 * invoiced) / cost, 0)} of committed` : undefined} icon={<MSymbol name="receipt_long" />} />
        <Stat label="Savings vs benchmark" value={moneyShort(savings, cur)} tone={savings > 0 ? "ok" : undefined} hint={overPo.length ? `${overPo.length} PO(s) invoiced above value` : "No PO invoiced above value"} icon={<MSymbol name="savings" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Sold vs committed by ${SPEND_DIMENSIONS.find((d) => d.key === by)?.label.toLowerCase()}`}>
          <Bars currency={cur} primaryLabel="Sold" secondaryLabel="Committed on POs" rows={groups.map((g) => ({ key: g.key, label: g.label, value: g.sell, secondary: g.cost }))} />
        </Panel>
        <Panel title="Invoiced vs committed" sub="Red: invoiced above the PO value">
          <Bars currency={cur} primaryLabel="Committed on POs" secondaryLabel="Invoiced"
            rows={groups.map((g) => ({ key: g.key, label: g.label, value: g.cost, secondary: g.invoiced, flag: g.overPo > 0, hint: `Savings ${money(g.savings, cur)}` }))} />
        </Panel>
      </div>

      <Panel title="POs invoiced above their value" sub="Check the match on each invoice before approving more">
        {overPo.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Client</Th><Th>PO value</Th><Th>Invoiced</Th><Th>Over by</Th></tr></thead>
              <tbody>{overPo.map((r) => (
                <tr key={r.estimate_id}>
                  <Td><Link className="font-semibold hover:underline" href={`/finance/invoices?status=all`}>{r.po_number}</Link><div className="text-xs text-muted">{r.job_number}</div></Td>
                  <Td>{r.supplier_name}</Td><Td>{r.client_name}</Td>
                  <Td className="tabular-nums">{money(r.po_value, cur)}</Td><Td className="tabular-nums">{money(r.invoiced, cur)}</Td>
                  <Td className="tabular-nums text-bad">{money(Number(r.invoiced) - Number(r.po_value), cur)} <Pill tone="bad">{pct((100 * (Number(r.invoiced) - Number(r.po_value))) / Math.max(1, Number(r.po_value)))}</Pill></Td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Card className="min-w-0 overflow-x-auto">
        {groups.length === 0 ? <Empty title="No spend recorded yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>{SPEND_DIMENSIONS.find((d) => d.key === by)?.label}</Th><Th>Estimates</Th><Th>Sold</Th><Th>Committed</Th><Th>Invoiced</Th><Th>Margin</Th><Th>Savings</Th></tr></thead>
            <tbody>{groups.map((g) => (
              <tr key={g.key}>
                <Td className="font-semibold">{g.label}</Td><Td>{g.rows}</Td>
                <Td className="tabular-nums">{money(g.sell, cur)}</Td><Td className="tabular-nums">{money(g.cost, cur)}</Td>
                <Td className={`tabular-nums ${g.overPo ? "text-bad" : ""}`}>{money(g.invoiced, cur)}</Td>
                <Td className="tabular-nums">{g.sell > 0 && g.cost > 0 ? pct((100 * (g.sell - g.cost)) / g.sell) : "—"}</Td>
                <Td className="tabular-nums">{money(g.savings, cur)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
