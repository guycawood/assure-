import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveness } from "@/lib/shopper-iq-data";
import { fmtMoney, groupBy, whatWorked } from "@/lib/shopper-iq";
import { Card, PageHead, Panel } from "@/components/ui";
import { WhatWorkedPanel } from "@/components/shopper-iq/what-worked";

export const metadata: Metadata = { title: "Insights for briefing" };

export default async function Insights({ searchParams }: { searchParams: Promise<{ client?: string; brand?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const rows = await getEffectiveness(supabase);
  const clients = [...new Set(rows.map((r) => r.client).filter(Boolean) as string[])].sort();
  const brands = [...new Set(rows.filter((r) => !sp.client || r.client === sp.client).flatMap((r) => r.brands ?? []))].sort();
  const items = whatWorked(rows, { client: sp.client, brand: sp.brand }, 6);
  // Low performers: high spend, low execution. Worth fixing before the next brief.
  const weak = groupBy(rows.filter((r) => !sp.client || r.client === sp.client), (r) => `${r.campaign_id}:${r.market}:${r.touchpoint_id}`, (r) => `${r.touchpoint_name} · ${r.campaign_name} (${r.market})`)
    .filter((g) => g.avgScore != null && g.avgScore < 65).slice(0, 5);
  const link = (q: Record<string, string | undefined>) => "/shopper-iq/insights?" + new URLSearchParams(Object.entries({ ...sp, ...q }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Insights for briefing" }]} title="Insights for briefing"
        sub="What executed well and what did not, so the next brief starts from evidence. The same panel appears on every brief in Briefing+ and feeds AI ideation." />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="eyebrow">Client</span>
        <Link href={link({ client: undefined, brand: undefined })} className={!sp.client ? "font-bold text-accent" : "text-muted"}>All</Link>
        {clients.map((c) => <Link key={c} href={link({ client: c, brand: undefined })} className={sp.client === c ? "font-bold text-accent" : "text-muted hover:text-fg"}>{c}</Link>)}
        <span className="eyebrow ml-4">Brand</span>
        <Link href={link({ brand: undefined })} className={!sp.brand ? "font-bold text-accent" : "text-muted"}>All</Link>
        {brands.map((b) => <Link key={b} href={link({ brand: b })} className={sp.brand === b ? "font-bold text-accent" : "text-muted hover:text-fg"}>{b}</Link>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <WhatWorkedPanel items={items} brand={sp.brand} client={sp.client} />
        <Panel title="Watch out for" sub="Spend that executed poorly in store (execution score under 65)">
          {weak.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing below the line.</p> : (
            <ul className="divide-y divide-line">
              {weak.map((g) => (
                <li key={g.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>{g.label}</span>
                  <span className="text-right text-xs"><b className="text-bad">{Math.round(g.avgScore!)}</b>/100<br /><span className="text-muted">{fmtMoney(g.spend)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Card className="p-5 text-sm text-muted">
        Execution scores come from in-store assessments. Uplift is only counted where a retailer, panel or client source is named; the platform cannot measure sales on its own.
        Start a brief from these insights in <Link href="/briefing/new" className="font-semibold text-accent hover:underline">Briefing+</Link>.
      </Card>
    </>
  );
}
