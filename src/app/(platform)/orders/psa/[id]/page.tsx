import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEvents, getMyAccess, getPeople, one } from "@/lib/sourcing-data";
import { money } from "@/lib/sourcing";
import { PSA_OUTCOMES, PSA_STAGES, psaStage } from "@/lib/orders";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, fmtDateTime } from "@/components/sourcing/bits";
import { applyPsa, approvePsa, assessPsa, lineManagerPsa, submitPsa } from "../../actions";

export const metadata: Metadata = { title: "PSA exception" };

type Psa = {
  id: string; reference: string; title: string; stage: string; fee: number; currency: string; business_reason: string; supplier_name: string | null; job_number: string | null;
  po_number: string | null; requester: string; requester_name: string | null; line_manager: string | null; line_manager_name: string | null; lm_notes: string | null; lm_decided_at: string | null;
  outcome: string | null; assess_notes: string | null; value_impact: number | null; assessed_by: string | null; required_doa_level: number | null; approver: string | null; approver_level: number | null;
  approver_notes: string | null; applied_by: string | null; applied_at: string | null; follow_up_actions: string | null; rejected_reason: string | null; region: string | null; market: string | null;
};

export default async function PsaDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const x = await one<Psa>(supabase, "v_psa_exceptions", id);
  if (!x) notFound();
  const [events, people, access] = await Promise.all([getEvents(supabase, { entity_id: id }), getPeople(supabase), getMyAccess(supabase, me.id, me.is_admin, me.srt_role)]);
  const stageIdx = PSA_STAGES.findIndex((s) => s.value === x.stage);
  const isProcurement = me.srt_role === "procurement" || access.is_lead;

  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "PSA exceptions", href: "/orders/psa" }, { label: x.reference }]} title={x.title}
        sub={`${x.reference} · ${money(x.fee, x.currency, 2)} · raised by ${x.requester_name ?? "—"}`}>
        <Pill tone={psaStage(x.stage).tone}>{psaStage(x.stage).label}</Pill>
      </PageHead>
      <ol className="flex flex-wrap gap-1.5 text-xs font-semibold">{PSA_STAGES.slice(0, 6).map((s, i) => (
        <li key={s.value} className={`rounded-full border px-2.5 py-1 ${i < stageIdx || x.stage === "applied" ? "border-ok/40 bg-ok-soft text-ok" : s.value === x.stage ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>{i + 1}. {s.label}</li>
      ))}</ol>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Request" className="xl:col-span-2">
          <Facts items={[
            ["Fee", money(x.fee, x.currency, 2)], ["Supplier", x.supplier_name], ["Job", x.job_number], ["Region / market", [x.region, x.market].filter(Boolean).join(" · ") || null],
            ["Line manager", x.line_manager_name], ["Line manager notes", x.lm_notes], ["Outcome", PSA_OUTCOMES.find((o) => o.value === x.outcome)?.label ?? null],
            ["Procurement notes", x.assess_notes], ["Value impact", money(x.value_impact, x.currency, 2)], ["DOA level needed", x.required_doa_level != null ? `Level ${x.required_doa_level}` : null],
            ["Approver", x.approver ? `${people.get(x.approver) ?? "—"} (level ${x.approver_level})` : null], ["Approver notes", x.approver_notes],
            ["Applied", x.applied_at ? `${fmtDateTime(x.applied_at)} by ${people.get(x.applied_by ?? "") ?? "—"}` : null], ["Follow-up actions", x.follow_up_actions],
          ]} />
          <p className="border-t border-line px-5 py-3 text-sm"><span className="eyebrow block">Business reason</span>{x.business_reason}</p>
          {x.rejected_reason && <p className="border-t border-line px-5 py-2 text-sm text-bad">Rejected: {x.rejected_reason}</p>}
        </Panel>
        <div className="space-y-4">
          <Panel title="Next step">
            <div className="space-y-3 p-5 text-sm">
              {x.stage === "draft" && (x.requester === me.id ? (
                <ActionForm action={submitPsa} hidden={{ id }} submit="Send to line manager">
                  <Field label="Your line manager" htmlFor="line_manager"><select id="line_manager" name="line_manager" className="input">{[...people.entries()].filter(([uid]) => uid !== me.id).map(([uid, n]) => <option key={uid} value={uid}>{n}</option>)}</select></Field>
                </ActionForm>
              ) : <p className="text-muted">Waiting for the requester to submit.</p>)}
              {x.stage === "line_manager" && (x.line_manager === me.id ? (
                <ActionForm action={lineManagerPsa} hidden={{ id }} submit="Record decision">
                  <Field label="Decision" htmlFor="decision"><select id="decision" name="decision" className="input"><option value="approve">Valid: send to procurement</option><option value="reject">Reject</option></select></Field>
                  <Field label="Notes (check client savings vs contract performance)" htmlFor="notes"><input id="notes" name="notes" className="input" /></Field>
                </ActionForm>
              ) : <p className="text-muted">Waiting for {x.line_manager_name}.</p>)}
              {x.stage === "procurement" && (isProcurement && x.requester !== me.id ? (
                <ActionForm action={assessPsa} hidden={{ id }} submit="Record outcome">
                  <Field label="Outcome" htmlFor="outcome"><select id="outcome" name="outcome" className="input">{PSA_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
                  <Field label="What procurement did" htmlFor="notes"><input id="notes" name="notes" required className="input" /></Field>
                  <Field label="Value impact" htmlFor="value_impact"><input id="value_impact" name="value_impact" inputMode="decimal" className="input" /></Field>
                </ActionForm>
              ) : <p className="text-muted">Waiting for a regional procurement SME.</p>)}
              {x.stage === "approver" && (access.doa_level != null && access.doa_level >= (x.required_doa_level ?? 99) && x.requester !== me.id ? (
                <ActionForm action={approvePsa} hidden={{ id }} submit="Record decision">
                  <Field label="Decision" htmlFor="decision"><select id="decision" name="decision" className="input"><option value="approve">Approve the exception</option><option value="reject">Reject</option></select></Field>
                  <Field label="Notes" htmlFor="notes"><input id="notes" name="notes" className="input" /></Field>
                </ActionForm>
              ) : <p className="text-muted">Needs an approver with DOA level {x.required_doa_level} or above (not the requester).</p>)}
              {x.stage === "to_apply" && (access.is_finance ? (
                <ActionForm action={applyPsa} hidden={{ id }} submit="Apply and notify CST">
                  <Field label="Follow-up actions" htmlFor="follow_up"><input id="follow_up" name="follow_up" className="input" /></Field>
                </ActionForm>
              ) : <p className="text-muted">Waiting for Finance (FSSC / CST) to apply it.</p>)}
              {["applied", "resolved", "rejected"].includes(x.stage) && <p>{psaStage(x.stage).description}</p>}
            </div>
          </Panel>
          <Panel title="History"><ActivityList events={events} people={people} /></Panel>
        </div>
      </div>
    </>
  );
}
