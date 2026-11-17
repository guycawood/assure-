import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Vendor overview" };

type Overview = {
  region: string | null; can_see_money: boolean;
  pool: { total: number; released: number; by_status: Record<string, number>; by_onboarding: Record<string, number>; by_region: Record<string, number> };
  jobs: { live: number; by_stage: Record<string, number>; overdue_payments: number; top_vendors: { supplier_id: string; name: string; jobs: number; value?: number }[] };
  performance: { scored: number; average: number | null; below_60: number; lowest: { supplier_id: string; name: string; score: number; period: string }[] };
  risk: { open_ncrs: number; critical_ncrs: number; open_issues: number; certs_expired: number; certs_expiring: number; open_esg: number; high_esg: number };
  approvals: { joint_waiting: number; form_changes: number; reviews_next_30_days: number };
  attention: { supplier_id: string; name: string; region: string | null; category: string | null; expired_certs: number; open_ncrs: number; open_issues: number; open_esg: number; overdue_payments: number; score: number | null }[];
};
const human = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const num = (n: number | null | undefined) => (n == null ? "–" : String(n));

function Tile({ label, value, sub, href, tone }: { label: string; value: string | number; sub?: string; href?: string; tone?: "bad" | "warn" }) {
  const body = (
    <Card className="h-full p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

function Bars({ data, total }: { data: Record<string, number>; total: number }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="space-y-2 px-5 py-4 text-sm">
      {rows.length === 0 && <li className="text-muted">Nothing to show.</li>}
      {rows.map(([k, n]) => (
        <li key={k}>
          <div className="flex justify-between"><span>{human(k)}</span><b>{n}</b></div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${total ? Math.max(3, Math.round((n / total) * 100)) : 0}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

// One read of vendor activity across the pool, for the procurement directors.
export default async function VendorOverviewPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  await requireInternal();
  const { region } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("srm_director_overview", { p_region: region || null });
  if (error || !data) {
    return (<><PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "Vendor overview" }]} title="Vendor overview" /><Card className="p-5 text-sm text-muted">{error?.message ?? "No data."}</Card></>);
  }
  const o = data as Overview;
  const all = (await supabase.rpc("srm_director_overview", { p_region: null })).data as Overview | null;
  const regions = Object.keys((all ?? o).pool.by_region).sort();

  return (
    <>
      <PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "Vendor overview" }]} title="Vendor overview"
        sub="Where the vendor pool stands: onboarding, live jobs and payments, performance, risk and approvals waiting. Vendors that need attention first are at the bottom." />
      <nav className="flex flex-wrap gap-2 text-sm">
        <Link href="/assure/overview" className={`rounded-full border px-3 py-1 ${!region ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>All regions</Link>
        {regions.map((r) => <Link key={r} href={`/assure/overview?region=${encodeURIComponent(r)}`} className={`rounded-full border px-3 py-1 ${region === r ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>{r}</Link>)}
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Vendors" value={o.pool.total} sub={`${o.pool.released} released for use`} href="/assure/suppliers" />
        <Tile label="Live jobs" value={o.jobs.live} sub={o.jobs.overdue_payments ? `${o.jobs.overdue_payments} payments overdue` : "No overdue payments"} tone={o.jobs.overdue_payments ? "warn" : undefined} href="/assure/jobs" />
        <Tile label="Average score" value={num(o.performance.average)} sub={`${o.performance.below_60} below 60 of ${o.performance.scored} scored`} tone={o.performance.below_60 ? "warn" : undefined} href="/assure/scorecard" />
        <Tile label="Waiting for sign-off" value={o.approvals.joint_waiting} sub={`${o.approvals.form_changes} form change${o.approvals.form_changes === 1 ? "" : "s"} · ${o.approvals.reviews_next_30_days} reviews in 30 days`} href="/assure/esg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Open NCRs" value={o.risk.open_ncrs} sub={`${o.risk.critical_ncrs} critical`} tone={o.risk.critical_ncrs ? "bad" : undefined} href="/assure/quality" />
        <Tile label="Open issues" value={o.risk.open_issues} href="/assure/performance" />
        <Tile label="Certificates expired" value={o.risk.certs_expired} sub={`${o.risk.certs_expiring} expiring in 60 days`} tone={o.risk.certs_expired ? "bad" : undefined} href="/assure/compliance" />
        <Tile label="ESG concerns open" value={o.risk.open_esg} sub={`${o.risk.high_esg} high`} tone={o.risk.high_esg ? "bad" : undefined} href="/assure/esg?tab=flags" />
        <Tile label="Reviews in 30 days" value={o.approvals.reviews_next_30_days} href="/assure/reviews" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Onboarding stages"><Bars data={o.pool.by_onboarding} total={o.pool.total} /></Panel>
        <Panel title="Live jobs by payment stage"><Bars data={o.jobs.by_stage} total={o.jobs.live} /></Panel>
        <Panel title="Vendor status"><Bars data={o.pool.by_status} total={o.pool.total} /></Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Busiest vendors" sub="By live jobs">
          <ul className="divide-y divide-line text-sm">
            {o.jobs.top_vendors.length === 0 && <li className="px-5 py-4 text-muted">No live jobs.</li>}
            {o.jobs.top_vendors.map((v) => (
              <li key={v.supplier_id} className="flex justify-between gap-3 px-5 py-2.5">
                <Link className="hover:text-accent" href={`/assure/suppliers/${v.supplier_id}?tab=jobs`}>{v.name}</Link>
                <span className="text-muted">{v.jobs} job{v.jobs === 1 ? "" : "s"}{o.can_see_money && v.value != null ? ` · ${Math.round(v.value).toLocaleString("en-GB")}` : ""}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Lowest scores" sub="Latest quarter on record">
          <ul className="divide-y divide-line text-sm">
            {o.performance.lowest.length === 0 && <li className="px-5 py-4 text-muted">No scores recorded.</li>}
            {o.performance.lowest.map((v) => (
              <li key={v.supplier_id} className="flex justify-between gap-3 px-5 py-2.5">
                <Link className="hover:text-accent" href={`/assure/suppliers/${v.supplier_id}`}>{v.name}</Link>
                <span className={Number(v.score) < 60 ? "font-semibold text-bad" : "text-muted"}>{Number(v.score).toFixed(0)} · {v.period}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Vendors needing attention" sub="Weighted by expired certificates, NCRs, open issues, ESG concerns and overdue payments">
        {o.attention.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing needs attention.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Vendor</th><th className="th">Region</th><th className="th">Score</th><th className="th">Expired certs</th><th className="th">NCRs</th><th className="th">Issues</th><th className="th">ESG</th><th className="th">Overdue payments</th></tr></thead>
              <tbody>
                {o.attention.map((v) => (
                  <tr key={v.supplier_id}>
                    <td className="td"><Link className="font-semibold hover:text-accent" href={`/assure/suppliers/${v.supplier_id}`}>{v.name}</Link>{v.category && <span className="block text-xs text-muted">{v.category}</span>}</td>
                    <td className="td">{v.region ?? ""}</td><td className="td">{v.score == null ? "–" : Number(v.score).toFixed(0)}</td>
                    <td className="td">{v.expired_certs || ""}</td><td className="td">{v.open_ncrs || ""}</td><td className="td">{v.open_issues || ""}</td><td className="td">{v.open_esg || ""}</td><td className="td">{v.overdue_payments || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
