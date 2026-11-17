import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderLines, getRules } from "@/lib/conscious-ordering-data";
import { co2, eur, groups, int, mass, pct, VERDICT_META } from "@/lib/conscious-ordering";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { Tabs, Td, Th } from "@/components/sourcing/bits";
import { CO_BASE, ConsciousNav } from "../sub-nav";

export const metadata: Metadata = { title: "Conscious ordering by brand and market" };

const VIEWS = [
  { key: "brand_market", label: "Brand and market" },
  { key: "brand", label: "Brand" },
  { key: "market", label: "Market" },
] as const;
type View = (typeof VIEWS)[number]["key"];

// Every brand and market with its verdict, and the cost, material and emissions it could save.
export default async function ConsciousOrderingBreakdown({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.tab) ? (sp.tab as View) : "brand_market";
  const supabase = await createClient();
  const [lines, rules] = await Promise.all([getOrderLines(supabase), getRules(supabase)]);
  const rollup = groups(lines, rules, view);

  return (
    <>
      <PageHead crumbs={[{ label: "Sustainability", href: "/sustainability" }, { label: "Conscious ordering", href: CO_BASE }, { label: "Brands and markets" }]}
        title="Brands and markets" sub={`Who installs what they order. Over-ordering = under ${rules.target}% installed on ${rules.minOrders} or more reconciled orders. Hover a verdict for the advice.`} />
      <ConsciousNav current="breakdown" />
      {rollup.length === 0 ? <Card><Empty title="No issued purchase orders yet" /></Card> : (
        <Card className="min-w-0">
          <div className="px-5 pt-3"><Tabs base={`${CO_BASE}/breakdown`} current={view} tabs={VIEWS.map((v) => ({ key: v.key, label: v.label }))} /></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                {view !== "market" && <Th>Brand</Th>}{view !== "brand" && <Th>Market</Th>}
                <Th>Verdict</Th><Th className="text-right">Order lines</Th><Th className="text-right">Ordered</Th><Th className="text-right">Evidence</Th>
                <Th className="text-right">Installed</Th><Th className="text-right">Units wasted</Th><Th className="text-right">Cost</Th><Th className="text-right">Material</Th>
                <Th className="text-right">Emissions</Th><Th className="text-right">Estimated cost (untracked)</Th>
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
                  <Td className="whitespace-nowrap text-right tabular-nums">{g.reconciledLines ? mass(g.wastedMaterialKg) : "—"}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{g.reconciledLines ? co2(g.wastedKg) : "—"}</Td>
                  <Td className="text-right tabular-nums text-muted">{g.untrackedLines ? eur(g.estWastedEur) : "—"}</Td>
                </tr>))}</tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-2 text-[0.7rem] text-muted">
            Evidence = share of ordered units with installs or a stock count. Installed = installed ÷ ordered on reconciled lines. Cost, material and emissions are measured, from reconciled lines; the last column is the spend-based estimate for untracked orders.
          </p>
        </Card>
      )}
    </>
  );
}
