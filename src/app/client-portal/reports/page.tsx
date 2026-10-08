import type { Metadata } from "next";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { fmtDate, fmtMoney, monthLabel, type EffectivenessRow, type Report } from "@/lib/client-portal";
import { Card, Empty, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Bar, PreviewBanner } from "@/components/client/bits";

export const metadata: Metadata = { title: "Reports" };

const SOURCE: Record<string, string> = { not_measured: "Not measured", client_reported: "Your data", retailer_data: "Retailer data", panel_data: "Panel data" };

// External Reporting for clients: spend and savings at the price you pay, sustainability and effectiveness, your accounts only.
export default async function ClientReports({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const [report, eff] = await Promise.all([
    rpc<Report>(ctx.supabase, "client_portal_report", scope(ctx)),
    rpc<EffectivenessRow[]>(ctx.supabase, "client_portal_effectiveness", scope(ctx)),
  ]);
  const r: Report = report ?? { by_month: [], by_market: [], sustainability: { specs: 0, specs_with_co2e: 0, co2e_kg: 0, units: 0, by_market: [] }, effectiveness: [] };

  // Charts use the currency with the most spend; other currencies are listed under it.
  const totals = new Map<string, { spend: number; savings: number }>();
  for (const m of r.by_market) {
    const t = totals.get(m.currency) ?? { spend: 0, savings: 0 };
    totals.set(m.currency, { spend: t.spend + Number(m.spend), savings: t.savings + Number(m.savings) });
  }
  const currencies = [...totals.entries()].sort((a, b) => b[1].spend - a[1].spend);
  const cur = currencies[0]?.[0] ?? ctx.accounts[0]?.currency ?? "EUR";
  const months = r.by_month.filter((m) => m.currency === cur);
  const markets = r.by_market.filter((m) => m.currency === cur);
  const maxMonth = Math.max(0, ...months.map((m) => Number(m.spend)));
  const maxMarket = Math.max(0, ...markets.map((m) => Number(m.spend)));
  const total = totals.get(cur) ?? { spend: 0, savings: 0 };
  const sus = r.sustainability;
  const maxCo2 = Math.max(0, ...sus.by_market.map((m) => Number(m.co2e_kg)));

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Reports" sub="Spend and savings at the price you pay, the carbon footprint of what we made for you, and how your in-store activity performed." />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Approved spend" value={fmtMoney(total.spend, cur)} hint={currencies.length > 1 ? `Plus ${currencies.slice(1).map(([c, t]) => fmtMoney(t.spend, c)).join(", ")}` : "All approved estimates"} icon={<MSymbol name="payments" />} />
        <Stat label="Savings reported" value={fmtMoney(total.savings, cur)} tone={total.savings > 0 ? "ok" : undefined} hint="Against benchmark prices" icon={<MSymbol name="savings" />} />
        <Stat label="Carbon footprint" value={`${Number(sus.co2e_kg).toLocaleString("en-GB")} kg`} hint={`CO2e for ${sus.specs_with_co2e} of ${sus.specs} items`} icon={<MSymbol name="eco" />} />
        <Stat label="Units produced" value={Number(sus.units).toLocaleString("en-GB")} icon={<MSymbol name="inventory_2" />} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Spend by month" sub={`Last 12 months, ${cur}, by approval date`}>
          {months.length === 0 ? <Empty title="No approved spend yet" /> : (
            <div className="space-y-2.5 px-5 py-4">
              {months.map((m) => (
                <Bar key={m.month} label={monthLabel(m.month)} value={Number(m.spend)} max={maxMonth} display={fmtMoney(m.spend, cur)}
                  sub={Number(m.savings) > 0 ? `saved ${fmtMoney(m.savings, cur)}` : undefined} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Spend by market" sub={`All approved estimates, ${cur}`}>
          {markets.length === 0 ? <Empty title="No approved spend yet" /> : (
            <div className="space-y-2.5 px-5 py-4">
              {markets.map((m) => (
                <Bar key={`${m.region}-${m.market}`} label={m.market} value={Number(m.spend)} max={maxMarket} display={fmtMoney(m.spend, cur)}
                  sub={Number(m.savings) > 0 ? `saved ${fmtMoney(m.savings, cur)}` : undefined} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Sustainability" sub="Spec CO2e (materials and production) for items on approved estimates">
          {sus.by_market.length === 0 ? <Empty title="No carbon figures yet">Figures appear once item weights and materials are confirmed.</Empty> : (
            <div className="space-y-2.5 px-5 py-4">
              {sus.by_market.map((m) => (
                <Bar key={m.market} label={m.market} value={Number(m.co2e_kg)} max={maxCo2} tone="ok" display={`${Number(m.co2e_kg).toLocaleString("en-GB")} kg`} sub={`${m.specs} item${m.specs === 1 ? "" : "s"}`} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Effectiveness by touchpoint" sub="Average in-store execution score (0 to 100), from Shopper IQ">
          {r.effectiveness.length === 0 ? <Empty title="No effectiveness data yet" /> : (
            <div className="space-y-2.5 px-5 py-4">
              {r.effectiveness.map((e) => (
                <Bar key={e.touchpoint} label={e.touchpoint} value={Number(e.avg_execution ?? 0)} max={100} tone="info"
                  display={e.avg_execution == null ? "—" : String(e.avg_execution)}
                  sub={e.avg_uplift != null ? `uplift ${e.avg_uplift}%` : undefined} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Effectiveness detail" sub="Uplift is only shown where it was measured, with its source">
        {(eff ?? []).length === 0 ? <Empty title="No effectiveness data yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Campaign", "Market", "Touchpoint", "Period", "Execution", "Uplift", "Source"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {(eff ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="td">{e.campaign_name}</td>
                    <td className="td">{e.market}</td>
                    <td className="td">{e.touchpoint}{e.p2p_stage && <div className="text-xs text-muted">{e.p2p_stage}</div>}</td>
                    <td className="td whitespace-nowrap text-xs">{e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)}` : "—"}</td>
                    <td className="td tabular-nums">{e.execution_score ?? "—"}</td>
                    <td className="td tabular-nums">{e.uplift_pct != null ? `${e.uplift_pct}%` : "—"}</td>
                    <td className="td text-xs text-muted">{SOURCE[e.uplift_source] ?? e.uplift_source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Card className="px-5 py-3 text-xs text-muted">Every figure here covers only your own accounts. Prices are what you pay; savings compare the price we secured with benchmark prices for the same items.</Card>
    </>
  );
}
