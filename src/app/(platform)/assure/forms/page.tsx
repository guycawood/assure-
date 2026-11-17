import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/assure/action-form";
import { QUESTION_TYPES, questionsToText, type Question } from "@/lib/assure";
import { discardFormDraft, proposeForm, saveFormDraft } from "./actions";

export const metadata: Metadata = { title: "Vendor forms" };

type Version = { id: string; version: number; status: "draft" | "pending" | "published" | "retired"; questions: Question[]; change_note: string | null; created_at: string; published_at: string | null; created_by: string | null };
const TONE = { draft: "neutral", pending: "warn", published: "ok", retired: "neutral" } as const;
const LABEL = { draft: "Draft", pending: "Waiting for sign-off", published: "Live", retired: "Replaced" } as const;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

// The vendor onboarding form's extra questions. Changes are versioned and need a joint sign-off before vendors see them.
const FORMS = [
  { key: "onboarding", label: "Onboarding", what: "the vendor onboarding pre-assessment" },
  { key: "capability", label: "Capabilities", what: "each capability a vendor adds to their profile" },
  { key: "machine", label: "Machines", what: "each machine a vendor adds" },
  { key: "tooling", label: "Tooling", what: "each tool or mould a vendor registers" },
] as const;

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ form?: string }> }) {
  await requireInternal();
  const { form: f } = await searchParams;
  const form = FORMS.find((x) => x.key === f) ?? FORMS[0];
  const supabase = await createClient();
  const [vs, canEdit] = await Promise.all([
    supabase.rpc("form_versions_list", { p_form: form.key }),
    supabase.rpc("division_can", { p_module: "assure", p_capability: "manage_libraries" }),
  ]);
  const versions = (vs.data as Version[] | null) ?? [];
  const live = versions.find((v) => v.status === "published");
  const open = versions.find((v) => v.status === "draft" || v.status === "pending");
  const editor = canEdit.data === true;
  const base = open ?? live;

  return (
    <>
      <PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "Vendor forms" }]} title="Vendor forms"
        sub="The fixed fields on each form stay as they are. You can add questions of your own to each. Every change is a new version that goes live only when a procurement director and the Sustainability team both sign." />
      <nav className="flex flex-wrap gap-1 border-b border-line">
        {FORMS.map((x) => <Link key={x.key} href={x.key === "onboarding" ? "/assure/forms" : `/assure/forms?form=${x.key}`} className={`border-b-2 px-3 py-2 text-sm font-semibold ${x.key === form.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{x.label}</Link>)}
      </nav>
      <p className="text-sm text-muted">Extra questions asked on {form.what}.</p>

      <Panel title={`Live now: version ${live?.version ?? 1}`} sub={live ? `Published ${day(live.published_at)}` : undefined}>
        {live && live.questions.length > 0 ? (
          <ol className="list-decimal space-y-1 px-9 py-4 text-sm">
            {live.questions.map((q) => <li key={q.id}>{q.text} <span className="text-xs text-muted">({QUESTION_TYPES.find((t) => t.value === q.type)?.label}{q.required === false ? ", optional" : ""})</span></li>)}
          </ol>
        ) : <p className="px-5 py-4 text-sm text-muted">No extra questions yet. Vendors see the standard fields only.</p>}
      </Panel>

      {open?.status === "pending" ? (
        <Card className="space-y-2 p-5">
          <h2 className="font-display text-lg font-semibold">Version {open.version} is waiting for sign-off</h2>
          <p className="text-sm text-muted">{open.change_note ?? "No note"}. It goes live when both a procurement director and the Sustainability team have signed. To edit it, the person who asked withdraws the request first.</p>
          <Link href="/assure/esg" className="btn-secondary inline-block">Open joint approvals</Link>
        </Card>
      ) : (
        <Card className="space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold">{open ? `Draft version ${open.version}` : "Change the form"}</h2>
          {!editor ? <p className="text-sm text-muted">Only the SRM owners can change the form.</p> : (
            <>
              <p className="text-sm text-muted">One question per line: <code>type | question | option, option | optional</code>. Types: {QUESTION_TYPES.map((t) => t.value).join(", ")}. A line with no pipe is a required short-text question. Keep the wording of a question the same to keep earlier answers attached to it.</p>
              <ActionForm action={saveFormDraft} hidden={{ form: form.key }} submit="Save draft" variant="secondary">
                <Field label="Extra questions"><textarea name="questions" rows={8} className="input font-mono text-xs" defaultValue={questionsToText(base?.questions ?? [])} /></Field>
                <Field label="What changed and why"><input name="note" defaultValue={open?.change_note ?? ""} className="input" placeholder="Add forced-labour and audit questions" /></Field>
              </ActionForm>
              {open && (
                <div className="flex flex-wrap gap-3 border-t border-line pt-3">
                  <ActionForm action={proposeForm} hidden={{ id: open.id }} submit="Send for joint sign-off" inline />
                  <ActionForm action={discardFormDraft} hidden={{ form: form.key }} submit="Discard draft" variant="secondary" inline />
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Panel title="Versions">
        <ul className="divide-y divide-line text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <b>Version {v.version}</b><Pill tone={TONE[v.status]}>{LABEL[v.status]}</Pill>
              <span>{v.questions.length} extra question{v.questions.length === 1 ? "" : "s"}</span>
              <span className="text-muted">{v.change_note}</span>
              <span className="ml-auto text-xs text-muted">{v.published_at ? `Live ${day(v.published_at)}` : `Started ${day(v.created_at)}`}{v.created_by ? ` by ${v.created_by}` : ""}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
