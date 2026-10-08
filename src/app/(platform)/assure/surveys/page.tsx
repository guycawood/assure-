import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows, supplierOptions } from "@/lib/assure-data";
import { optLabel, questionsToText, QUESTION_TYPES, SURVEY_CATEGORIES, SURVEY_STATUS, type Question } from "@/lib/assure";
import { formatDate } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Date_, OptPill, SupplierLink, Tabs } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { launchSurvey, saveSurveyTemplate } from "../srm-actions";

export const metadata: Metadata = { title: "Surveys" };

type Tpl = { id: string; name: string; description: string | null; category: string; questions: Question[]; version: number; is_active: boolean };
type Resp = { id: string; template_name: string; template_version: number; supplier_id: string; status: string; due_date: string | null; submitted_at: string | null; created_at: string };

function TemplateFields({ t }: { t?: Tpl }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2"><input name="name" required defaultValue={t?.name} className="input" /></Field>
        <Field label="Category"><Select name="category" options={SURVEY_CATEGORIES} defaultValue={t?.category ?? "general"} /></Field>
      </div>
      <Field label="Description"><input name="description" defaultValue={t?.description ?? ""} className="input" /></Field>
      <Field label="Questions" hint={`One per line: type | question | options (comma separated) | optional. Types: ${QUESTION_TYPES.map((q) => q.value).join(", ")}. A line without | is a required short-text question.`}>
        <textarea name="questions" rows={6} required defaultValue={t ? questionsToText(t.questions) : "yes_no | Do you have a written environmental policy?\nsingle_choice | How much of your electricity is renewable? | None, Under 50%, 50% or more, 100%\nrating | How would you rate your recycling? | | optional"} className="input font-mono text-xs" />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={t ? t.is_active : true} /> Active</label>
      {t && <p className="text-xs text-muted">Editing questions creates version {t.version + 1}. Surveys already sent keep the questions they were sent with.</p>}
    </>
  );
}

export default async function SurveysPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const tab = sp.tab === "templates" ? "templates" : "responses";
  const supabase = await createClient();
  const [templates, responses, suppliers] = await Promise.all([
    rows<Tpl>(supabase, "survey_templates", { order: "created_at" }),
    rows<Resp>(supabase, "survey_responses", { order: "created_at", cols: "id, template_name, template_version, supplier_id, status, due_date, submitted_at, created_at" }),
    getSuppliers(supabase),
  ]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const n = (st: string) => responses.filter((r) => r.status === st).length;
  return (
    <>
      <PageHead title="Surveys" sub="Send questionnaires to suppliers and review their answers. Only the vendor can answer; staff review." crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Surveys" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sent" value={responses.length} />
        <Stat label="With the vendor" value={n("draft") + n("rejected")} />
        <Stat label="Awaiting review" value={n("submitted") + n("under_review")} tone={n("submitted") ? "warn" : undefined} />
        <Stat label="Completed" value={n("completed")} tone="ok" />
      </section>
      <Tabs tabs={[{ key: "responses", label: "Responses", count: responses.length }, { key: "templates", label: "Templates", count: templates.length }]} active={tab} base="/assure/surveys" />
      {tab === "responses" ? (
        <>
          <Card className="overflow-x-auto">
            {responses.length === 0 ? <Empty title="No surveys sent yet" /> : (
              <table className="w-full text-sm">
                <thead><tr>{["Survey", "Supplier", "Due", "Submitted", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {responses.map((r) => (
                    <tr key={r.id}>
                      <td className="td"><Link href={`/assure/surveys/${r.id}`} className="font-semibold hover:text-accent">{r.template_name}</Link><div className="text-xs text-muted">v{r.template_version} · sent {formatDate(r.created_at)}</div></td>
                      <td className="td"><SupplierLink id={r.supplier_id} name={name.get(r.supplier_id)} /></td>
                      <td className="td"><Date_ d={r.due_date} /></td>
                      <td className="td">{r.submitted_at ? formatDate(r.submitted_at) : "—"}</td>
                      <td className="td"><OptPill list={SURVEY_STATUS} value={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Panel title="Send a survey">
            <div className="p-5">
              <ActionForm action={launchSurvey} submit="Send to vendor" inline>
                <Field label="Survey" className="min-w-[220px] flex-1"><select name="template_id" required className="input" defaultValue=""><option value="">Choose…</option>{templates.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                <Field label="Supplier" className="min-w-[220px] flex-1"><select name="supplier_id" required className="input" defaultValue=""><option value="">Choose…</option>{supplierOptions(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field label="Due" className="w-44"><input name="due_date" type="date" className="input" /></Field>
              </ActionForm>
            </div>
          </Panel>
        </>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{t.name}</h3><div className="flex gap-1"><Pill tone="info">{optLabel(SURVEY_CATEGORIES, t.category)}</Pill><Pill>v{t.version}</Pill>{!t.is_active && <Pill>Inactive</Pill>}</div></div>
                {t.description && <p className="text-sm text-muted">{t.description}</p>}
                <p className="mt-1 text-xs text-muted">{t.questions.length} questions</p>
                <details className="mt-2"><summary className="cursor-pointer text-sm text-accent">Edit</summary>
                  <ActionForm action={saveSurveyTemplate} submit="Save" hidden={{ id: t.id }} className="mt-2"><TemplateFields t={t} /></ActionForm></details>
              </Card>
            ))}
          </div>
          <Panel title="New survey template"><div className="p-5"><ActionForm action={saveSurveyTemplate} submit="Add template" resetOnOk><TemplateFields /></ActionForm></div></Panel>
        </>
      )}
    </>
  );
}
