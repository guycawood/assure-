import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { rows, supplierOptions } from "@/lib/assure-data";
import { isTaskOverdue, optLabel, PRIORITY, TASK_CATEGORY, TASK_STATUS, taskProgress, type Task } from "@/lib/assure";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Bar, Chips, Date_, OptPill, SupplierLink } from "@/components/assure/bits";
import { TaskForm, TaskMoves } from "@/components/assure/forms";

export const metadata: Metadata = { title: "Action plans" };

type SP = Promise<{ supplier?: string; priority?: string; category?: string }>;

// Supplier action-plan tasks as a board: open → in progress → completed → verified. Vendors see and complete their own;
// verification is staff-only and by someone other than whoever completed it.
export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [tasks, suppliers] = await Promise.all([rows<Task>(supabase, "action_plan_tasks", { order: "created_at" }), getSuppliers(supabase)]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const list = tasks.filter((t) => (!sp.supplier || t.supplier_id === sp.supplier) && (!sp.priority || t.priority === sp.priority) && (!sp.category || t.category === sp.category));
  const keep = { supplier: sp.supplier, priority: sp.priority, category: sp.category };
  const withTasks = suppliers.filter((s) => tasks.some((t) => t.supplier_id === s.id));

  return (
    <>
      <PageHead title="Action plans" sub="Improvement tasks agreed with suppliers. Vendors move their tasks to completed; staff verify." crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Action plans" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Open" value={list.filter((t) => t.status === "open" || t.status === "in_progress").length} />
        <Stat label="Overdue" value={list.filter((t) => isTaskOverdue(t)).length} tone="bad" />
        <Stat label="To verify" value={list.filter((t) => t.status === "completed").length} tone="warn" />
        <Card className="px-5 py-4"><p className="eyebrow">Complete</p><p className="mt-1 font-display text-[1.75rem] font-bold leading-none">{taskProgress(list)}%</p><div className="mt-2"><Bar value={taskProgress(list)} tone="ok" /></div></Card>
      </section>
      <Card className="flex flex-col gap-2 p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="min-w-[240px]"><span className="label">Supplier</span>
            <select name="supplier" defaultValue={sp.supplier ?? ""} className="input"><option value="">All suppliers</option>{withTasks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {sp.priority && <input type="hidden" name="priority" value={sp.priority} />}
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          <button className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg" type="submit">Show</button>
        </form>
        <Chips label="Priority:" param="priority" options={PRIORITY} active={sp.priority} keep={keep} />
        <Chips label="Category:" param="category" options={TASK_CATEGORY} active={sp.category} keep={keep} />
      </Card>
      <div className="grid gap-3 lg:grid-cols-4">
        {TASK_STATUS.map((col) => {
          const items = list.filter((t) => t.status === col.value);
          return (
            <section key={col.value} className="min-w-0 rounded-xl border border-line bg-surface-2/50 p-2">
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-bold">{col.label}<span className="text-xs text-muted">{items.length}</span></h2>
              <div className="space-y-2">
                {items.map((t) => (
                  <Card key={t.id} className="space-y-1.5 p-3 text-sm">
                    <p className="font-semibold">{t.title}</p>
                    <p className="text-xs"><SupplierLink id={t.supplier_id} name={name.get(t.supplier_id)} tab="tasks" /></p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <OptPill list={PRIORITY} value={t.priority} /><span className="text-muted">{optLabel(TASK_CATEGORY, t.category)}</span>
                      {t.due_date && <span className="text-muted">· due <Date_ d={t.due_date} /></span>}
                      {isTaskOverdue(t) && <Pill tone="bad">Overdue</Pill>}
                    </div>
                    {t.progress_notes && <p className="text-xs text-muted">{t.progress_notes}</p>}
                    <TaskMoves task={t} />
                  </Card>
                ))}
                {items.length === 0 && <p className="px-1 py-3 text-xs text-muted">Nothing here.</p>}
              </div>
            </section>
          );
        })}
      </div>
      <Panel title="Add a task"><div className="p-5"><TaskForm suppliers={supplierOptions(suppliers)} /></div></Panel>
    </>
  );
}
