import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/assure-data";
import { optLabel, TEMPLATE_CATEGORIES } from "@/lib/assure";
import { formatDate } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { Chips } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { deleteTemplate, saveTemplate } from "../../srm-actions";

export const metadata: Metadata = { title: "Contract templates" };

type Tpl = { id: string; name: string; category: string; folder: string | null; description: string | null; content: string | null; is_active: boolean; created_by: string | null; created_at: string };

function TemplateFields({ t }: { t?: Tpl }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><input name="name" required defaultValue={t?.name} className="input" /></Field>
        <Field label="Category"><Select name="category" options={TEMPLATE_CATEGORIES} defaultValue={t?.category ?? "custom"} /></Field>
        <Field label="Folder"><input name="folder" defaultValue={t?.folder ?? ""} className="input" /></Field>
      </div>
      <Field label="Description"><input name="description" defaultValue={t?.description ?? ""} className="input" /></Field>
      <Field label="Content"><textarea name="content" rows={5} defaultValue={t?.content ?? ""} className="input" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={t ? t.is_active : true} /> Active (offered when creating contracts)</label>
    </>
  );
}

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const all = await rows<Tpl>(supabase, "contract_templates", { order: "created_at" });
  const list = all.filter((t) => !sp.category || t.category === sp.category);
  const folders = [...new Set(list.map((t) => t.folder ?? "Uncategorised"))].sort();
  return (
    <>
      <PageHead title="Contract templates" sub="Reusable wording for new contracts. Templates in use can be made inactive instead of deleted."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Contracts", href: "/assure/contracts" }, { label: "Templates" }]} />
      <Chips param="category" options={TEMPLATE_CATEGORIES.map((c) => ({ value: c.value, label: c.label, count: all.filter((t) => t.category === c.value).length }))} active={sp.category} keep={{ category: sp.category }} />
      {list.length === 0 ? <Card><Empty title="No templates yet" /></Card> : folders.map((f) => (
        <section key={f}>
          <h2 className="mb-2 font-display text-base font-bold">{f}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.filter((t) => (t.folder ?? "Uncategorised") === f).map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{t.name}</h3>
                  <div className="flex gap-1"><Pill tone="info">{optLabel(TEMPLATE_CATEGORIES, t.category)}</Pill>{!t.is_active && <Pill>Inactive</Pill>}</div></div>
                {t.description && <p className="mt-1 text-sm text-muted">{t.description}</p>}
                <p className="mt-1 text-xs text-muted">Added {formatDate(t.created_at)}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-accent">Edit</summary>
                  <ActionForm action={saveTemplate} submit="Save template" hidden={{ id: t.id }} className="mt-2"><TemplateFields t={t} /></ActionForm>
                  {(me.is_admin || t.created_by === me.id) && (
                    <div className="mt-2"><ActionForm action={deleteTemplate} submit="Delete template" hidden={{ id: t.id }} variant="danger" confirm={`Delete the template "${t.name}"?`} /></div>
                  )}
                </details>
              </Card>
            ))}
          </div>
        </section>
      ))}
      <Panel title="New template"><div className="p-5"><ActionForm action={saveTemplate} submit="Add template" resetOnOk><TemplateFields /></ActionForm></div></Panel>
    </>
  );
}
