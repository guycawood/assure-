import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines, getRules } from "@/lib/conscious-ordering-data";
import { co2, eur, groups, int, pct, specGroup, STATUS_META, totals, VERDICT_META, wasteRates } from "@/lib/conscious-ordering";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Tabs, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Conscious ordering" };

const BASE = "/watchtower/sustainability/conscious-ordering";
const VIEWS = [
  { key: "brand_market", label: "Brand and market" },
  { key: "brand", label: "Brand" },
  { key: "market", label: "Market" },
] as const;
type View = (typeof VIEWS)[number]["key"];

// Conscious ordering: what was ordered against what was delivered, installed and held in stock, who is over-ordering,
// and a spend-based estimate for orders with no evidence.
export default async function ConsciousOrdering({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.tab) ? (sp.tab as View) : "brand_market";
  const supabase = await createClient();
  const [lines, rules] = await Promise.all([getOrderLines(supabase), getRules(supabase)]);
  const t = totals(lines, rules);
  const rates = wasteRates(lines, rules);
  const rollup = groups(lines, rules, view);
  const advise = groups(lines, rules, "brand_market").filter((g) => g.verdict === "over_ordering" || g.verdict === "watch");
  const flagged = advise.filter((g) => g.verdict === "over_ordering");
  const worst = lines.filter((l) => l.status !== "untracked")
    .sort((a, b) => b.wasted * Number(b.unit_cost_eur ?? 0) - a.wasted * Number(a.unit_cost_eur ?? 0) || b.ordered - a.ordered).slice(0, 15);
  const split: [string, number, string][] = [
    ["Installed", t.installed, "bg-ok"], ["In stock", t.inStock, "bg-info"], ["Stock past its age limit", t.agedStock, "bg-warn"], ["Unaccounted for", t.unaccounted, "bg-bad"],
  ];
  const splitTotal = split.reduce((a, [, v]) => a + v, 0);

  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Sustainability", href: "/watchtower/sustainability" }, { label: "Conscious ordering" }]}
        title="Conscious ordering"
        sub="Every unit ordered is checked against what was delivered, installed in an outlet or counted in stock. Anything left over with no evidence is presumed wasted, and brands and markets that keep over-ordering are advised to order less." />

      {lines.length === 0 ? <Card><Empty title="No issued purchase orders yet">Orders appear here once a purchase order is issued.</Empty></Card> : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Orders with evidence" value={pct(t.coverage)} tone={t.coverage == null ? undefined : t.coverage >= 80 ? "ok" : t.coverage >= 40 ? "warn" : "bad"}
              hint={`${int(t.trackedUnits)} of ${int(t.ordered)} units ordered have installs or a stock count`} icon={<MSymbol name="fact_check" size={20} />} />
            <Stat label="Installed of ordered" value={pct(t.utilisation)} tone={t.utilisation == null ? undefined : t.utilisation >= rules.target ? "ok" : "bad"}
              hint={`Measured on ${t.reconciledLines} reconciled order lines · target ${rules.target}%`} icon={<MSymbol name="storefront" size={20} />} />
            <Stat label="Presumed wasted (measured)" value={int(t.wasted)} tone={t.wasted > 0 ? "bad" : "ok"}
              hint={`${eur(t.wastedEur)} · ${co2(t.wastedKg)}`} icon={<MSymbol name="delete_sweep" size={20} />} />
            <Stat label="Likely waste in untracked orders" value={eur(t.estWastedEur)} tone={t.untrackedLines ? "warn" : "ok"}
              hint={`Estimated from ${eur(t.untrackedSpendEur)} of spend · ${co2(t.estWastedKg)}`} icon={<MSymbol name="query_stats" size={20} />} />
          </section>

          <section className="grid gap-4 xl:grid-cols-5">
            <Panel className="xl:col-span-2" title="Where the delivered units went" sub={`${t.reconciledLines} reconciled order lines`}>
              {splitTotal === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing reconciled yet.</p> : (
                <div className="space-y-3 px-5 py-4">
                  <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Split of delivered units">
                    {split.map(([label, v, cls]) => (v > 0 ? <div key={label} className={cls} style={{ width: `${(100 * v) / splitTotal}%` }} title={`${label}: ${int(v)}`} /> : null))}
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {split.map(([label, v, cls]) => (
                      <li key={label} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden />{label}</span>
                        <span className="tabular-nums">{int(v)} <span className="text-xs text-muted">({pct((100 * v) / splitTotal)})</span></span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">Stock not counted again within {rules.stockAgeMonths} months, and anything unaccounted for, is presumed wasted.</p>
                </div>
              )}
            </Panel>
            <Panel className="xl:col-span-3" title="Who to advise" sub={`${flagged.length} brand and market combination${flagged.length === 1 ? "" : "s"} over-ordering on ${rules.minOrders} or more orders`}>
              {advise.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No brand and market is under the {rules.target}% target.</p> : (
                <ul className="max-h-[22rem] divide-y divide-line overflow-y-auto">
                  {advise.slice(0, 12).map((g) => (
                    <li key={g.key} className="flex items-start gap-3 px-5 py-3 text-sm">
                      <Pill tone={VERDICT_META[g.verdict].tone}>{VERDICT_META[g.verdict].label}</Pill>
                      <div className="min-w-0">
                        <p>{g.advice}</p>
                        <p className="mt-0.5 text-xs text-muted">{int(g.wasted)} units presumed wasted · {eur(g.wastedEur)} · {co2(g.wastedKg)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          <Card className="min-w-0">
            <div className="px-5 pt-3"><Tabs base={BASE} current={view} tabs={VIEWS.map((v) => ({ key: v.key, label: v.label }))} /></div>
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface"><tr>
                  {view !== "market" && <Th>Brand</Th>}{view !== "brand" && <Th>Market</Th>}
                  <Th>Verdict</Th><Th className="text-right">Order lines</Th><Th className="text-right">Ordered</Th><Th className="text-right">Evidence</Th>
                  <Th className="text-right">Installed</Th><Th className="text-right">Presumed wasted</Th><Th className="text-right">Wasted spend</Th><Th className="text-right">Wasted CO2e</Th>
                  <Th className="text-right">Estimated (untracked)</Th>
                </tr></thead>
                <tbody>{rollup.map((g) => (
                  <tr key={g.key}>
                    {view !== "market" && <Td className="font-semibold">{g.brand}</Td>}
                    {view !== "brand" && <Td className="whitespace-nowrap">{g.market}{g.region && <span className="text-xs text-muted"> · {g.region}</span>}</Td>}
                    <Td><Pill tone={VERDICT_META[g.verdict].tone} title={g.advice}>{VERDICT_META[g.verdict].label}</Pill></Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{g.lines}<span className="text-xs text-muted"> · {g.reconciledLines} reconciled</span></Td>
                    <Td className="text-right tabular-nums">{int(g.ordered)}</Td>
                    <Td className="text-right tabular-nums">{pct(g.coverage)}</Td>
                    <Td className="text-right tabular-nums">{pct(g.utilisation)}</Td>
                    <Td className="text-right tabular-nums">{g.reconciledLines ? int(g.wasted) : "—"}</Td>
                    <Td className="text-right tabular-nums">{g.reconciledLines ? eur(g.wastedEur) : "—"}</Td>
                    <Td className="text-right tabular-nums">{g.reconciledLines ? co2(g.wastedKg) : "—"}</Td>
                    <Td className="text-right tabular-nums text-muted">{g.untrackedLines ? eur(g.estWastedEur) : "—"}</Td>
                  </tr>))}</tbody>
              </table>
            </div>
            <p className="border-t border-line px-5 py-2 text-[0.7rem] text-muted">
              Evidence = share of ordered units with installs or a stock count. Installed = installed ÷ ordered on reconciled lines. Estimated = spend on untracked orders × the surplus rate measured for that product type.
            </p>
          </Card>

          <Panel title="Order lines to look at first" sub="Tracked order lines, biggest wasted spend first. Open one to see its counts or record a stock count.">
            {worst.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No order has install or stock evidence yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr><Th>Order</Th><Th>Brand and market</Th><Th>Item</Th><Th>Status</Th><Th className="text-right">Ordered</Th><Th className="text-right">Delivered</Th>
                  <Th className="text-right">Installed</Th><Th className="text-right">In stock</Th><Th className="text-right">Unaccounted</Th><Th className="text-right">Wasted spend</Th></tr></thead>
                <tbody>{worst.map((l) => (
                  <tr key={`${l.po_id}-${l.spec_id}`}>
                    <Td><Link className="font-semibold hover:underline" href={`${BASE}/${l.po_id}`}>{l.po_number}</Link><div className="text-xs text-muted">{fmtDate(l.po_date)}</div></Td>
                    <Td>{l.brand}<div className="text-xs text-muted">{l.market}</div></Td>
                    <Td>{l.spec_title}<div className="text-xs text-muted">{specGroup(l.spec_type)}</div></Td>
                    <Td><Pill tone={STATUS_META[l.status].tone}>{STATUS_META[l.status].label}</Pill></Td>
                    <Td className="text-right tabular-nums">{int(l.ordered)}</Td><Td className="text-right tabular-nums">{int(l.delivered)}</Td>
                    <Td className="text-right tabular-nums">{int(l.installed)}</Td>
                    <Td className="text-right tabular-nums">{int(l.in_stock)}{l.aged_stock > 0 && <div className="text-xs text-warn">{int(l.aged_stock)} past age limit</div>}</Td>
                    <Td className="text-right tabular-nums">{int(l.unaccounted)}</Td>
                    <Td className="text-right tabular-nums">{eur(l.wasted * Number(l.unit_cost_eur ?? 0))}</Td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>

          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-bold">How the figures are worked out</h2>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li><span className="text-fg">Measured:</span> orders with installs recorded in Execution or a stock count. Surplus = delivered − installed; stock on hand explains part of it, the rest is unaccounted for.</li>
              <li><span className="text-fg">Estimated:</span> orders with no evidence. Spend × the surplus rate measured on tracked orders of the same product type
                ({rates.measured ? `${pct(rates.overall, 1)} overall today` : `${rules.defaultRate}% default until ${rules.minOrders} orders are reconciled`}). The least accurate method, so it is always shown separately.</li>
              <li><span className="text-fg">CO2e:</span> the spec&apos;s own footprint where it has one, otherwise spend × a spend-based factor. Indicative, not a product carbon footprint.</li>
              <li><span className="text-fg">Money:</span> order cost converted to EUR at the Watchtower reporting rates.</li>
            </ul>
            <p className="text-xs">
              <Link className="font-semibold text-accent hover:underline" href="/watchtower/libraries/conscious_ordering_rules">Rules</Link>{" · "}
              <Link className="font-semibold text-accent hover:underline" href="/watchtower/libraries/spend_emission_factors">Spend-based emission factors</Link>{" · "}
              <Link className="font-semibold text-accent hover:underline" href="/execution/deployments">Installs in Execution</Link>
            </p>
          </Card>
        </>
      )}
    </>
  );
}
