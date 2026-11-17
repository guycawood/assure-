import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients } from "@/lib/crm-data";
import { systemRpc } from "@/lib/messaging/system";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Select, clientOptions } from "@/components/crm/bits";
import { STATUS_LABEL, STATUS_TONE, type CaseRow } from "@/lib/feedback-cases";

export const metadata: Metadata = { title: "Feedback cases · CRM" };

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Low feedback and poor job surveys as cases: who owns each, what is due, and how well the loop is being closed.
export default async function FeedbackCases({ searchParams }: { searchParams: Promise<{ status?: string; client?: string; severity?: string; mine?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  try { await systemRpc("crm_feedback_run_due", {}); } catch { /* the scheduler will do it */ }
  const supabase = await createClient();
  const [{ data }, stats, clients] = await Promise.all([
    supabase.from("crm_feedback_cases_v").select("*").order("created_at", { ascending: false }),
    supabase.rpc("crm_feedback_case_stats", { p_client: null }),
    getClients(supabase),
  ]);
  const all = (data as CaseRow[] | null) ?? [];
  const s = (stats.data ?? {}) as { open: number; unacknowledged: number; overdue: number; high_open: number; closed_90d: number; avg_days_to_close: number | null; within_target_pct: number | null; satisfied_pct: number | null; by_cause: Record<string, number> };
  const show = sp.status === "closed" ? "closed" : sp.status === "all" ? "all" : "open";
  const rows = all.filter((c) => (show === "all" || (show === "closed" ? c.status === "closed" : c.status !== "closed")) && (!sp.client || c.client_id === sp.client)
    && (!sp.severity || c.severity === sp.severity) && (sp.mine !== "1" || c.owner === me.id))
    .sort((a, b) => Number(b.ack_overdue || b.resolve_overdue) - Number(a.ack_overdue || a.resolve_overdue) || Number(b.severity === "high") - Number(a.severity === "high") || a.resolve_due.localeCompare(b.resolve_due));
  const causes = Object.entries(s.by_cause ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHead title="Feedback cases" sub="Every low score and poor job survey becomes a case: someone owns it, there is a date, the cause is found, and the client is told what was done."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Feedback", href: "/crm/feedback" }, { label: "Cases" }]} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Open cases" value={s.open ?? 0} hint={`${s.high_open ?? 0} high severity`} icon={<MSymbol name="support_agent" />} />
        <Stat label="Late" value={s.overdue ?? 0} tone={s.overdue ? "bad" : "ok"} hint="Not acknowledged or past the resolve date" icon={<MSymbol name="schedule" />} />
        <Stat label="Not yet acknowledged" value={s.unacknowledged ?? 0} tone={s.unacknowledged ? "warn" : undefined} icon={<MSymbol name="mark_email_unread" />} />
        <Stat label="Days to close (90 days)" value={s.avg_days_to_close ?? "—"} hint={s.within_target_pct != null ? `${s.within_target_pct}% closed on time` : `${s.closed_90d ?? 0} closed`} icon={<MSymbol name="timer" />} />
        <Stat label="Clients satisfied after" value={s.satisfied_pct != null ? `${s.satisfied_pct}%` : "—"} hint="Of cases closed in 90 days" icon={<MSymbol name="sentiment_satisfied" />} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="label">Show</span><select name="status" defaultValue={show} className="input"><option value="open">Open cases</option><option value="closed">Closed</option><option value="all">All</option></select></label>
        <label className="block"><span className="label">Severity</span><select name="severity" defaultValue={sp.severity ?? ""} className="input"><option value="">Any</option><option value="high">High</option><option value="medium">Medium</option></select></label>
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> Mine only</label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
      </form>

      <Panel title={`${rows.length} case${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? <Empty title="No cases here">Low feedback opens a case automatically.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">Case</th><th className="th">Client</th><th className="th">Status</th><th className="th">Owner</th><th className="th">Due</th><th className="th">Age</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="td">
                  <Link href={`/crm/feedback/cases/${c.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                    <Pill tone={c.severity === "high" ? "bad" : "warn"}>{c.score}/{c.scale}</Pill>{c.contact_name ?? "Contact not recorded"}
                  </Link>
                  <p className="mt-1 max-w-md text-xs text-muted">{c.comment ? c.comment.slice(0, 140) : c.source === "job_survey" ? "Post-job survey" : "No comment"}</p>
                </td>
                <td className="td"><Link className="hover:underline" href={`/crm/clients/${c.client_id}`}>{c.client_name}</Link></td>
                <td className="td"><Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>{c.escalated_at && <div className="mt-1"><Pill tone="bad">Escalated</Pill></div>}</td>
                <td className="td">{c.owner_name ?? <span className="text-bad">No owner</span>}</td>
                <td className="td text-xs">
                  {c.status === "closed" ? "" : c.status === "new" ? <>Acknowledge by {day(c.ack_due)}{c.ack_overdue && <Pill tone="bad"> late</Pill>}</> : c.status === "resolved" ? "Tell the client" : <>Resolve by {day(c.resolve_due)}{c.resolve_overdue && <Pill tone="bad"> late</Pill>}</>}
                </td>
                <td className="td tabular-nums">{c.age_days}d</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      {causes.length > 0 && (
        <Card className="space-y-2 p-5">
          <h2 className="font-display text-lg font-semibold">What is behind it (last 12 months)</h2>
          <ul className="flex flex-wrap gap-2 text-sm">{causes.map(([k, n]) => <li key={k}><Pill>{k.replace(/_/g, " ")} · {n}</Pill></li>)}</ul>
        </Card>
      )}
    </>
  );
}
