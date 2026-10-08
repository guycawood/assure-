import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCampaigns, getLibrary } from "@/lib/briefing-data";
import { getEffectiveness } from "@/lib/shopper-iq-data";
import { avgScore, fmtMoney, fmtPct, groupBy, totalSpend, UPLIFT_SOURCES } from "@/lib/shopper-iq";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { EffectivenessForm } from "@/components/shopper-iq/forms";
import { recordEffectiveness } from "../actions";

export const metadata: Metadata = { title: "Campaign performance" };

export default async function CampaignPerformance({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  await requireInternal();
  const { campaign } = await searchParams;
  const supabase = await createClient();
  const [all, campaigns, touchpoints, stages] = await Promise.all([getEffectiveness(supabase), getCampaigns(supabase), getLibrary(supabase, "touchpoint_types"), getLibrary(supabase, "p2p_stages")]);
  const rows = campaign ? all.filter((r) => r.campaign_id === campaign) : all;
  const byCampaign = groupBy(all, (r) => r.campaign_id, (r) => r.campaign_name);
  const sel = campaigns.find((c) => c.id === campaign);

  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Campaign performance" }]} title={sel ? sel.name : "Campaign performance"}
        sub="Every record is one campaign × market × touchpoint: what it cost, how well it was executed in store, and any measured uplift with its source." />
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {byCampaign.map((g) => (
          <Link key={g.key} href={`/shopper-iq/campaigns?campaign=${g.key}`}>
            <Card className={`h-full p-4 transition hover:border-[#EE4E62] ${g.key === campaign ? "border-[#EE4E62]" : ""}`}>
              <p className="font-bold">{g.label}</p>
              <p className="mt-1 text-sm">{fmtMoney(g.spend)} <span className="text-muted">· {g.rows} records</span></p>
              <p className="text-xs text-muted">Execution {g.avgScore == null ? "—" : Math.round(g.avgScore)} · uplift {fmtPct(g.avgUplift)}</p>
            </Card>
          </Link>
        ))}
      </section>
      {campaign && <p className="text-sm"><Link href="/shopper-iq/campaigns" className="font-semibold text-accent hover:underline">Show all campaigns</Link> · <Link href={`/briefing/campaigns/${campaign}`} className="font-semibold text-accent hover:underline">Campaign set-up in Briefing+</Link></p>}

      <Panel title="Records" sub={`${rows.length} records · ${fmtMoney(totalSpend(rows))} · avg execution ${avgScore(rows) == null ? "—" : Math.round(avgScore(rows)!)}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Campaign</th><th className="th">Market</th><th className="th">Touchpoint</th><th className="th">Stage · channel</th><th className="th">Spend</th><th className="th">Execution</th><th className="th">Uplift</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td">{r.campaign_name}<p className="text-xs text-muted">{r.client}</p></td>
                  <td className="td whitespace-nowrap">{r.market} <span className="text-xs text-muted">{r.region}</span></td>
                  <td className="td">{r.touchpoint_name}</td>
                  <td className="td text-xs">{r.p2p_stage_name ?? "—"}<p className="text-muted">{r.channel ?? ""}</p></td>
                  <td className="td tabular-nums">{fmtMoney(r.spend, r.currency)}</td>
                  <td className="td tabular-nums">{r.execution_score == null ? "—" : <Pill tone={r.execution_score >= 75 ? "ok" : r.execution_score >= 60 ? "warn" : "bad"}>{Math.round(r.execution_score)}</Pill>}</td>
                  <td className="td text-xs">{r.uplift_pct == null ? <span className="text-muted">{UPLIFT_SOURCES[r.uplift_source]}</span> : <>{fmtPct(r.uplift_pct)}<p className="text-muted">{UPLIFT_SOURCES[r.uplift_source]}</p></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Record effectiveness" sub="Touchpoint and stage come from the governed Watchtower taxonomy. Uplift must name its source.">
        <EffectivenessForm action={recordEffectiveness} defaultCampaign={campaign}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} touchpoints={touchpoints.map((t) => ({ id: t.id, name: t.name }))} stages={stages.map((t) => ({ id: t.id, name: t.name }))} />
      </Panel>
    </>
  );
}
