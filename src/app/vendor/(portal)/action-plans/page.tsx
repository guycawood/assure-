import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate, today } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { addTask, setTaskStatus } from "../actions";

export const metadata = { title: "Action plans" };

type Task = { id: string; title: string; description: string | null; category: string; priority: string; due_date: string | null; source: string; status: string;
  progress_notes: string | null; completed_at: string | null; verified_at: string | null };

const COLUMNS = [
  { key: "open", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Done, waiting for adm Indicia" },
  { key: "verified", label: "Verified" },
];

export default async function ActionPlansPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const tasks = await rows<Task>(supabase.from("action_plan_tasks").select("id, title, description, category, priority, due_date, source, status, progress_notes, completed_at, verified_at").order("due_date", { ascending: true, nullsFirst: false }));
  const act = canAct(ctx.permission);

  return (
    <>
      <PageHead title="Action plans" sub="Improvement actions agreed with adm Indicia, and any you add yourself. Move them along as you work; when you mark one complete, adm Indicia verifies it.">
        {act && (
          <ActionDialog label="Add action" variant="primary" title="Add an improvement action" action={addTask} submit="Add">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="title">What will you do?</label><input id="title" name="title" required maxLength={200} className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="description">Details</label><textarea id="description" name="description" rows={3} maxLength={2000} className="input" /></div>
              <div><label className="label" htmlFor="category">Area</label>
                <select id="category" name="category" className="input" defaultValue="quality">{["quality", "delivery", "compliance", "cost", "sustainability", "other"].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></div>
              <div><label className="label" htmlFor="priority">Priority</label>
                <select id="priority" name="priority" className="input" defaultValue="medium">{["critical", "high", "medium", "low"].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></div>
              <div><label className="label" htmlFor="due">Due date</label><input id="due" name="due" type="date" min={today()} className="input" /></div>
            </div>
          </ActionDialog>
        )}
      </PageHead>
      {tasks.length === 0 ? <Card><Empty title="No actions yet" /></Card> : (
        <div className="grid gap-4 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">{col.label} ({list.length})</p>
                {list.map((t) => (
                  <Card key={t.id} className="space-y-2 p-4">
                    <p className="text-sm font-semibold">{t.title}</p>
                    {t.description && <p className="text-xs text-muted">{t.description}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      <Pill tone={statusTone(t.priority)}>{human(t.priority)}</Pill>
                      <Pill>{human(t.category)}</Pill>
                      {t.due_date && <Pill tone={t.due_date < today() && ["open", "in_progress"].includes(t.status) ? "bad" : "neutral"}>Due {formatDate(t.due_date)}</Pill>}
                    </div>
                    {t.progress_notes && <p className="text-xs"><b>Notes:</b> {t.progress_notes}</p>}
                    {act && t.status === "open" && <ActionButton action={setTaskStatus} label="Start" hidden={{ id: t.id, status: "in_progress" }} />}
                    {act && ["open", "in_progress"].includes(t.status) && (
                      <ActionDialog label="Mark complete" variant="primary" title="Mark complete" sub={t.title} action={setTaskStatus} hidden={{ id: t.id, status: "completed" }} submit="Mark complete">
                        <label className="label" htmlFor={`n-${t.id}`}>What was done?</label>
                        <textarea id={`n-${t.id}`} name="note" rows={3} maxLength={2000} className="input" />
                      </ActionDialog>
                    )}
                    {t.status === "completed" && <p className="text-xs text-muted">Completed {formatDate(t.completed_at)}. adm Indicia will verify it.</p>}
                  </Card>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
