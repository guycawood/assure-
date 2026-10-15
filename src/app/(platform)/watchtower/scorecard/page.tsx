import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getScorecard, getScorecardClients, getScorecardOptions } from "@/lib/scorecard-reporting-data";
import { toFilters, type ScorecardParams } from "@/lib/scorecard-reporting";
import { isUuid } from "@/lib/client-portal";
import { PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ScorecardView } from "@/components/scorecard/scorecard-view";

export const metadata: Metadata = { title: "Balanced scorecard" };


// Internal reporting: the balanced scorecard across every client (or one, with the client filter).
export default async function WatchtowerScorecard({ searchParams }: { searchParams: Promise<ScorecardParams> }) {
  await requireInternal();
  const params = await searchParams;
  const client = isUuid(params.client) ? params.client! : null;
  const supabase = await createClient();
  const [report, options, clients] = await Promise.all([
    getScorecard(supabase, client, toFilters(params)),
    getScorecardOptions(supabase, client),
    getScorecardClients(supabase),
  ]);
  const name = client ? clients.find((c) => c.id === client)?.name : null;
  // Same rule as the Watchtower health metric (watchtower_health_scorecard), for this selection.
  const off = report ? report.kpis.filter((k) => k.status === "off_target").length : null;
  return (
    <>
      <PageHead title="Balanced scorecard" crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Reporting", href: "/watchtower/reporting" }, { label: "Balanced scorecard" }]}
        sub="Plan, design, buy and manage better: one set of KPIs from one reporting model, cut the same way on every page. The same scorecard is in CRM per client and in the Client Portal." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="KPIs off target" value={off ?? "—"} tone={off == null ? undefined : off === 0 ? "ok" : off <= 3 ? "warn" : "bad"} hint="For this selection" icon={<MSymbol name="flag" size={20} />} />
        <Stat label="KPIs measured" value={report ? report.kpis.filter((k) => k.status === "on_target" || k.status === "off_target").length : "—"}
          hint={report ? `${report.kpis.filter((k) => k.status === "not_measured").length} not yet measured` : undefined} icon={<MSymbol name="rule" size={20} />} />
        <Stat label="Order lines" value={report?.totals.lines ?? "—"} hint={name ? name : "All clients"} icon={<MSymbol name="receipt_long" size={20} />} />
        <Stat label="KPI library" value={<Link href="/watchtower/libraries/scorecard_kpis" className="hover:underline">Open</Link>}
          hint={<><Link className="text-accent hover:underline" href="/watchtower/libraries/scorecard_targets">Targets</Link> · <Link className="text-accent hover:underline" href="/watchtower/libraries/reporting_fx_rates">Exchange rates</Link></>}
          icon={<MSymbol name="library_books" size={20} />} />
      </section>
      <ScorecardView report={report} params={params} base="/watchtower/scorecard" options={options} clients={clients}
        scopeNote={name ? `Showing ${name} only.` : "Showing every client account."} />
    </>
  );
}
