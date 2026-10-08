import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBriefs, getCampaign, getCampaignMarkets } from "@/lib/briefing-data";
import { getEffectiveness } from "@/lib/shopper-iq-data";
import { ACTIVATION_OBJECTIVES, CAMPAIGN_STATUS, CAMPAIGN_TYPES, marketName, optLabel } from "@/lib/briefing";
import { avgScore, fmtMoney, totalSpend } from "@/lib/shopper-iq";
import { formatDate } from "@/lib/srt";
import { ButtonLink, Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BriefStatusPill } from "@/components/briefing/labels";
import { CampaignForm } from "@/components/briefing/campaign-form";
import { saveCampaign } from "../../actions";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  await requireInternal();
  const { id } = await params;
  const { edit } = await searchParams;
  const supabase = await createClient();
  const c = await getCampaign(supabase, id);
  if (!c) notFound();
  const [markets, briefs, eff] = await Promise.all([getCampaignMarkets(supabase, id), getBriefs(supabase), getEffectiveness(supabase)]);
  const crumbs = [{ label: "Briefing+", href: "/briefing" }, { label: "Campaigns", href: "/briefing/campaigns" }, { label: c.campaign_code }];

  if (edit) {
    return (
      <>
        <PageHead crumbs={crumbs} title={`Edit: ${c.name}`} />
        <div className="max-w-4xl"><CampaignForm action={saveCampaign.bind(null, id)} campaign={c} markets={markets} cancelHref={`/briefing/campaigns/${id}`} /></div>
      </>
    );
  }
  const mine = briefs.filter((b) => b.campaign_id === id);
  const perf = eff.filter((e) => e.campaign_id === id);
  const score = avgScore(perf);
  const chip = (xs: string[]) => xs.length ? <span className="flex flex-wrap gap-1">{xs.map((x) => <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{x}</span>)}</span> : "—";

  return (
    <>
      <PageHead crumbs={crumbs} title={c.name} sub={c.objective ?? undefined}>
        <ButtonLink href={`/briefing/campaigns/${id}?edit=1`}><MSymbol name="edit" size={17} /> Edit</ButtonLink>
        <ButtonLink href={`/briefing/new?campaign=${id}`} variant="primary"><MSymbol name="add" size={17} /> Brief for a market</ButtonLink>
      </PageHead>
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Markets" value={markets.length} hint={[...new Set(markets.map((m) => m.region))].join(", ")} />
        <Stat label="Briefs" value={mine.length} hint={`${mine.filter((b) => b.status === "in_ideation").length} in ideation`} />
        <Stat label="Recorded spend" value={perf.length ? fmtMoney(totalSpend(perf)) : "—"} hint="Shopper IQ" />
        <Stat label="Avg execution score" value={score == null ? "—" : Math.round(score)} hint="In-store assessments, 0–100" />
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="grid gap-3 p-5 text-sm">
          <div className="flex flex-wrap gap-2"><Pill tone={CAMPAIGN_STATUS[c.status]?.tone}>{CAMPAIGN_STATUS[c.status]?.label}</Pill><span className="text-muted">{c.campaign_code}</span></div>
          <p><span className="eyebrow mr-2">Client</span>{c.client ?? "—"} {c.division ? `· ${c.division}` : ""}</p>
          <p className="flex items-center gap-2"><span className="eyebrow">Brands</span>{chip(c.brands)}</p>
          <p><span className="eyebrow mr-2">Type</span>{optLabel(CAMPAIGN_TYPES, c.campaign_type) || "—"} · {optLabel(ACTIVATION_OBJECTIVES, c.activation_objective) || "—"}{c.brand_tier ? ` · ${c.brand_tier}` : ""}</p>
          <p><span className="eyebrow mr-2">Dates</span>{formatDate(c.start_date) || "—"} – {formatDate(c.end_date) || "—"}</p>
          <p className="flex items-center gap-2"><span className="eyebrow">Channels</span>{chip(c.channels)}</p>
          <p className="flex items-center gap-2"><span className="eyebrow">Store types</span>{chip(c.store_types)}</p>
          <p className="flex items-center gap-2"><span className="eyebrow">P2P stages</span>{chip(c.p2p_stages)}</p>
        </Card>
        <Panel title="Markets" sub="Region and market are kept separate">
          <ul className="divide-y divide-line">
            {markets.map((m) => {
              const b = mine.filter((x) => x.market === m.market);
              return (
                <li key={m.market} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span><b>{marketName(m.market)}</b> <span className="text-xs text-muted">{m.market} · {m.region}</span></span>
                  <span className="text-xs text-muted">{b.length ? `${b.length} brief${b.length === 1 ? "" : "s"}` : <Link href={`/briefing/new?campaign=${id}`} className="font-semibold text-accent hover:underline">Write a brief</Link>}</span>
                </li>
              );
            })}
            {markets.length === 0 && <li className="px-5 py-3 text-sm text-muted">No markets yet. Edit the campaign to add them.</li>}
          </ul>
        </Panel>
      </div>
      <Panel title="Briefs in this campaign" actions={<Link href={`/shopper-iq/campaigns?campaign=${id}`} className="text-xs font-semibold text-accent hover:underline">Performance in Shopper IQ →</Link>}>
        {mine.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No briefs yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Brief</th><th className="th">Market</th><th className="th">Status</th><th className="th">Target launch</th></tr></thead>
            <tbody>{mine.map((b) => (
              <tr key={b.id}>
                <td className="td"><Link href={`/briefing/${b.id}`} className="font-semibold hover:underline">{b.title}</Link><p className="text-xs text-muted">{b.brief_code}</p></td>
                <td className="td">{b.market} <span className="text-xs text-muted">{b.region}</span></td>
                <td className="td"><BriefStatusPill status={b.status} /></td>
                <td className="td text-xs text-muted">{formatDate(b.target_launch) || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
