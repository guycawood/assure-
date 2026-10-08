import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows } from "@/lib/assure-data";
import { avg, SCORE_KEYS, SUPPLIER_TIER, type PerformanceIssue, type PerformanceRecord } from "@/lib/assure";
import { CLIENTS, formatEur, REGIONS } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, Panel, Stat } from "@/components/ui";
import { Chips, OptPill, Score } from "@/components/assure/bits";
import { ActionForm } from "@/components/assure/action-form";
import { IssueList } from "../suppliers/[id]/tabs";
import { generateIssues } from "../srm-actions";

export const metadata: Metadata = { title: "Performance" };

type SP = Promise<{ region?: string; client?: string; sort?: string; issues?: string }>;

export default async function PerformancePage({ searchParams }: { searchParams: SP }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [suppliers, perf, issues] = await Promise.all([
    getSuppliers(supabase),
    rows<PerformanceRecord>(supabase, "performance_records"),
    rows<PerformanceIssue>(supabase, "performance_issues", { order: "created_at" }),
  ]);
  const byS = new Map<string, PerformanceRecord[]>();
  for (const r of perf) byS.set(r.supplier_id, [...(byS.get(r.supplier_id) ?? []), r]);
  for (const l of byS.values()) l.sort((a, b) => b.period.localeCompare(a.period));
  const ranked = suppliers
    .filter((s) => (!sp.region || s.region === sp.region) && (!sp.client || s.client === sp.client))
    .map((s) => ({ s, latest: byS.get(s.id)?.[0], prev: byS.get(s.id)?.[1] }))
    .filter((x) => x.latest)
    .sort((a, b) => sp.sort === "score_asc" ? Number(a.latest!.composite_score ?? 0) - Number(b.latest!.composite_score ?? 0)
      : sp.sort === "spend_desc" ? Number(b.s.ytd_spend) - Number(a.s.ytd_spend) : Number(b.latest!.composite_score ?? 0) - Number(a.latest!.composite_score ?? 0));
  const scores = ranked.map((x) => x.latest!.composite_score);
  const prevAvg = avg(ranked.map((x) => x.prev?.composite_score));
  const curAvg = avg(scores);
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const openIssues = issues.filter((i) => i.acknowledgement_status !== "resolved");
  const shownIssues = sp.issues === "all" ? issues : openIssues;
  const keep = { region: sp.region, client: sp.client, sort: sp.sort, issues: sp.issues };

  return (
    <>
      <PageHead title="Supplier performance" sub="Ranked by the latest quarter's composite score (average of cost, OTIF, quality, compliance and sustainability, 0-100)."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Performance" }]}>
        <ButtonLink href="/assure/performance/report">Compliance & sustainability report</ButtonLink>
        <ButtonLink href="/assure/scorecard">Scorecard & PSL</ButtonLink>
      </PageHead>
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Average score" value={curAvg ?? "—"} hint={curAvg !== null && prevAvg !== null ? `${curAvg - prevAvg >= 0 ? "+" : ""}${Math.round((curAvg - prevAvg) * 10) / 10} on the previous quarter` : "Needs two quarters to compare"} />
        <Stat label="Top performers" value={scores.filter((x) => Number(x) >= 80).length} hint="Score 80 or more" tone="ok" />
        <Stat label="Below threshold" value={scores.filter((x) => Number(x) < 50).length} hint="Score under 50" tone="bad" />
        <Stat label="Open issues" value={openIssues.length} tone={openIssues.length ? "warn" : "ok"} />
      </section>
      <div className="flex flex-col gap-2">
        <Chips label="Region:" param="region" options={REGIONS.map((r) => ({ value: r, label: r }))} active={sp.region} keep={keep} />
        <Chips label="Client:" param="client" options={CLIENTS.map((r) => ({ value: r, label: r }))} active={sp.client} keep={keep} />
        <Chips label="Sort:" param="sort" options={[{ value: "score_asc", label: "Lowest score first" }, { value: "spend_desc", label: "Highest spend first" }]} active={sp.sort} keep={keep} />
      </div>
      <Card className="overflow-x-auto">
        {ranked.length === 0 ? <Empty title="No performance scores yet">Record scores on a supplier&apos;s Performance tab.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">#</th><th className="th">Supplier</th><th className="th">Region · market</th><th className="th">Tier</th><th className="th">Period</th>
              {SCORE_KEYS.map(([, l]) => <th key={l} className="th text-right">{l}</th>)}<th className="th text-right">Composite</th><th className="th text-right">Change</th><th className="th text-right">YTD spend</th></tr></thead>
            <tbody>
              {ranked.map(({ s, latest, prev }, i) => {
                const d = latest!.composite_score != null && prev?.composite_score != null ? Number(latest!.composite_score) - Number(prev.composite_score) : null;
                return (
                  <tr key={s.id}>
                    <td className="td tabular-nums text-muted">{i + 1}</td>
                    <td className="td"><Link href={`/assure/suppliers/${s.id}?tab=performance`} className="font-semibold hover:text-accent">{s.name}</Link><div className="text-xs text-muted">{s.category}</div></td>
                    <td className="td whitespace-nowrap">{[s.region, s.market].filter(Boolean).join(" · ")}</td>
                    <td className="td"><OptPill list={SUPPLIER_TIER} value={s.tier} /></td>
                    <td className="td">{latest!.period}</td>
                    {SCORE_KEYS.map(([k]) => <td key={k} className="td text-right"><Score value={latest![k] as number | null} /></td>)}
                    <td className="td text-right font-display text-base font-bold"><Score value={latest!.composite_score} /></td>
                    <td className={`td text-right tabular-nums ${d === null ? "text-muted" : d >= 0 ? "text-ok" : "text-bad"}`}>{d === null ? "—" : `${d >= 0 ? "+" : ""}${Math.round(d * 10) / 10}`}</td>
                    <td className="td text-right tabular-nums">{formatEur(s.ytd_spend)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Panel title="Issues feed" sub="Raised on the server from each supplier's latest quarter and certificates. Vendors respond in their portal; you resolve here."
        actions={<>
          <Chips param="issues" options={[{ value: "all", label: "Include resolved" }]} active={sp.issues} keep={keep} />
          <ActionForm action={generateIssues} submit="Check all suppliers" variant="secondary" inline />
        </>}>
        <IssueList issues={shownIssues} names={names} />
      </Panel>
    </>
  );
}
