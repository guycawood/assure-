import { notFound } from "next/navigation";
import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, PageHead, Pill } from "@/components/ui";
import { ActionForm } from "@/components/vendor/action-form";
import { saveSurvey } from "../../actions";

export const metadata = { title: "Survey" };

type Q = { id: string; text: string; type: string; options?: string[]; required?: boolean };
type A = { question_id: string; answer: string | null };
type Survey = { id: string; template_name: string; questions: Q[]; due_date: string | null; status: string; answers: A[]; submitted_at: string | null; feedback_to_vendor: string | null };

function Field({ q, value, disabled }: { q: Q; value: string; disabled: boolean }) {
  const name = `q:${q.id}`;
  const choices = q.type === "yes_no" ? ["Yes", "No"] : q.type === "rating" ? ["1", "2", "3", "4", "5"] : q.options ?? [];
  if (q.type === "textarea") return <textarea name={name} rows={4} maxLength={4000} className="input" defaultValue={value} disabled={disabled} />;
  if (q.type === "date") return <input type="date" name={name} className="input max-w-[200px]" defaultValue={value} disabled={disabled} />;
  if (["single_choice", "yes_no", "rating"].includes(q.type)) {
    return (
      <div className="flex flex-wrap gap-2">
        {choices.map((o) => (
          <label key={o} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input type="radio" name={name} value={o} defaultChecked={value === o} disabled={disabled} /> {o}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === "multiple_choice") {
    const picked = value.split(", ");
    return (
      <div className="flex flex-wrap gap-2">
        {choices.map((o) => (
          <label key={o} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input type="checkbox" name={name} value={o} defaultChecked={picked.includes(o)} disabled={disabled} /> {o}
          </label>
        ))}
      </div>
    );
  }
  return <input name={name} maxLength={2000} className="input" defaultValue={value} disabled={disabled} />;
}

export default async function SurveyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data } = await supabase.from("vendor_survey_responses").select("id, template_name, questions, due_date, status, answers, submitted_at, feedback_to_vendor").eq("id", id).maybeSingle();
  if (!data) notFound();
  const s = data as Survey;
  const answers = new Map((s.answers ?? []).map((a) => [a.question_id, a.answer ?? ""]));
  const editable = ["draft", "rejected"].includes(s.status) && canAct(ctx.permission);

  return (
    <>
      <PageHead title={s.template_name} crumbs={[{ label: "Surveys", href: "/vendor/surveys" }, { label: s.template_name }]} sub={s.due_date ? `Please answer by ${formatDate(s.due_date)}.` : undefined}>
        <Pill tone={statusTone(s.status)}>{s.status === "draft" ? "To answer" : human(s.status)}</Pill>
      </PageHead>
      {s.status === "rejected" && s.feedback_to_vendor && <Card className="bg-warn-soft p-4 text-sm"><b>adm Indicia asked for changes:</b> {s.feedback_to_vendor}</Card>}
      {!editable && s.submitted_at && <p className="text-sm text-muted">Submitted {formatDate(s.submitted_at)}.</p>}
      <Card className="p-5">
        <ActionForm action={saveSurvey} hidden={{ id: s.id }} submit={editable ? "Submit survey" : undefined} secondary={editable ? [{ label: "Save answers", intent: "draft" }] : undefined} className="flex flex-col gap-5">
          {s.questions.map((q, i) => (
            <fieldset key={q.id} className="space-y-1.5">
              <legend className="text-sm font-semibold">{i + 1}. {q.text}{q.required !== false && <span className="text-bad"> *</span>}</legend>
              <Field q={q} value={answers.get(q.id) ?? ""} disabled={!editable} />
            </fieldset>
          ))}
        </ActionForm>
      </Card>
    </>
  );
}
