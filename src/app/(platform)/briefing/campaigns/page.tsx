import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCampaigns } from "@/lib/briefing-data";
import { ACTIVATION_OBJECTIVES, CAMPAIGN_STATUS, CAMPAIGN_TYPES, optLabel } from "@/lib/briefing";
import { formatDate } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Campaigns" };

export default async function Campaigns() {
  await requireInternal();
  const supabase = await createClient();
  const campaigns = await getCampaigns(supabase);
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "Campaigns" }]} title="Campaigns"
        sub="Set up centrally: client, brands, objective, channels, path-to-purchase stages and the markets it runs in. Briefs are then written per market.">
        <ButtonLink href="/briefing/campaigns/new" variant="primary"><MSymbol name="add" size={18} /> New campaign</ButtonLink>
      </PageHead>
      <Card className="overflow-x-auto">
        {campaigns.length === 0 ? <Empty title="No campaigns yet">Create the first campaign to group briefs across markets.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Campaign</th><th className="th">Client · brands</th><th className="th">Type</th><th className="th">Markets</th><th className="th">Dates</th><th className="th">Briefs</th><th className="th">Status</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="td"><Link href={`/briefing/campaigns/${c.id}`} className="font-semibold hover:underline">{c.name}</Link><p className="text-xs text-muted">{c.campaign_code}</p></td>
                  <td className="td">{c.client ?? "—"}<p className="text-xs text-muted">{c.brands.join(", ")}</p></td>
                  <td className="td text-xs">{optLabel(CAMPAIGN_TYPES, c.campaign_type) || "—"}<p className="text-muted">{optLabel(ACTIVATION_OBJECTIVES, c.activation_objective)}</p></td>
                  <td className="td text-xs">{(c.markets ?? []).join(", ") || "—"}<p className="text-muted">{(c.regions ?? []).join(", ")}</p></td>
                  <td className="td whitespace-nowrap text-xs text-muted">{formatDate(c.start_date)}{c.end_date ? ` – ${formatDate(c.end_date)}` : ""}</td>
                  <td className="td tabular-nums">{c.brief_count ?? 0}</td>
                  <td className="td"><Pill tone={CAMPAIGN_STATUS[c.status]?.tone}>{CAMPAIGN_STATUS[c.status]?.label ?? c.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
