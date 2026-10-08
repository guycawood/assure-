import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows, supplierOptions } from "@/lib/assure-data";
import { APPROVER_ROLES, optLabel, PRIORITY, WORKFLOW_STATUS, WORKFLOW_TYPES, type WorkflowInstance, type WorkflowStep, type WorkflowTemplate } from "@/lib/assure";
import { formatDate } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Bar, Chips, OptPill, SupplierLink, Tabs } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { launchWorkflow, saveWorkflowTemplate } from "../srm-actions";

export const metadata: Metadata = { title: "Workflows" };

const CATEGORIES = ["supplier_onboarding", "compliance_review", "performance_review", "commercial_review", "offboarding", "other"].map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

function TemplateFields({ t }: { t?: WorkflowTemplate }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Name" className="sm:col-span-2"><input name="name" required defaultValue={t?.name} className="input" /></Field>
        <Field label="Type"><Select name="workflow_type" options={WORKFLOW_TYPES} defaultValue={t?.workflow_type ?? "custom"} /></Field>
        <Field label="Priority"><Select name="priority" options={PRIORITY} defaultValue={t?.priority ?? "medium"} /></Field>
        <Field label="Category"><Select name="category" options={CATEGORIES} defaultValue={t?.category ?? "other"} /></Field>
        <Field label="Description" className="sm:col-span-3"><input name="description" defaultValue={t?.description ?? ""} className="input" /></Field>
      </div>
      <Field label="Steps" hint={`One per line: title | approver role | target days. Roles: ${APPROVER_ROLES.map((r) => r.value).join(", ")}.`}>
        <textarea name="steps" rows={5} required defaultValue={t ? t.steps.map((s) => `${s.title} | ${s.approver_role} | ${s.sla_days}`).join("\n") : "Document review | vendor_manager | 3\nCommercial terms | procurement_lead | 5\nFinal approval | executive | 2"} className="input font-mono text-xs" />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={t ? t.is_active : true} /> Active</label>
    </>
  );
}

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const tab = sp.tab === "templates" ? "templates" : "active";
  const supabase = await createClient();
  const [templates, instances, steps, suppliers] = await Promise.all([
    rows<WorkflowTemplate>(supabase, "workflow_templates", { order: "created_at", asc: true }),
    rows<WorkflowInstance>(supabase, "workflow_instances", { order: "started_at" }),
    rows<WorkflowStep>(supabase, "workflow_steps"),
    getSuppliers(supabase),
  ]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const list = instances.filter((w) => !sp.status || w.status === sp.status);
  const n = (st: string) => instances.filter((w) => w.status === st).length;
  return (
    <>
      <PageHead title="Workflows" sub="Multi-step approvals for a supplier. Each step needs the right role, and nobody approves two steps in a row." crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Workflows" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="In progress" value={n("in_progress")} />
        <Stat label="On hold" value={n("on_hold")} tone={n("on_hold") ? "warn" : undefined} />
        <Stat label="Completed" value={n("completed")} tone="ok" />
        <Stat label="Rejected" value={n("rejected")} />
      </section>
      <Tabs tabs={[{ key: "active", label: "Workflows", count: instances.length }, { key: "templates", label: "Templates", count: templates.length }]} active={tab} base="/assure/workflows" />
      {tab === "active" ? (
        <>
          <Chips param="status" options={WORKFLOW_STATUS.map((s) => ({ value: s.value, label: s.label, count: n(s.value) }))} active={sp.status} keep={{ status: sp.status }} />
          <div className="grid gap-3 md:grid-cols-2">
            {list.length === 0 && <Card><Empty title="No workflows here" /></Card>}
            {list.map((w) => {
              const ss = steps.filter((s) => s.instance_id === w.id).sort((a, b) => a.idx - b.idx);
              const approved = ss.filter((s) => s.status === "approved").length;
              const cur = ss.find((s) => s.idx === w.current_step);
              return (
                <Card key={w.id} className="space-y-2 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div><Link href={`/assure/workflows/${w.id}`} className="font-semibold hover:text-accent">{w.name}</Link><div className="text-xs"><SupplierLink id={w.supplier_id} name={name.get(w.supplier_id)} /></div></div>
                    <OptPill list={WORKFLOW_STATUS} value={w.status} />
                  </div>
                  <Bar value={ss.length ? (approved / ss.length) * 100 : 0} tone={w.status === "rejected" ? "bad" : "accent"} />
                  <p className="text-xs text-muted">{approved}/{ss.length} steps · {optLabel(PRIORITY, w.priority)} priority · started {formatDate(w.started_at)}</p>
                  {cur && w.status === "in_progress" && <p className="text-xs">Now: <b>{cur.name}</b> ({optLabel(APPROVER_ROLES, cur.approver_role)}){cur.due_date ? `, due ${formatDate(cur.due_date)}` : ""}</p>}
                </Card>
              );
            })}
          </div>
          <Panel title="Start a workflow">
            <div className="p-5">
              <ActionForm action={launchWorkflow} submit="Start" inline>
                <Field label="Workflow" className="min-w-[220px] flex-1"><select name="template_id" required className="input" defaultValue=""><option value="">Choose…</option>{templates.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                <Field label="Supplier" className="min-w-[220px] flex-1"><select name="supplier_id" required className="input" defaultValue=""><option value="">Choose…</option>{supplierOptions(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field label="Priority" className="w-36"><Select name="priority" options={PRIORITY} defaultValue="medium" /></Field>
              </ActionForm>
            </div>
          </Panel>
        </>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id} className="p-4 text-sm">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{t.name}</h3><div className="flex gap-1"><Pill tone="info">{optLabel(WORKFLOW_TYPES, t.workflow_type)}</Pill><Pill>v{t.version}</Pill>{!t.is_active && <Pill>Inactive</Pill>}</div></div>
                {t.description && <p className="text-muted">{t.description}</p>}
                <ol className="mt-2 list-decimal pl-5 text-xs">{t.steps.map((s, i) => <li key={i}>{s.title} <span className="text-muted">· {optLabel(APPROVER_ROLES, s.approver_role)} · {s.sla_days}d</span></li>)}</ol>
                <p className="mt-1 text-xs text-muted">{t.steps.reduce((a, s) => a + Number(s.sla_days), 0)} days end to end</p>
                <details className="mt-2"><summary className="cursor-pointer text-accent">Edit</summary>
                  <ActionForm action={saveWorkflowTemplate} submit="Save" hidden={{ id: t.id }} className="mt-2"><TemplateFields t={t} /></ActionForm></details>
              </Card>
            ))}
          </div>
          <Panel title="New workflow template"><div className="p-5"><ActionForm action={saveWorkflowTemplate} submit="Add template" resetOnOk><TemplateFields /></ActionForm></div></Panel>
        </>
      )}
    </>
  );
}
