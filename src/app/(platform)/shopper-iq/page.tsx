import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAssets, getEffectiveness } from "@/lib/shopper-iq-data";
import { avgScore, fmtMoney, groupBy, totalSpend, type EffectivenessRow } from "@/lib/shopper-iq";
import { ButtonLink, PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BarList } from "@/components/shopper-iq/bar-list";

export const metadata: Metadata = { title: "Shopper IQ" };

const DIMS: Record<string, { label: string; key: (r: EffectivenessRow) => string | null; name?: (r: EffectivenessRow) => string }> = {
  campaign: { label: "Campaign", key: (r) => r.campaign_id, name: (r) => r.campaign_name },
  stage: { label: "Path-to-purchase stage", key: (r) => r.p2p_stage_name },
  channel: { label: "Channel", key: (r) => r.channel },
  touchpoint: { label: "Touchpoint", key: (r) => r.touchpoint_id, name: (r) => r.touchpoint_name },
  market: { label: "Market", key: (r) => r.market, name: (r) => `${r.market} · ${r.region}` },
  region: { label: "Region", key: (r) => r.region },
};

export default async function ShopperIqDashboard({ searchParams }: { searchParams: Promise<{ region?: string; client?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, assets] = await Promise.all([getEffectiveness(supabase), getAssets(supabase)]);
  const rows = all.filter((r) => (!sp.region || r.region === sp.region) && (!sp.client || r.client === sp.client));
  const score = avgScore(rows);
  const measured = rows.filter((r) => r.uplift_pct != null && r.uplift_source !== "not_measured").length;
  const regions = [...new Set(all.map((r) => r.region))].sort();
  const clients = [...new Set(all.map((r) => r.client).filter(Boolean) as string[])].sort();
  const g = (k: string) => groupBy(rows, DIMS[k].key, DIMS[k].name);
  const filterLink = (q: Record<string, string | undefined>) => "/shopper-iq?" + new URLSearchParams(Object.entries({ ...sp, ...q }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHead title="Shopper IQ" sub="What we spent, how well it was executed in store, and what it did, by campaign, path-to-purchase stage, channel, touchpoint and market.">
        <ButtonLink href="/shopper-iq/campaigns"><MSymbol name="campaign" size={18} /> Campaign performance</ButtonLink>
        <ButtonLink href="/shopper-iq/insights" variant="primary"><MSymbol name="tips_and_updates" size={18} /> Insights for briefing</ButtonLink>
      </PageHead>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="eyebrow">Region</span>
        <Link href={filterLink({ region: undefined })} className={!sp.region ? "font-bold text-accent" : "text-muted hover:text-fg"}>All</Link>
        {regions.map((r) => <Link key={r} href={filterLink({ region: r })} className={sp.region === r ? "font-bold text-accent" : "text-muted hover:text-fg"}>{r}</Link>)}
        <span className="eyebrow ml-4">Client</span>
        <Link href={filterLink({ client: undefined })} className={!sp.client ? "font-bold text-accent" : "text-muted hover:text-fg"}>All</Link>
        {clients.map((c) => <Link key={c} href={filterLink({ client: c })} className={sp.client === c ? "font-bold text-accent" : "text-muted hover:text-fg"}>{c}</Link>)}
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Recorded spend" value={fmtMoney(totalSpend(rows))} hint={`${rows.length} campaign × market × touchpoint records`} />
        <Stat label="Avg execution score" value={score == null ? "—" : Math.round(score)} hint="In-store assessment, 0–100" tone={score == null ? undefined : score >= 75 ? "ok" : score >= 60 ? "warn" : "bad"} />
        <Stat label="Uplift measured" value={`${measured} of ${rows.length}`} hint="Only shown where a source is named" />
        <Stat label="Assets in library" value={assets.length} hint={<Link href="/shopper-iq/assets" className="text-accent hover:underline">Open the asset library</Link>} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <BarList title="By campaign" groups={g("campaign")} />
        <BarList title="By path-to-purchase stage" groups={g("stage")} />
        <BarList title="By touchpoint" groups={g("touchpoint")} />
        <BarList title="By channel" groups={g("channel")} />
        <BarList title="By market" sub="Region and market kept separate" groups={g("market")} limit={12} />
        <BarList title="By region" groups={g("region")} />
      </section>
      <p className="text-xs text-muted">Spend is shown in EUR as recorded. Uplift needs data from outside the platform (retailer, panel or client figures) and is averaged only over records with a named source.</p>
    </>
  );
}
