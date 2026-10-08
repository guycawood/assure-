import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clsx } from "clsx";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { getSupplier, rows } from "@/lib/assure-data";
import { APPROVER_ROLES, canApprove, optLabel, PRIORITY, STEP_STATUS, WORKFLOW_STATUS, WORKFLOW_TYPES, type WorkflowInstance, type WorkflowStep } from "@/lib/assure";
import { formatDate, personName } from "@/lib/srt";
import { PageHead, Panel } from "@/components/ui";
import { Facts, OptPill, SupplierLink } from "@/components/assure/bits";
import { ActionForm, Field } from "@/components/assure/action-form";
import { workflowAct } from "../../srm-actions";

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("workflow_instances").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const w = data as WorkflowInstance;
  const [supplier, steps, people] = await Promise.all([
    getSupplier(supabase, w.supplier_id),
    rows<WorkflowStep>(supabase, "workflow_steps", { eq: ["instance_id", id], order: "idx", asc: true }),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  const cur = steps.find((s) => s.idx === w.current_step);
  const prev = steps.find((s) => s.idx === w.current_step - 1);
  const live = w.status === "in_progress" || w.status === "on_hold";
  const mayApprove = !!cur && canApprove(cur.approver_role, me);
  const approvedPrev = prev?.acted_by === me.id;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead title={w.name} sub={optLabel(WORKFLOW_TYPES, w.workflow_type)} crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Workflows", href: "/assure/workflows" }, { label: w.name }]}>
        <OptPill list={WORKFLOW_STATUS} value={w.status} />
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Steps" className="xl:col-span-2">
          <ol className="space-y-0 p-5">
            {steps.map((s) => (
              <li key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
                <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                  s.status === "approved" ? "bg-ok text-white" : s.status === "rejected" ? "bg-bad text-white" : s.status === "in_progress" ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>{s.idx + 1}</span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{s.name} <OptPill list={STEP_STATUS} value={s.status} /></p>
                  <p className="text-xs text-muted">{optLabel(APPROVER_ROLES, s.approver_role)} · {s.sla_days} day target{s.due_date ? ` · due ${formatDate(s.due_date)}` : ""}
                    {s.status === "in_progress" && s.due_date && s.due_date < today && <span className="text-bad"> · overdue</span>}</p>
                  {s.acted_by && <p className="text-xs">{s.status === "approved" ? "Approved" : "Rejected"} by {personName(pMap.get(s.acted_by))}{s.acted_at ? ` on ${formatDate(s.acted_at)}` : ""}</p>}
                  {s.notes && <p className="text-xs text-muted">{s.notes}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
        <div className="space-y-4">
          <Panel title="Details">
            <div className="p-5"><Facts cols={2} items={[["Supplier", <SupplierLink key="s" id={w.supplier_id} name={supplier?.name} />], ["Priority", optLabel(PRIORITY, w.priority)],
              ["Started", formatDate(w.started_at)], ["Started by", w.initiated_by ? personName(pMap.get(w.initiated_by)) : null], ["Finished", w.completed_at ? formatDate(w.completed_at) : null]]} /></div>
          </Panel>
          {live && (
            <Panel title="Act on this workflow">
              <div className="space-y-3 p-5 text-sm">
                {cur && <p>Current step: <b>{cur.name}</b>, needs {optLabel(APPROVER_ROLES, cur.approver_role).toLowerCase()}.</p>}
                {!mayApprove ? <p className="text-muted">You don&apos;t hold the role this step needs.</p> : approvedPrev ? <p className="text-muted">You approved the previous step, so someone else approves this one.</p> : (
                  <>
                    <ActionForm action={workflowAct} submit="Approve and move on" hidden={{ id: w.id, action: "approve" }}>
                      <Field label="Notes (optional)"><input name="notes" className="input" /></Field>
                    </ActionForm>
                    <ActionForm action={workflowAct} submit="Reject" hidden={{ id: w.id, action: "reject" }} variant="danger" confirm="Reject this step? The workflow ends.">
                      <Field label="Why"><input name="notes" required className="input" /></Field>
                    </ActionForm>
                  </>
                )}
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  {w.status === "in_progress" && <ActionForm action={workflowAct} submit="Put on hold" hidden={{ id: w.id, action: "hold" }} variant="secondary" inline />}
                  {w.status === "on_hold" && <ActionForm action={workflowAct} submit="Resume" hidden={{ id: w.id, action: "resume" }} variant="secondary" inline />}
                  <ActionForm action={workflowAct} submit="Cancel workflow" hidden={{ id: w.id, action: "cancel" }} variant="danger" inline confirm="Cancel this workflow?">
                    <input name="notes" required className="input w-48 py-1.5" placeholder="Why" aria-label="Reason" />
                  </ActionForm>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
