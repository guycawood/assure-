import type { Metadata } from "next";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { CAMPAIGN_STATUS, fmtDate, type Campaign } from "@/lib/client-portal";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { PreviewBanner } from "@/components/client/bits";

export const metadata: Metadata = { title: "Campaigns" };

export default async function ClientCampaigns({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const campaigns = (await rpc<Campaign[]>(ctx.supabase, "client_portal_campaigns", scope(ctx))) ?? [];
  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Campaigns" sub="Campaigns adm Indicia is running for you, with the markets they cover." />
      {campaigns.length === 0 ? <Card><Empty title="No campaigns yet" /></Card> : (
        <section className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((c) => {
            const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.planning;
            return (
              <Card key={c.id} className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="eyebrow">{c.campaign_code}</p>
                    <h2 className="font-display text-lg font-bold leading-tight">{c.name}</h2>
                  </div>
                  <Pill tone={st.tone}>{st.label}</Pill>
                </div>
                {c.objective && <p className="text-sm text-muted">{c.objective}</p>}
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="eyebrow">Dates</dt><dd>{c.start_date ? `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` : "To be confirmed"}</dd></div>
                  <div><dt className="eyebrow">Markets</dt><dd>{c.markets.length ? c.markets.join(", ") : "—"}</dd></div>
                  <div><dt className="eyebrow">Briefs</dt><dd>{c.brief_count}</dd></div>
                </dl>
                {c.brands.length > 0 && <div className="flex flex-wrap gap-1.5">{c.brands.map((b) => <Pill key={b} tone="info">{b}</Pill>)}</div>}
              </Card>
            );
          })}
        </section>
      )}
    </>
  );
}
