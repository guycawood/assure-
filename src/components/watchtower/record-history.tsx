import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { canGovern, getAliases, getAudit, getLibraryDef, getRecords, type LibraryRecord } from "@/lib/library-data";
import { displayValue, schemaFor } from "@/modules/libraries";
import { formatDate, personName, timeAgo } from "@/lib/srt";
import { Card, PageHead, Panel, Pill, type Crumb } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE } from "./library-view";
import { AliasManager } from "./alias-manager";

const ACTION: Record<string, string> = {
  create: "Created", update: "Corrected", supersede: "New version", approve: "Approved", reject: "Rejected", retire: "Deactivated",
  reactivate: "Reactivated", delete: "Deleted", import: "Imported", alias_add: "Alias added", alias_toggle: "Alias changed",
};
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** All versions of a record (same code), the field-level audit trail, aliases and where it is used. */
export async function RecordHistory({ libraryKey, recordId, crumbs }: { libraryKey: string; recordId: string; crumbs: Crumb[] }) {
  await requireInternal();
  const supabase = await createClient();
  const [def, records, people] = await Promise.all([getLibraryDef(supabase, libraryKey), getRecords(supabase, libraryKey), getInternalPeople(supabase)]);
  const rec = records.find((r) => r.id === recordId);
  if (!def || !rec) notFound();
  const schema = schemaFor(libraryKey);
  // Walk the supersede chain both ways (codes can be null).
  const chain: LibraryRecord[] = [];
  let cur: LibraryRecord | undefined = rec;
  while (cur?.supersedes) cur = records.find((r) => r.id === cur!.supersedes);
  while (cur) { chain.push(cur); cur = cur.superseded_by ? records.find((r) => r.id === cur!.superseded_by) : undefined; }
  const ids = chain.map((r) => r.id);
  const [audit, aliases, governs, { data: refs }] = await Promise.all([
    getAudit(supabase, { recordIds: ids, limit: 1000 }),
    getAliases(supabase, libraryKey),
    canGovern(supabase, def.module),
    supabase.from("library_refs").select("record_id, ref_table, ref_id, ref_label").limit(10000),
  ]);
  const used = ((refs ?? []) as { record_id: string; ref_table: string; ref_id: string; ref_label: string | null }[]).filter((r) => ids.includes(r.record_id));
  const pMap = byId(people);

  return (
    <>
      <PageHead crumbs={crumbs} title={rec.name} sub={`${def.label}${rec.code ? ` · ${rec.code}` : ""}`} />
      <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Versions" sub="Each version applies from its effective date. Older versions stay on record for anything dated in their window.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Version</th><th className="th">Effective</th>{schema.fields.slice(0, 4).map((f) => <th key={f.key} className="th">{f.label}</th>)}<th className="th">Status</th></tr></thead>
              <tbody>
                {[...chain].reverse().map((r) => (
                  <tr key={r.id} className={r.id === rec.id ? "bg-accent-soft/40" : ""}>
                    <td className="td font-semibold">v{r.version}</td>
                    <td className="td whitespace-nowrap text-xs">{formatDate(r.effective_from)} → {r.effective_to ? formatDate(r.effective_to) : "now"}</td>
                    {schema.fields.slice(0, 4).map((f) => <td key={f.key} className="td">{displayValue(f, r.data[f.key])}</td>)}
                    <td className="td"><Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Where it's used" sub="Records that reference this entry. In-use entries can be deactivated but not deleted.">
            {used.length ? (
              <ul className="divide-y divide-line text-sm">{used.slice(0, 20).map((u) => <li key={u.ref_table + u.ref_id} className="px-5 py-2"><span className="text-muted">{u.ref_table}</span> · {u.ref_label ?? u.ref_id}</li>)}</ul>
            ) : <p className="px-5 py-4 text-sm text-muted">Not used yet.</p>}
          </Panel>
          <Panel title="Aliases" sub="Other names this entry is known by in source systems. Search matches them.">
            <AliasManager recordId={rec.id} aliases={aliases.filter((a) => ids.includes(a.record_id))} canGovern={governs} />
          </Panel>
        </div>
      </section>

      <Card className="p-5">
        <h2 className="mb-3 font-bold">Change history</h2>
        {audit.length === 0 ? <p className="text-sm text-muted">No changes recorded.</p> : (
          <ol className="space-y-4">
            {audit.map((a) => (
              <li key={a.id} className="border-l-2 border-line pl-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone={a.action === "reject" || a.action === "delete" ? "bad" : a.action === "approve" || a.action === "create" ? "ok" : "info"}>{ACTION[a.action] ?? a.action}</Pill>
                  <span className="font-semibold">{a.actor ? personName(pMap.get(a.actor)) : "System"}</span>
                  <span className="text-xs text-muted">{timeAgo(a.at)}</span>
                </div>
                {a.note && <p className="mt-1 text-sm text-muted">{a.note}</p>}
                {a.changes.length > 0 && (
                  <table className="mt-2 text-xs">
                    <tbody>
                      {a.changes.map((c, i) => (
                        <tr key={i}>
                          <td className="py-0.5 pr-3 font-semibold">{schema.fields.find((f) => f.key === c.field)?.label ?? c.field.replace(/_/g, " ")}</td>
                          <td className="py-0.5 pr-2 text-bad line-through">{show(c.before)}</td>
                          <td className="py-0.5 pr-2 text-muted">→</td>
                          <td className="py-0.5 text-ok">{show(c.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
