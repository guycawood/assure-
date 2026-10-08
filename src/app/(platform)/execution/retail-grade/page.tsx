import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAudits, getCriteria, getDeployments, getOutlets, getTickets } from "@/lib/execution-data";
import { grade, gradeBy, retailMetrics } from "@/lib/execution";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { AUDIT_STATUS } from "@/lib/execution";

export const metadata: Metadata = { title: "Retail Grade" };

type Sp = { by?: string; region?: string; market?: string };

export default async function RetailGradePage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [allDeps, tickets, outlets, audits, criteria] = await Promise.all([getDeployments(supabase), getTickets(supabase), getOutlets(supabase), getAudits(supabase), getCriteria(supabase)]);
  const deps = allDeps.filter((d) => (!sp.region || d.region === sp.region) && (!sp.market || d.market === sp.market));
  const scopedOutlets = outlets.filter((o) => (!sp.region || o.region === sp.region) && (!sp.market || o.market === sp.market));
  const m = retailMetrics(deps, tickets, scopedOutlets.length);
  const by = sp.by ?? "outlet";
  const keyFn = by === "market" ? (d: (typeof deps)[number]) => `${d.market} (${d.region})` : by === "region" ? (d: (typeof deps)[number]) => d.region
    : by === "campaign" ? (d: (typeof deps)[number]) => d.campaign_name ?? "No campaign" : by === "supplier" ? (d: (typeof deps)[number]) => d.supplier_name : (d: (typeof deps)[number]) => d.outlet_name;
  const rowsBy = gradeBy(deps, keyFn);
  // Per-criterion average across the latest audit of each deployment.
  const latest = new Map<string, (typeof audits)[number]>();
  for (const a of audits) if (!latest.has(a.deployment_id) && deps.some((d) => d.id === a.deployment_id)) latest.set(a.deployment_id, a);
  const perCriterion = criteria.map((c) => {
    const vals = [...latest.values()].map((a) => a.scores.find((s) => s.code === c.code)?.score).filter((x): x is number => x != null);
    return { ...c, avg: vals.length ? Math.round((10 * vals.reduce((s, v) => s + Number(v), 0)) / vals.length) / 10 : null };
  });
  const regions = [...new Set(allDeps.map((d) => d.region))].sort();
  const markets = [...new Set(allDeps.map((d) => d.market))].sort();
  const pctOr = (v: number | null) => (v == null ? "—" : `${v}%`);

  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Retail Grade" }]} title="Retail Grade"
        sub="How well displays are executed in store: audit scores against the governed display criteria, by outlet, market, campaign or supplier, with the in-store measures from Retail+ alongside." />
      <form method="get" className="flex flex-wrap gap-2">
        <select name="by" defaultValue={by} className="input w-auto" aria-label="Group by">{["outlet", "market", "region", "campaign", "supplier"].map((x) => <option key={x} value={x}>By {x}</option>)}</select>
        <select name="region" defaultValue={sp.region ?? ""} className="input w-auto" aria-label="Region"><option value="">All regions</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>
        <select name="market" defaultValue={sp.market ?? ""} className="input w-auto" aria-label="Market"><option value="">All markets</option>{markets.map((x) => <option key={x}>{x}</option>)}</select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Activation score" value={pctOr(m.avgScore)} hint={`Grade ${grade(m.avgScore).letter} · average audit score`} icon={<MSymbol name="grade" />} />
        <Stat label="Audit pass rate" value={pctOr(m.auditPassRate)} hint={`${m.audited} audited`} icon={<MSymbol name="fact_check" />} />
        <Stat label="Installed on time" value={pctOr(m.onTimeInstallPercent)} hint={`${m.onTimeBasis} installs with a planned date`} icon={<MSymbol name="schedule" />} />
        <Stat label="Store coverage" value={pctOr(m.coveragePercent)} hint={`${m.outletsCovered} of ${scopedOutlets.length} outlets with a deployment`} icon={<MSymbol name="storefront" />} />
        <Stat label="Defect / rework rate" value={pctOr(m.defectRate)} hint="Installs with an installation, material or design ticket" icon={<MSymbol name="build" />} />
        <Stat label="GPS flags" value={m.gpsFlags} tone={m.gpsFlags ? "warn" : "ok"} hint="Installs recorded too far from the outlet" icon={<MSymbol name="location_off" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0 overflow-x-auto xl:col-span-2">
          <table className="w-full text-sm">
            <thead><tr><Th className="capitalize">{by}</Th><Th>Deployments</Th><Th>Audited</Th><Th>Average score</Th><Th>Pass rate</Th></tr></thead>
            <tbody>{rowsBy.map((r) => { const g = grade(r.avgScore); return (
              <tr key={r.key}><Td className="font-semibold">{r.key}</Td><Td className="tabular-nums">{r.deployments}</Td><Td className="tabular-nums">{r.audited}</Td>
                <Td>{r.avgScore != null ? <Pill tone={g.tone}>{g.letter} · {r.avgScore}%</Pill> : "—"}</Td><Td>{pctOr(r.passRate)}</Td></tr>); })}</tbody>
          </table>
        </Card>
        <Panel title="By criterion" sub="Average of the latest audit per deployment">
          <ul className="divide-y divide-line text-sm">
            {perCriterion.map((c) => (
              <li key={c.code} className="px-5 py-2.5">
                <div className="flex justify-between gap-2"><span>{c.name} <span className="text-xs text-muted">({c.weight}%)</span></span><span className="tabular-nums">{c.avg ?? "—"}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${c.avg ?? 0}%` }} /></div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Latest audits">
        {audits.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No audits yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Date</Th><Th>Deployment</Th><Th>Outlet</Th><Th>Campaign</Th><Th>Supplier</Th><Th>Score</Th><Th>Result</Th></tr></thead>
            <tbody>{audits.filter((a) => (!sp.region || a.region === sp.region) && (!sp.market || a.market === sp.market)).slice(0, 25).map((a) => (
              <tr key={a.id}><Td>{fmtDate(a.audited_at)}</Td><Td><Link className="hover:underline" href={`/execution/deployments/${a.deployment_id}`}>{a.deployment_code}</Link></Td>
                <Td>{a.outlet_name}<div className="text-xs text-muted">{a.market}</div></Td><Td>{a.campaign_name ?? "—"}</Td><Td>{a.supplier_name}</Td>
                <Td className="tabular-nums">{a.total_score}%</Td><Td><StatusPill meta={AUDIT_STATUS} value={a.result} /></Td></tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
