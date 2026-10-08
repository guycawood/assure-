import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJobs, rows } from "@/lib/sourcing-data";
import type { Gate } from "@/lib/execution";
import { Card, Empty, PageHead } from "@/components/ui";
import { JobStatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Quality gates" };

export default async function JobsGatesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [jobs, gates, deps] = await Promise.all([
    getJobs(supabase), rows<Gate>(supabase, "v_job_quality_gates", { limit: 20000 }),
    rows<{ job_id: string; stage: string; audit_status: string }>(supabase, "deployments", { limit: 20000 }),
  ]);
  const list = jobs.filter((j) => sp.all || ["ordered", "in_production", "delivered"].includes(j.status));
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Quality gates" }]} title="Quality gates and job close"
        sub="Vendor onboarded → mock-up check sheet → production check sheet → installation check sheet → post-production closure. A job closes only when the gates pass, deliveries are confirmed and installs are audited." />
      <p className="text-sm">{sp.all ? <Link className="underline" href="/execution/jobs">Show live jobs only</Link> : <Link className="underline" href="/execution/jobs?all=1">Show all jobs</Link>}</p>
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="No jobs in production" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Job</Th><Th>Client</Th><Th>Gates</Th><Th>Installs audited</Th><Th>Target delivery</Th><Th>Status</Th></tr></thead>
            <tbody>{list.map((j) => {
              const g = gates.filter((x) => x.job_id === j.id).sort((a, b) => a.seq - b.seq);
              const jd = deps.filter((d) => d.job_id === j.id);
              return (
                <tr key={j.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/execution/jobs/${j.id}`}>{j.job_number}</Link><div className="text-xs text-muted">{j.title}</div></Td>
                  <Td>{j.client_name}<div className="text-xs text-muted">{j.market} · {j.region}</div></Td>
                  <Td><span className="inline-flex gap-1">{g.map((x) => <i key={x.gate_key} title={`${x.label}: ${x.status}`} className={`block h-4 w-6 rounded-sm border ${x.status === "passed" ? "border-ok bg-ok" : x.status === "failed" ? "border-bad bg-bad-soft" : x.document_count ? "border-info bg-info-soft" : "border-line bg-surface-2"}`} />)}</span>
                    <div className="text-xs text-muted">{g.filter((x) => x.status === "passed").length} of 4 passed</div></Td>
                  <Td className="tabular-nums">{jd.length ? `${jd.filter((d) => d.stage === "audited" && d.audit_status === "passed").length} / ${jd.length}` : "—"}</Td>
                  <Td>{fmtDate(j.target_delivery_date)}</Td><Td><JobStatusPill status={j.status} /></Td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
