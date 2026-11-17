import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { countQuestions, templateToText, type SurveyTemplate } from "@/lib/survey-template";
import { duplicateTemplate, retireTemplate, saveTemplateVersion } from "../../survey-mgmt-actions";

export const metadata: Metadata = { title: "Survey templates · CRM" };

type Rec = { id: string; code: string; name: string; data: SurveyTemplate; version: number; status: string; effective_from: string };
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// The statements, sections and rules of each survey. A change is a new version; surveys already sent keep the version they went out with.
export default async function SurveyTemplates() {
  await requireInternal();
  const supabase = await createClient();
  const [recs, waves, gov] = await Promise.all([
    supabase.from("library_records").select("id, code, name, data, version, status, effective_from").eq("library_key", "crm_survey_templates").in("status", ["active", "pending_approval"]).order("name"),
    supabase.from("crm_survey_waves").select("template_id"),
    supabase.rpc("can_govern", { p_module: "crm" }),
  ]);
  const templates = (recs.data as Rec[] | null) ?? [];
  const used = new Map<string, number>();
  for (const w of (waves.data as { template_id: string }[] | null) ?? []) used.set(w.template_id, (used.get(w.template_id) ?? 0) + 1);
  const canEdit = gov.data === true;

  return (
    <>
      <PageHead title="Survey templates" sub="The statements clients score from 1 to 5, grouped in sections. Change the wording as the business changes; each change is a new version so earlier results still mean what they meant."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Surveys", href: "/crm/surveys" }, { label: "Templates" }]} />
      {!canEdit && <Card className="p-4 text-sm text-muted">Only CRM owners and admins can change templates. You can read them here.</Card>}
      {templates.length === 0 ? <Empty title="No survey templates" /> : templates.map((t) => (
        <Panel key={t.id} title={t.name} sub={`${t.code} · version ${t.version} · ${countQuestions(t.data)} statements in ${t.data.sections.length} sections · from ${day(t.effective_from)}`}
          actions={<span className="flex items-center gap-2">{t.status === "pending_approval" && <Pill tone="warn">Waiting for approval</Pill>}<span className="text-xs text-muted">Used by {used.get(t.id) ?? 0} survey{(used.get(t.id) ?? 0) === 1 ? "" : "s"}</span></span>}>
          {t.status === "pending_approval" && <p className="border-b border-line bg-warn-soft px-5 py-3 text-sm">This version is waiting for another CRM owner to approve it in <Link className="underline" href="/crm/watchtower/change-requests">Watchtower</Link>. Until then the previous version is used.</p>}
          <div className="space-y-3 p-5">
            <details open={false}><summary className="cursor-pointer text-sm font-semibold text-accent">Read or edit the statements</summary>
              {canEdit && t.status === "active" ? (
                <ActionForm action={saveTemplateVersion} hidden={{ id: t.id }} submit="Save as a new version" className="mt-3 space-y-3">
                  <Field label="Name" htmlFor={`n-${t.id}`}><input id={`n-${t.id}`} name="name" defaultValue={t.name} className="input" /></Field>
                  <Field label="Sections and statements" htmlFor={`s-${t.id}`} hint="A line starting with # begins a section. Each other line is one statement. Leave the code (Q01 |) as it is to keep earlier answers attached; a statement with no code is matched by its wording, or gets a new code.">
                    <textarea id={`s-${t.id}`} name="sections" rows={16} defaultValue={templateToText(t.data)} className="input font-mono text-xs" />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Scale caption" htmlFor={`sc-${t.id}`}><input id={`sc-${t.id}`} name="scale" defaultValue={t.data.scale} className="input" /></Field>
                    <Field label="Ask for a comment at this score or lower" htmlFor={`c-${t.id}`} hint="Scores at or below it need a comment."><input id={`c-${t.id}`} name="comment_at_or_below" type="number" min={0} max={4} defaultValue={t.data.comment_at_or_below} className="input" /></Field>
                    <Field label="Tools to rank (one per line)" htmlFor={`t-${t.id}`}><textarea id={`t-${t.id}`} name="tools" rows={3} defaultValue={(t.data.tools ?? []).join("\n")} className="input" /></Field>
                  </div>
                  <Field label="What changed and why" htmlFor={`w-${t.id}`}><input id={`w-${t.id}`} name="note" required className="input" placeholder="Reworded the delivery statements and added one on sustainability" /></Field>
                </ActionForm>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  {t.data.sections.map((s) => (
                    <div key={s.key}><p className="font-semibold">{s.label}</p><ul className="ml-4 list-disc text-muted">{s.questions.map((q) => <li key={q.code}><span className="font-mono text-xs">{q.code}</span> {q.text}</li>)}</ul></div>
                  ))}
                </div>
              )}
            </details>
            {canEdit && t.status === "active" && (
              <div className="flex flex-wrap items-start gap-6 border-t border-line pt-3">
                <ActionForm action={duplicateTemplate} hidden={{ id: t.id }} submit="Copy as a new template" variant="secondary" inline>
                  <input name="new_name" required className="input w-56 py-1.5" placeholder="Name of the copy" aria-label="Name of the copy" />
                  <input name="new_code" required className="input w-36 py-1.5" placeholder="Short code" aria-label="Short code" />
                </ActionForm>
                {t.code !== "CSS-STANDARD" && (
                  <ActionForm action={retireTemplate} hidden={{ id: t.id }} submit="Retire" variant="secondary" inline confirm="Retire this template? Surveys already sent are not affected.">
                    <input name="note" required className="input w-56 py-1.5" placeholder="Why" aria-label="Why" />
                  </ActionForm>
                )}
              </div>
            )}
          </div>
        </Panel>
      ))}
    </>
  );
}
