import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines, getRules } from "@/lib/conscious-ordering-data";
import { co2, eur, groups, int, mass, monthLabel, pct, savingEur, specGroup, totals, totalsBy, VERDICT_META, wasteRates } from "@/lib/conscious-ordering";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Bars } from "@/components/crm/bits";
import { MSymbol } from "@/components/symbol";
import { CO_BASE, ConsciousNav } from "./sub-nav";

export const metadata: Metadata = { title: "Conscious ordering" };

// Conscious ordering dashboard: the saving on offer (cost, material, emissions, units) across the top, then where the
// units went, who to advise, and where the saving sits by product type, month, brand and market.
export default async function ConsciousOrderingDashboard() {
  await requireInternal();
  const supabase = await createClient();
  const [lines, rules] = await Promise.all([getOrderLines(supabase), getRules(supabase)]);
  const t = totals(lines, rules);
  const rates = wasteRates(lines, rules);
  const advise = groups(lines, rules, "brand_market").filter((g) => g.verdict === "over_ordering" || g.verdict === "watch");
  const flagged = advise.filter((g) => g.verdict === "over_ordering");
  const split: [string, number, string][] = [
    ["Installed", t.installed, "bg-ok"], ["In stock", t.inStock, "bg-info"], ["Stock past its age limit", t.agedStock, "bg-warn"], ["Unaccounted for", t.unaccounted, "bg-bad"],
  ];
  const splitTotal = split.reduce((a, [, v]) => a + v, 0);
  const top = (key: (l: (typeof lines)[number]) => string, n = 6) =>
    totalsBy(lines, rules, key).sort((a, b) => savingEur(b.totals) - savingEur(a.totals)).slice(0, n)
      .map((x) => ({ label: x.key, value: savingEur(x.totals), text: eur(savingEur(x.totals)) }));
  const byType = totalsBy(lines, rules, (l) => specGroup(l.spec_type)).sort((a, b) => savingEur(b.totals) - savingEur(a.totals));
  const months = totalsBy(lines.filter((l) => l.status === "reconciled"), rules, (l) => String(l.po_date).slice(0, 7))
    .sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  const weighed = pct(t.reconciledOrdered ? (100 * t.weighedUnits) / t.reconciledOrdered : null);

  return (
    <>
      <PageHead crumbs={[{ label: "Sustainability", href: "/sustainability" }, { label: "Conscious ordering" }]} title="Conscious ordering"
        sub="What could be saved by ordering only what gets used: cost, material and emissions in the units that were delivered but never installed or accounted for." />
      <ConsciousNav current="dashboard" />

      {lines.length === 0 ? <Card><Empty title="No issued purchase orders yet">Orders appear here once a purchase order is issued.</Empty></Card> : (
        <>
          <section aria-label="Saving opportunity">
            <h2 className="eyebrow mb-2">Saving opportunity</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Cost" value={eur(t.wastedEur)} tone={t.wastedEur > 0 ? "bad" : "ok"}
                hint={<>Measured · plus {eur(t.estWastedEur)} estimated on untracked orders</>} icon={<MSymbol name="payments" size={20} />} />
              <Stat label="Material" value={mass(t.wastedMaterialKg)} tone={t.wastedMaterialKg > 0 ? "bad" : "ok"}
                hint={<>Measured · plus {mass(t.estWastedMaterialKg)} estimated · weight known on {weighed} of units</>} icon={<MSymbol name="scale" size={20} />} />
              <Stat label="Emissions" value={co2(t.wastedKg)} tone={t.wastedKg > 0 ? "bad" : "ok"}
                hint={<>Measured · plus {co2(t.estWastedKg)} estimated · indicative</>} icon={<MSymbol name="co2" size={20} />} />
              <Stat label="Units" value={int(t.wasted)} tone={t.wasted > 0 ? "bad" : "ok"}
                hint={`Presumed wasted of ${int(t.reconciledOrdered)} ordered on reconciled lines`} icon={<MSymbol name="inventory_2" size={20} />} />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Stat label="Installed of ordered" value={pct(t.utilisation)} tone={t.utilisation == null ? undefined : t.utilisation >= rules.target ? "ok" : "bad"}
              hint={`${t.reconciledLines} reconciled order lines · target ${rules.target}%`} icon={<MSymbol name="storefront" size={20} />} />
            <Stat label="Orders with evidence" value={pct(t.coverage)} tone={t.coverage == null ? undefined : t.coverage >= 80 ? "ok" : t.coverage >= 40 ? "warn" : "bad"}
              hint={`${int(t.trackedUnits)} of ${int(t.ordered)} units have installs or a stock count`} icon={<MSymbol name="fact_check" size={20} />} />
            <Stat label="Over-ordering" value={flagged.length} tone={flagged.length ? "warn" : "ok"}
              hint={`Brand and market combinations under target on ${rules.minOrders} or more orders`} icon={<MSymbol name="flag" size={20} />} />
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
            <Panel className="xl:col-span-3" title="Who to advise" sub={`${flagged.length} brand and market combination${flagged.length === 1 ? "" : "s"} over-ordering`}
              actions={<Link href={`${CO_BASE}/breakdown`} className="text-sm font-semibold text-accent hover:underline">All brands and markets</Link>}>
              {advise.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No brand and market is under the {rules.target}% target.</p> : (
                <ul className="divide-y divide-line">
                  {advise.slice(0, 4).map((g) => (
                    <li key={g.key} className="flex items-start gap-3 px-5 py-3 text-sm">
                      <Pill tone={VERDICT_META[g.verdict].tone}>{VERDICT_META[g.verdict].label}</Pill>
                      <div className="min-w-0">
                        <p>{g.advice}</p>
                        <p className="mt-0.5 text-xs text-muted">Saving: {eur(g.wastedEur)} · {mass(g.wastedMaterialKg)} of material · {co2(g.wastedKg)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Panel title="Saving by product type" sub="Measured plus estimated">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr><th className="th">Product type</th><th className="th text-right">Installed</th><th className="th text-right">Cost</th><th className="th text-right">Material</th><th className="th text-right">Emissions</th></tr></thead>
                <tbody>{byType.map(({ key, totals: x }) => (
                  <tr key={key}>
                    <td className="td font-semibold">{key}</td>
                    <td className="td text-right tabular-nums">{pct(x.utilisation)}</td>
                    <td className="td text-right tabular-nums">{eur(savingEur(x))}</td>
                    <td className="td text-right tabular-nums">{mass(x.wastedMaterialKg + x.estWastedMaterialKg)}</td>
                    <td className="td text-right tabular-nums">{co2(x.wastedKg + x.estWastedKg)}</td>
                  </tr>))}</tbody>
              </table></div>
            </Panel>
            <Panel title="Wasted spend by order month" sub="Reconciled order lines, last 12 months with orders">
              {months.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing reconciled yet.</p> : (
                <Bars rows={months.map((m) => ({ label: monthLabel(m.key), value: m.totals.wastedEur, text: `${eur(m.totals.wastedEur)} · ${pct(m.totals.utilisation)} installed`,
                  tone: m.totals.utilisation != null && m.totals.utilisation < rules.target ? "bg-bad" : "bg-ok" }))} />
              )}
            </Panel>
            <Panel title="Brands with the most to save" sub="Cost, measured plus estimated"><Bars rows={top((l) => l.brand)} /></Panel>
            <Panel title="Markets with the most to save" sub="Cost, measured plus estimated"><Bars rows={top((l) => l.market)} /></Panel>
          </section>

          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-bold">How the figures are worked out</h2>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li><span className="text-fg">Saving opportunity:</span> the cost, material and emissions in units presumed wasted. It is what ordering to actual use would have avoided, not money already saved.</li>
              <li><span className="text-fg">Measured:</span> orders with installs recorded in Execution or a stock count. Surplus = delivered − installed; stock on hand explains part of it, the rest is unaccounted for.</li>
              <li><span className="text-fg">Estimated:</span> orders with no evidence. Spend × the surplus rate measured on tracked orders of the same product type
                ({rates.measured ? `${pct(rates.overall, 1)} overall today` : `${rules.defaultRate}% default until ${rules.minOrders} orders are reconciled`}). Always shown separately.</li>
              <li><span className="text-fg">Material:</span> wasted units × the spec&apos;s unit weight. Specs with no weight add nothing, so the figure is a floor.</li>
              <li><span className="text-fg">Emissions:</span> the spec&apos;s own footprint where it has one, otherwise spend × a spend-based factor. Indicative, not a product carbon footprint.</li>
              <li><span className="text-fg">Money:</span> order cost converted to EUR at the Watchtower reporting rates.</li>
            </ul>
            <p className="text-xs">
              <Link className="font-semibold text-accent hover:underline" href="/sustainability/watchtower/libraries/conscious_ordering_rules">Rules</Link>{" · "}
              <Link className="font-semibold text-accent hover:underline" href="/sustainability/watchtower/libraries/spend_emission_factors">Spend-based emission factors</Link>{" · "}
              <Link className="font-semibold text-accent hover:underline" href="/execution/deployments">Installs in Execution</Link>
            </p>
          </Card>
        </>
      )}
    </>
  );
}
