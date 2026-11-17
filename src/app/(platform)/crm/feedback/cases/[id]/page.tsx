import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/crm-data";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Select, peopleOptions } from "@/components/crm/bits";
import { acknowledgeCase, assignCase, closeCase, commentCase, escalateCase, informClient, reopenCase, resolveCase, saveCaseFindings } from "../../case-actions";
import { STATUS_LABEL, STATUS_TONE, type CaseRow } from "@/lib/feedback-cases";

export const metadata: Metadata = { title: "Feedback case · CRM" };

type Full = CaseRow & {
  contact_id: string | null; root_cause: string | null; action_taken: string | null; client_informed_at: string | null; client_informed_how: string | null;
  client_outcome: string | null; closed_at: string | null; escalation_note: string | null; job_survey_id: string | null; acknowledged_at: string | null;
  timeline: { event: string; note: string | null; at: string; by: string | null }[] | null;
};
const CAUSES = [["service_quality", "Service quality"], ["delivery", "Delivery"], ["pricing", "Pricing"], ["communication", "Communication"], ["product_quality", "Product quality"], ["people", "People"], ["systems", "Systems"], ["other", "Other"]];
const OUTCOMES = [["satisfied", "Satisfied with what we did"], ["neutral", "Neutral"], ["not_satisfied", "Still unhappy"], ["no_response", "No response"]];
const EVENT: Record<string, string> = { opened: "Opened", acknowledged: "Acknowledged", assigned: "Assigned", findings_saved: "Findings saved", resolved: "Resolved", client_informed: "Client told", closed: "Closed", reopened: "Reopened", escalated: "Escalated", note: "Note" };
const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function FeedbackCase({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("crm_feedback_cases_v").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Full;
  const people = await getPeople(supabase);
  const hidden = { case_id: id };
  const open = c.status !== "closed";
  const working = c.status === "new" || c.status === "acknowledged" || c.status === "investigating";

  return (
    <>
      <PageHead title={`${c.score}/${c.scale} from ${c.contact_name ?? "a client contact"}`} sub={`${c.client_name} · ${c.source === "job_survey" ? "Post-job survey" : "Feedback"} · opened ${day(c.created_at)}`}
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Feedback", href: "/crm/feedback" }, { label: "Cases", href: "/crm/feedback/cases" }, { label: "Case" }]}>
        <Pill tone={c.severity === "high" ? "bad" : "warn"}>{c.severity === "high" ? "High severity" : "Medium severity"}</Pill>
        <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
        {c.ack_overdue && <Pill tone="bad">Not acknowledged in time</Pill>}{c.resolve_overdue && <Pill tone="bad">Past the resolve date</Pill>}{c.escalated_at && <Pill tone="bad">Escalated</Pill>}
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">What the client said</p>
            <p className="text-sm">{c.comment ?? <span className="text-muted">No comment was left.</span>}</p>
            <p className="text-xs text-muted"><Link className="underline" href={`/crm/clients/${c.client_id}`}>{c.client_name}</Link> · owner {c.owner_name ?? "none yet"} · acknowledge by {day(c.ack_due)} · resolve by {day(c.resolve_due)}</p>
            {c.escalation_note && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm"><b>Escalated:</b> {c.escalation_note}</p>}
          </Card>

          {c.status === "new" && (
            <Card className="space-y-2 p-5">
              <h2 className="font-display text-lg font-semibold">Acknowledge it</h2>
              <p className="text-sm text-muted">Take it on. You become the owner if it has none.</p>
              <ActionForm action={acknowledgeCase} hidden={hidden} submit="Acknowledge" inline><input name="note" aria-label="Note" placeholder="Note (optional)" className="input min-w-[260px] py-1.5" /></ActionForm>
            </Card>
          )}

          {working && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-semibold">Find the cause and what was done</h2>
              <ActionForm action={saveCaseFindings} hidden={hidden} submit="Save findings" variant="secondary">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Cause" htmlFor="cause"><select id="cause" name="cause" defaultValue={c.cause ?? ""} className="input"><option value="">Choose</option>{CAUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                  <Field label="Root cause" htmlFor="root" className="md:col-span-2"><textarea id="root" name="root_cause" rows={2} defaultValue={c.root_cause ?? ""} className="input" placeholder="Why it really happened" /></Field>
                </div>
                <Field label="What was done about it" htmlFor="act"><textarea id="act" name="action_taken" rows={2} defaultValue={c.action_taken ?? ""} className="input" placeholder="The fix, and what stops it happening again" /></Field>
              </ActionForm>
              {(c.cause && c.root_cause && c.action_taken) && (
                <div className="border-t border-line pt-3"><ActionForm action={resolveCase} hidden={hidden} submit="Mark resolved" inline><input name="note" aria-label="Note" placeholder="Note (optional)" className="input min-w-[260px] py-1.5" /></ActionForm></div>
              )}
            </Card>
          )}

          {(c.status === "resolved" || c.status === "closed") && (
            <Card className="space-y-2 p-5 text-sm">
              <h2 className="font-display text-lg font-semibold">Resolution</h2>
              <p><b>Cause:</b> {CAUSES.find(([k]) => k === c.cause)?.[1] ?? "—"}</p>
              <p><b>Root cause:</b> {c.root_cause}</p>
              <p><b>What was done:</b> {c.action_taken}</p>
            </Card>
          )}

          {c.status === "resolved" && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-semibold">Close the loop with the client</h2>
              {c.client_informed_at ? <p className="text-sm text-ok">Client told on {day(c.client_informed_at)} ({c.client_informed_how}).</p> : (
                <ActionForm action={informClient} hidden={hidden} submit="Record that the client was told" variant="secondary">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="How" htmlFor="how"><input id="how" name="how" required className="input" placeholder="Call, meeting, email" /></Field>
                    <Field label="What they said" htmlFor="said"><input id="said" name="note" className="input" /></Field>
                  </div>
                </ActionForm>
              )}
              {c.client_informed_at && (
                <ActionForm action={closeCase} hidden={hidden} submit="Close the case">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="How the client reacted" htmlFor="out"><select id="out" name="outcome" required defaultValue="" className="input"><option value="">Choose</option>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                    <Field label="Note" htmlFor="cn" hint="Needed if the client is still unhappy."><input id="cn" name="note" className="input" /></Field>
                  </div>
                </ActionForm>
              )}
            </Card>
          )}

          {c.status === "closed" && (
            <Card className="space-y-2 p-5 text-sm">
              <p><b>Closed {c.closed_at ? day(c.closed_at) : ""}.</b> The client was told on {c.client_informed_at ? day(c.client_informed_at) : "—"} ({c.client_informed_how}) and reacted: <Pill tone={c.client_outcome === "satisfied" ? "ok" : c.client_outcome === "not_satisfied" ? "bad" : "neutral"}>{OUTCOMES.find(([k]) => k === c.client_outcome)?.[1] ?? c.client_outcome}</Pill></p>
              <ActionForm action={reopenCase} hidden={hidden} submit="Reopen" variant="secondary" inline><input name="note" required aria-label="Why" placeholder="Why it is reopened" className="input min-w-[260px] py-1.5" /></ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {open && (
            <Card className="space-y-4 p-5">
              <ActionForm action={assignCase} hidden={hidden} submit="Assign" variant="secondary" inline>
                <Select name="owner" label="Owner" options={peopleOptions(people)} value={c.owner} empty="Choose" required />
              </ActionForm>
              <ActionForm action={commentCase} hidden={hidden} submit="Add note" variant="secondary" inline><input name="note" required aria-label="Note" placeholder="Add a note" className="input min-w-[200px] py-1.5" /></ActionForm>
              {!c.escalated_at && <ActionForm action={escalateCase} hidden={hidden} submit="Escalate to CRM owners" variant="secondary" inline confirm="Tell the CRM owners about this case?"><input name="note" required aria-label="Why" placeholder="Why" className="input min-w-[200px] py-1.5" /></ActionForm>}
            </Card>
          )}
          <Panel title="Timeline">
            <ol className="divide-y divide-line text-sm">
              {(c.timeline ?? []).map((e, i) => (
                <li key={i} className="px-5 py-3"><p className="font-semibold">{EVENT[e.event] ?? e.event}</p>{e.note && <p className="text-muted">{e.note}</p>}<p className="text-xs text-muted">{when(e.at)}{e.by ? ` · ${e.by}` : ""}</p></li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
