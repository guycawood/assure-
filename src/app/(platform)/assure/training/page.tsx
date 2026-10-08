import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import { rows } from "@/lib/assure-data";
import { trainingStatus, TRAINING_STATUS } from "@/lib/assure";
import { personName } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { Bar, Date_, OptPill, Tabs } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { assignTraining, saveTrainingModule, startTraining, trainingProgress } from "../srm-actions";

export const metadata: Metadata = { title: "Training" };

type Mod = { id: string; title: string; resource_type: string; description: string | null; url: string | null; content: string | null; category: string; audience: string; duration_minutes: number | null; display_order: number; active: boolean };
type Asg = { id: string; module_id: string; user_id: string; due_date: string | null; status: string; started_at: string | null; completed_at: string | null };

function ModuleFields({ m }: { m?: Mod }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Title" className="sm:col-span-2"><input name="title" required defaultValue={m?.title} className="input" /></Field>
        <Field label="Type"><Select name="resource_type" options={[{ value: "document", label: "Walkthrough" }, { value: "video", label: "Video" }, { value: "faq", label: "FAQ" }]} defaultValue={m?.resource_type ?? "document"} /></Field>
        <Field label="Audience"><Select name="audience" options={[{ value: "all", label: "Everyone" }, { value: "internal", label: "adm Indicia staff" }, { value: "vendor", label: "Vendors" }]} defaultValue={m?.audience ?? "all"} /></Field>
        <Field label="Category"><input name="category" defaultValue={m?.category ?? "General"} className="input" /></Field>
        <Field label="Minutes"><input name="duration_minutes" type="number" min={1} defaultValue={m?.duration_minutes ?? ""} className="input" /></Field>
        <Field label="Order"><input name="display_order" type="number" defaultValue={m?.display_order ?? 0} className="input" /></Field>
        <Field label="Link (https only)"><input name="url" defaultValue={m?.url ?? ""} className="input" placeholder="https://" /></Field>
      </div>
      <Field label="Summary"><input name="description" defaultValue={m?.description ?? ""} className="input" /></Field>
      <Field label="Content (walkthrough text or FAQ answer)"><textarea name="content" rows={3} defaultValue={m?.content ?? ""} className="input" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={m ? m.active : true} /> Active</label>
    </>
  );
}

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const tab = ["library", "mine", "tracker"].includes(sp.tab ?? "") ? sp.tab! : "library";
  const supabase = await createClient();
  const [mods, asg, people] = await Promise.all([
    rows<Mod>(supabase, "training_modules", { order: "display_order", asc: true }),
    rows<Asg>(supabase, "training_assignments"),
    getInternalPeople(supabase),
  ]);
  const modName = new Map(mods.map((m) => [m.id, m.title]));
  const mine = asg.filter((a) => a.user_id === me.id);
  const canAssign = me.is_admin || me.srt_role === "lead";
  const st = (a: Asg) => trainingStatus(a);
  const categories = [...new Set(mods.filter((m) => m.active).map((m) => m.category))];

  return (
    <>
      <PageHead title="Training" sub="Walkthroughs, videos and FAQs, plus who has completed what. Start a module before marking it complete." crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Training" }]} />
      <Tabs tabs={[{ key: "library", label: "Library", count: mods.filter((m) => m.active).length }, { key: "mine", label: "My progress", count: mine.length }, { key: "tracker", label: "Team tracker" }]} active={tab} base="/assure/training" />

      {tab === "library" && (
        <>
          {categories.length === 0 && <Card><Empty title="No training yet" /></Card>}
          {categories.map((cat) => (
            <section key={cat}>
              <h2 className="mb-2 font-display text-base font-bold">{cat}</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {mods.filter((m) => m.active && m.category === cat).map((m) => {
                  const a = mine.find((x) => x.module_id === m.id);
                  return (
                    <Card key={m.id} className="space-y-2 p-4 text-sm">
                      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{m.title}</h3><Pill tone="info">{m.resource_type === "faq" ? "FAQ" : m.resource_type === "video" ? "Video" : "Walkthrough"}</Pill></div>
                      {m.description && <p className="text-muted">{m.description}</p>}
                      {m.content && <p className="line-clamp-4 whitespace-pre-wrap">{m.content}</p>}
                      {m.url && /^https:\/\//i.test(m.url) && <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">Open {m.resource_type === "video" ? "video" : "document"}</a>}
                      <p className="text-xs text-muted">{m.duration_minutes ? `${m.duration_minutes} min · ` : ""}{m.audience === "vendor" ? "For vendors" : m.audience === "internal" ? "Staff only" : "Everyone"}</p>
                      {a ? <OptPill list={TRAINING_STATUS} value={st(a)} /> : <ActionForm action={startTraining} submit="Start" hidden={{ module_id: m.id }} variant="secondary" inline />}
                      {me.is_admin && <details><summary className="cursor-pointer text-xs text-accent">Edit</summary><ActionForm action={saveTrainingModule} submit="Save" hidden={{ id: m.id }} className="mt-2"><ModuleFields m={m} /></ActionForm></details>}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
          {me.is_admin && <Panel title="Add a training module"><div className="p-5"><ActionForm action={saveTrainingModule} submit="Add module" resetOnOk><ModuleFields /></ActionForm></div></Panel>}
        </>
      )}

      {tab === "mine" && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Stat label="Enrolled" value={mine.length} />
            <Stat label="Completed" value={mine.filter((a) => ["completed", "waived"].includes(a.status)).length} tone="ok" />
            <Stat label="Pending" value={mine.filter((a) => ["assigned", "in_progress"].includes(st(a))).length} />
            <Stat label="Overdue" value={mine.filter((a) => st(a) === "overdue").length} tone="bad" />
          </section>
          <Card>
            {mine.length === 0 ? <Empty title="Nothing assigned to you">Start any module from the library.</Empty> : (
              <table className="w-full text-sm">
                <thead><tr>{["Module", "Due", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {mine.map((a) => (
                    <tr key={a.id}>
                      <td className="td font-semibold">{modName.get(a.module_id)}</td>
                      <td className="td"><Date_ d={a.due_date} /></td>
                      <td className="td"><OptPill list={TRAINING_STATUS} value={st(a)} /></td>
                      <td className="td">
                        {a.status === "assigned" && <ActionForm action={trainingProgress} submit="Start" hidden={{ id: a.id, status: "in_progress" }} variant="secondary" inline />}
                        {a.status === "in_progress" && <ActionForm action={trainingProgress} submit="Mark complete" hidden={{ id: a.id, status: "completed" }} inline />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === "tracker" && (
        <>
          <Card className="overflow-x-auto">
            {people.length === 0 ? <Empty title="No staff" /> : (
              <table className="w-full text-sm">
                <thead><tr>{["Person", "Assigned", "Completed", "Pending", "Overdue", "Progress", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {people.map((p) => {
                    const list = asg.filter((a) => a.user_id === p.id);
                    const done = list.filter((a) => ["completed", "waived"].includes(a.status)).length;
                    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
                    return (
                      <tr key={p.id} className="align-top">
                        <td className="td"><b>{personName(p)}</b><div className="text-xs text-muted">{p.email}</div></td>
                        <td className="td tabular-nums">{list.length}</td>
                        <td className="td tabular-nums">{done}</td>
                        <td className="td tabular-nums">{list.filter((a) => ["assigned", "in_progress"].includes(st(a))).length}</td>
                        <td className="td tabular-nums text-bad">{list.filter((a) => st(a) === "overdue").length || ""}</td>
                        <td className="td w-40">{list.length ? <><Bar value={pct} tone={pct === 100 ? "ok" : "accent"} /><span className="text-xs text-muted">{pct}%</span></> : <span className="text-xs text-muted">—</span>}</td>
                        <td className="td">
                          {list.length > 0 && (
                            <details><summary className="cursor-pointer text-xs text-accent">Details</summary>
                              <ul className="mt-1 space-y-1 text-xs">
                                {list.map((a) => (
                                  <li key={a.id} className="flex flex-wrap items-center gap-1.5">{modName.get(a.module_id)} <OptPill list={TRAINING_STATUS} value={st(a)} />
                                    {me.is_admin && !["completed", "waived"].includes(a.status) && (
                                      <ActionForm action={trainingProgress} submit="Waive" hidden={{ id: a.id, status: "waived" }} variant="danger" inline>
                                        <input name="reason" required className="input w-36 py-1 text-xs" placeholder="Why" aria-label="Waive reason" />
                                      </ActionForm>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          {canAssign && (
            <Panel title="Assign training" sub="People who already have the module are skipped.">
              <div className="p-5">
                <ActionForm action={assignTraining} submit="Assign">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Module"><select name="module_id" required className="input" defaultValue=""><option value="">Choose…</option>{mods.filter((m) => m.active && m.audience !== "vendor").map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></Field>
                    <Field label="Due"><input name="due_date" type="date" className="input" /></Field>
                  </div>
                  <fieldset><legend className="label">People</legend>
                    <div className="grid gap-1 sm:grid-cols-3">{people.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="users" value={p.id} /> {personName(p)}</label>)}</div>
                  </fieldset>
                </ActionForm>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
