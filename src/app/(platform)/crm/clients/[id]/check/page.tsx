import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClient } from "@/lib/crm-data";
import { Card, PageHead, Panel } from "@/components/ui";
import { CheckRunner } from "@/components/crm/check-runner";
import type { Ruleset } from "@/lib/savings-check/engine";

export const metadata: Metadata = { title: "Savings check · CRM" };

type Version = { id: string; version: number; status: string; doc: Ruleset; published_at: string | null };
type Run = { id: string; version: number; file_name: string; rows_checked: number; run_by: string | null; created_at: string; summary: { pass: number; issue: number; confirm: number; hold: number } };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

// Check a client's savings file against that client's live rules.
export default async function SavingsCheckPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const client = await getClient(supabase, id);
  if (!client) notFound();
  const [vs, rs] = await Promise.all([supabase.rpc("crm_rulesets", { p_client: id }), supabase.rpc("crm_check_runs_list", { p_client: id })]);
  const live = ((vs.data as Version[] | null) ?? []).find((v) => v.status === "published");
  const runs = (rs.data as Run[] | null) ?? [];

  return (
    <>
      <PageHead title="Savings check" sub={`Check ${client.name}'s savings file against its own rules.`}
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Clients", href: "/crm/clients" }, { label: client.name, href: `/crm/clients/${id}?tab=rules` }, { label: "Savings check" }]} />
      {!live ? (
        <Card className="space-y-2 p-5 text-sm">
          <p><b>{client.name} has no live rules yet.</b></p>
          <p className="text-muted">Draft the client&apos;s rules and get them approved by another CRM owner first.</p>
          <Link href={`/crm/clients/${id}?tab=rules`} className="btn-primary inline-block">Open Method &amp; rules</Link>
        </Card>
      ) : (
        <CheckRunner clientId={id} rules={live.doc.rules.filter((r) => r.enabled !== false).map((r) => ({ id: r.id, name: r.name }))} />
      )}
      <Panel title="Recent checks" sub="The summary of each run is kept. The files themselves are not.">
        {runs.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No file has been checked for this client yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">When</th><th className="th">File</th><th className="th">Rules</th><th className="th">Lines</th><th className="th">Pass</th><th className="th">Issue</th><th className="th">Confirm</th><th className="th">Hold</th><th className="th">Run by</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}><td className="td">{day(r.created_at)}</td><td className="td">{r.file_name}</td><td className="td">v{r.version}</td><td className="td tabular-nums">{r.rows_checked}</td>
                  <td className="td tabular-nums">{r.summary.pass}</td><td className="td tabular-nums">{r.summary.issue}</td><td className="td tabular-nums">{r.summary.confirm}</td><td className="td tabular-nums">{r.summary.hold}</td><td className="td">{r.run_by ?? ""}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
