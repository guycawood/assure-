import type { Metadata } from "next";
import { portalContext } from "@/lib/client-portal-data";
import { getClientScorecard } from "@/lib/scorecard-reporting-data";
import { toFilters, type ScorecardParams } from "@/lib/scorecard-reporting";
import { Card, PageHead } from "@/components/ui";
import { PreviewBanner } from "@/components/client/bits";
import { ScorecardView } from "@/components/scorecard/scorecard-view";

export const metadata: Metadata = { title: "Scorecard" };

// The client's balanced scorecard: their own accounts only, sell-side spend and savings, no supplier or cost detail.
export default async function ClientScorecard({ searchParams }: { searchParams: Promise<ScorecardParams & { preview?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext(sp);
  const report = await getClientScorecard(ctx.supabase, ctx.preview, toFilters(sp));
  const params: ScorecardParams = { ...sp, client: undefined };
  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Scorecard" sub="How the work we do for you performs: planning, design, buying and service, against the targets we agreed with you." />
      <ScorecardView report={report} params={params} base="/client-portal/scorecard" keep={{ preview: ctx.preview }} options={report?.options ?? null}
        scopeNote={`Covers ${ctx.accounts.map((a) => a.name).join(", ") || "your accounts"} only. Spend and savings are at the price you pay.`} />
      <Card className="px-5 py-3 text-xs text-muted">Savings compare the price we secured with the benchmark, reference or previous price for the same items. Supplier ratings are an average across the suppliers used; supplier names and costs are not shown here.</Card>
    </>
  );
}
