import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { getSupplier } from "@/lib/assure-data";
import { SURVEY_STATUS, type Question } from "@/lib/assure";
import { formatDate, personName } from "@/lib/srt";
import { PageHead, Panel } from "@/components/ui";
import { Facts, OptPill, SupplierLink } from "@/components/assure/bits";
import { ActionForm, Field } from "@/components/assure/action-form";
import { reviewSurvey } from "../../srm-actions";

export const metadata: Metadata = { title: "Survey response" };

type Resp = {
  id: string; template_name: string; template_version: number; questions: Question[]; supplier_id: string; status: string; due_date: string | null;
  answers: { question_id: string; answer: string | null }[]; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null;
  review_notes: string | null; feedback_to_vendor: string | null;
};

export default async function SurveyResponse({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("survey_responses").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as Resp;
  const [supplier, people] = await Promise.all([getSupplier(supabase, r.supplier_id), getInternalPeople(supabase)]);
  const pMap = byId(people);
  const ans = new Map(r.answers.map((a) => [a.question_id, a.answer]));
  const reviewable = r.status === "submitted" || r.status === "under_review";

  return (
    <>
      <PageHead title={r.template_name} sub={`Version ${r.template_version}${r.due_date ? ` · due ${formatDate(r.due_date)}` : ""}`}
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Surveys", href: "/assure/surveys" }, { label: r.template_name }]}>
        <OptPill list={SURVEY_STATUS} value={r.status} />
      </PageHead>
      <Panel title="Answers" sub={r.status === "draft" ? "The vendor hasn't submitted yet." : undefined}>
        <div className="space-y-4 p-5">
          <Facts cols={3} items={[["Supplier", <SupplierLink key="s" id={r.supplier_id} name={supplier?.name} />], ["Submitted", r.submitted_at ? formatDate(r.submitted_at) : null],
            ["Reviewed", r.reviewed_by ? `${personName(pMap.get(r.reviewed_by))}${r.reviewed_at ? `, ${formatDate(r.reviewed_at)}` : ""}` : null]]} />
          <ol className="space-y-3">
            {r.questions.map((q, i) => {
              const a = ans.get(q.id);
              return (
                <li key={q.id} className="rounded-lg border border-line p-3 text-sm">
                  <p className="font-semibold">{i + 1}. {q.text}{q.required === false && <span className="font-normal text-muted"> (optional)</span>}</p>
                  <p className="mt-1">{a ? (q.type === "rating" ? `${"★".repeat(Number(a))}${"☆".repeat(5 - Number(a))} (${a}/5)` : a) : <span className="text-muted">No answer</span>}</p>
                </li>
              );
            })}
          </ol>
          {r.review_notes && <p className="text-sm"><b>Review notes:</b> {r.review_notes}</p>}
          {r.feedback_to_vendor && <p className="text-sm"><b>Sent to vendor:</b> {r.feedback_to_vendor}</p>}
        </div>
      </Panel>
      {reviewable && (
        <Panel title="Review" sub="There is no automatic scoring: read the answers and decide.">
          <div className="flex flex-wrap gap-4 p-5">
            {r.status === "submitted" && <ActionForm action={reviewSurvey} submit="Start review" hidden={{ id: r.id, decision: "start" }} variant="secondary" inline />}
            <ActionForm action={reviewSurvey} submit="Approve" hidden={{ id: r.id, decision: "approve" }} className="min-w-[280px] flex-1">
              <Field label="Internal notes"><textarea name="notes" rows={2} className="input" /></Field>
            </ActionForm>
            <ActionForm action={reviewSurvey} submit="Send back to vendor" hidden={{ id: r.id, decision: "reject" }} variant="danger" className="min-w-[280px] flex-1">
              <Field label="What the vendor needs to change"><textarea name="feedback" rows={2} required className="input" /></Field>
              <Field label="Internal notes"><input name="notes" className="input" /></Field>
            </ActionForm>
          </div>
        </Panel>
      )}
    </>
  );
}
