import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionButton } from "@/components/vendor/action-form";
import { completeTraining, startTraining } from "../actions";

export const metadata = { title: "Training" };

type Module = { id: string; title: string; resource_type: string; description: string | null; url: string | null; content: string | null; category: string; duration_minutes: number | null };
type Assignment = { id: string; module_id: string; due_date: string | null; status: string; completed_at: string | null };

export default async function TrainingPage() {
  await requireVendorCompany();
  const supabase = await createClient();
  const [mods, mine] = await Promise.all([
    rows<Module>(supabase.from("training_modules").select("id, title, resource_type, description, url, content, category, duration_minutes").order("display_order")),
    rows<Assignment>(supabase.from("training_assignments").select("id, module_id, due_date, status, completed_at")),
  ]);
  const byModule = new Map(mine.map((a) => [a.module_id, a]));
  const assigned = mods.filter((m) => byModule.has(m.id) && byModule.get(m.id)!.status !== "completed").length;

  return (
    <>
      <PageHead title="Training" sub={`Guides and videos for working with adm Indicia. Start a module, work through it, then mark it complete.${assigned ? ` ${assigned} in your list.` : ""}`} />
      {mods.length === 0 ? <Card><Empty title="No training available yet" /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mods.map((m) => {
            const a = byModule.get(m.id);
            return (
              <Card key={m.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><MSymbol name={m.resource_type === "video" ? "play_circle" : m.resource_type === "faq" ? "help" : "menu_book"} /></span>
                  <div className="min-w-0 flex-1"><p className="font-semibold">{m.title}</p><p className="text-xs text-muted">{m.category}{m.duration_minutes ? ` · ${m.duration_minutes} min` : ""}</p></div>
                  {a && <Pill tone={statusTone(a.status)}>{human(a.status)}</Pill>}
                </div>
                {m.description && <p className="text-sm text-muted">{m.description}</p>}
                {a?.due_date && a.status !== "completed" && <p className="text-xs">Due {formatDate(a.due_date)}</p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"><MSymbol name="open_in_new" size={16} /> Open</a>}
                  {(!a || a.status === "assigned") && <ActionButton action={startTraining} label="Start" hidden={{ module: m.id }} />}
                  {a?.status === "in_progress" && <ActionButton action={completeTraining} label="Mark complete" variant="primary" hidden={{ id: a.id }} />}
                  {a?.status === "completed" && <span className="text-xs text-ok">Completed {formatDate(a.completed_at)}</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
