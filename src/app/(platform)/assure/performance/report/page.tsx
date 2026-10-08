import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows } from "@/lib/assure-data";
import { avg, REPORT_STATUS, reportStatus, type Certificate, type PerformanceRecord, type ReportStatus } from "@/lib/assure";
import { Card, Empty, PageHead, Panel, Stat } from "@/components/ui";
import { OptPill, Score } from "@/components/assure/bits";

export const metadata: Metadata = { title: "Performance report" };

const ORDER: Record<ReportStatus, number> = { below: 0, watch: 1, on_track: 2, no_data: 3 };

function Delta({ now, before }: { now: number | null | undefined; before: number | null | undefined }) {
  if (now == null || before == null) return null;
  const d = Math.round((Number(now) - Number(before)) * 10) / 10;
  return <span className={`ml-1 text-xs ${d >= 0 ? "text-ok" : "text-bad"}`}>{d > 0 ? "+" : ""}{d}</span>;
}

export default async function PerformanceReport({ searchParams }: { searchParams: Promise<{ ct?: string; st?: string; supplier?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const ct = [70, 75, 80, 85, 90].includes(Number(sp.ct)) ? Number(sp.ct) : 80;
  const st = [60, 65, 70, 75, 80].includes(Number(sp.st)) ? Number(sp.st) : 70;
  const supabase = await createClient();
  const [suppliers, perf, certs] = await Promise.all([
    getSuppliers(supabase),
    rows<PerformanceRecord>(supabase, "performance_records"),
    rows<Certificate>(supabase, "supplier_certificates_v", { cols: "supplier_id, status" }),
  ]);
  const periods = [...new Set(perf.map((r) => r.period))].sort();
  const latestPeriod = periods.at(-1);
  const byS = new Map<string, PerformanceRecord[]>();
  for (const r of perf) byS.set(r.supplier_id, [...(byS.get(r.supplier_id) ?? []), r]);
  const rowsOut = suppliers.map((s) => {
    const list = (byS.get(s.id) ?? []).sort((a, b) => a.period.localeCompare(b.period));
    const latest = list.at(-1);
    const prev = list.at(-2);
    const cs = certs.filter((c) => c.supplier_id === s.id);
    return { s, latest, prev, status: latest ? reportStatus(latest.compliance_score, latest.sustainability_score, ct, st) : ("no_data" as ReportStatus),
      valid: cs.filter((c) => c.status === "valid" || c.status === "no_expiry").length, expiring: cs.filter((c) => c.status === "expiring_soon").length, expired: cs.filter((c) => c.status === "expired").length };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || Number(a.latest?.compliance_score ?? 999) - Number(b.latest?.compliance_score ?? 999));
  const inLatest = perf.filter((r) => r.period === latestPeriod);
  const scored = rowsOut.filter((r) => r.status !== "no_data");
  const trendSource = sp.supplier ? perf.filter((r) => r.supplier_id === sp.supplier) : perf;
  const trend = periods.map((p) => ({ p, c: avg(trendSource.filter((r) => r.period === p).map((r) => r.compliance_score)), s: avg(trendSource.filter((r) => r.period === p).map((r) => r.sustainability_score)) }));
  const link = (o: Record<string, string | number | undefined>) => `?${new URLSearchParams(Object.entries({ ct, st, supplier: sp.supplier, ...o }).filter(([, v]) => v !== undefined && v !== "") as [string, string][])}`;

  return (
    <>
      <PageHead title="Compliance & sustainability report" sub="Scores over time against the thresholds you choose. More than 10 points under either threshold is below; up to 10 under is watch."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Performance", href: "/assure/performance" }, { label: "Report" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Average compliance" value={avg(inLatest.map((r) => r.compliance_score)) ?? "—"} hint={`${latestPeriod ?? "No data"} · threshold ${ct}`} />
        <Stat label="Average sustainability" value={avg(inLatest.map((r) => r.sustainability_score)) ?? "—"} hint={`${latestPeriod ?? "No data"} · threshold ${st}`} />
        <Stat label="On track" value={scored.filter((r) => r.status === "on_track").length} hint={`of ${scored.length} scored suppliers`} tone="ok" />
        <Stat label="Below threshold" value={scored.filter((r) => r.status === "below").length} tone="bad" />
      </section>
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span className="text-muted">Compliance threshold:</span>
        {[70, 75, 80, 85, 90].map((v) => <Link key={v} href={link({ ct: v })} className={`rounded-full border px-2.5 py-0.5 ${v === ct ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>{v}</Link>)}
        <span className="ml-4 text-muted">Sustainability threshold:</span>
        {[60, 65, 70, 75, 80].map((v) => <Link key={v} href={link({ st: v })} className={`rounded-full border px-2.5 py-0.5 ${v === st ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>{v}</Link>)}
      </Card>
      <Panel title={`Trend: ${sp.supplier ? suppliers.find((s) => s.id === sp.supplier)?.name ?? "supplier" : "all suppliers (average)"}`}
        actions={sp.supplier ? <Link href={link({ supplier: "" })} className="text-sm text-accent underline">Show all suppliers</Link> : undefined}>
        {trend.length === 0 ? <Empty title="No scores yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Period</th><th className="th">Compliance</th><th className="th">Sustainability</th></tr></thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.p}>
                  <td className="td font-semibold">{t.p}</td>
                  {[[t.c, ct], [t.s, st]].map(([v, th], i) => (
                    <td key={i} className="td">
                      <div className="flex items-center gap-3">
                        <span className="w-10 tabular-nums"><Score value={v} /></span>
                        <span className="relative block h-2 w-full max-w-md rounded-full bg-surface-2">
                          <span className={`absolute inset-y-0 left-0 rounded-full ${v !== null && Number(v) >= Number(th) ? "bg-ok" : "bg-warn"}`} style={{ width: `${Number(v ?? 0)}%` }} />
                          <span className="absolute -top-1 h-4 w-0.5 bg-fg" style={{ left: `${th}%` }} title={`Threshold ${th}`} />
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>{["Supplier", "Region", "Period", "Compliance", "Sustainability", "Certificates", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rowsOut.map(({ s, latest, prev, status, valid, expiring, expired }) => (
              <tr key={s.id}>
                <td className="td"><Link href={link({ supplier: s.id })} className="font-semibold hover:text-accent">{s.name}</Link><div className="text-xs text-muted">{s.category}</div></td>
                <td className="td">{s.region}</td>
                <td className="td">{latest?.period ?? "—"}</td>
                <td className="td"><Score value={latest?.compliance_score} /><Delta now={latest?.compliance_score} before={prev?.compliance_score} /></td>
                <td className="td"><Score value={latest?.sustainability_score} /><Delta now={latest?.sustainability_score} before={prev?.sustainability_score} /></td>
                <td className="td text-xs">{valid} valid · <span className={expiring ? "text-warn" : ""}>{expiring} expiring</span> · <span className={expired ? "text-bad" : ""}>{expired} expired</span></td>
                <td className="td"><OptPill list={REPORT_STATUS} value={status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
