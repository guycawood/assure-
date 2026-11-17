import { createClient } from "@/lib/supabase/server";
import { Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { decideTable, uploadClientTable, withdrawTable } from "@/app/(platform)/crm/clients/table-actions";

type Sample = string | { key: string; value: number; from?: string; to?: string };
type Tbl = {
  id: string; key: string; kind: "list" | "lookup"; title: string; versions: number;
  live: { id: string; version: number; row_count: number; published_at: string; note: string | null; file_name: string | null; uploaded_by: string | null; sample: Sample[] } | null;
  pending: { id: string; version: number; row_count: number; added: number; removed: number; changed: number; note: string | null; file_name: string | null; uploaded_by: string; uploaded_by_name: string | null; uploaded_at: string } | null;
};
type Diff = { added: Sample[]; removed: Sample[]; changed: { key: string; from: string | null; was: number; now: number }[]; added_total: number; removed_total: number; changed_total: number };
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const show = (s: Sample) => (typeof s === "string" ? s : `${s.key} = ${s.value}${s.from || s.to ? ` (${s.from ?? "…"} to ${s.to ?? "…"})` : ""}`);

// A client's fee schedules and exception lists. Uploaded from a file; a different CRM owner approves each upload before checks use it.
export async function ClientTables({ clientId, meId, canApprove }: { clientId: string; meId: string; canApprove: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crm_client_tables", { p_client: clientId });
  const tables = (data as Tbl[] | null) ?? [];
  const diffs = new Map<string, Diff>();
  await Promise.all(tables.filter((t) => t.pending).map(async (t) => { const r = await supabase.rpc("crm_table_diff", { p_version: t.pending!.id }); if (r.data) diffs.set(t.pending!.id, r.data as Diff); }));
  const hidden = { client_id: clientId };

  return (
    <Panel title={`Fee schedules and lists (${tables.length})`} sub="Upload a table from Excel or CSV and name it in a rule. Each upload is a new version; checks use the live one, and every run records which version it read.">
      {tables.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No tables yet. Upload the first one below.</p> : (
        <ul className="divide-y divide-line text-sm">
          {tables.map((t) => (
            <li key={t.id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <b>{t.title}</b><code className="rounded bg-surface-2 px-1.5 text-xs">{t.key}</code><Pill>{t.kind === "list" ? "List" : "Fee or value lookup"}</Pill>
                {t.live ? <Pill tone="ok">Live: version {t.live.version}, {t.live.row_count.toLocaleString("en-GB")} rows, since {day(t.live.published_at)}</Pill> : <Pill tone="warn">Not live yet</Pill>}
              </div>
              {t.live && <p className="text-xs text-muted">{t.live.sample.map(show).join(" · ")}{t.live.row_count > t.live.sample.length ? " …" : ""}{t.live.uploaded_by ? ` · uploaded by ${t.live.uploaded_by}` : ""}{t.live.file_name ? ` from ${t.live.file_name}` : ""}</p>}
              {t.pending && (
                <div className="space-y-2 rounded-xl bg-warn-soft p-3">
                  <p><b>Version {t.pending.version} is waiting for approval.</b> {t.pending.uploaded_by_name ?? "A colleague"} uploaded {t.pending.row_count.toLocaleString("en-GB")} rows on {day(t.pending.uploaded_at)}: {t.pending.note}</p>
                  <p className="text-xs">{t.live ? `Compared with the live version: ${t.pending.added} added, ${t.pending.removed} removed${t.kind === "lookup" ? `, ${t.pending.changed} changed` : ""}.` : "It would be the first live version."}</p>
                  {diffs.get(t.pending.id) && (diffs.get(t.pending.id)!.added.length + diffs.get(t.pending.id)!.removed.length + diffs.get(t.pending.id)!.changed.length > 0) && t.live && (
                    <details className="text-xs"><summary className="cursor-pointer font-semibold text-accent">See what changed</summary>
                      <div className="mt-2 grid gap-3 md:grid-cols-3">
                        <div><p className="font-semibold">Added ({diffs.get(t.pending.id)!.added_total})</p>{diffs.get(t.pending.id)!.added.map((x, i) => <p key={i}>{show(x)}</p>)}</div>
                        <div><p className="font-semibold">Removed ({diffs.get(t.pending.id)!.removed_total})</p>{diffs.get(t.pending.id)!.removed.map((x, i) => <p key={i}>{show(x)}</p>)}</div>
                        {t.kind === "lookup" && <div><p className="font-semibold">Changed ({diffs.get(t.pending.id)!.changed_total})</p>{diffs.get(t.pending.id)!.changed.map((x, i) => <p key={i}>{x.key}{x.from ? ` from ${x.from}` : ""}: {x.was} to {x.now}</p>)}</div>}
                      </div>
                    </details>
                  )}
                  {t.pending.uploaded_by === meId ? (
                    <ActionForm action={withdrawTable} hidden={{ ...hidden, id: t.pending.id }} submit="Withdraw" variant="secondary" inline />
                  ) : canApprove ? (
                    <div className="flex flex-wrap items-start gap-4">
                      <ActionForm action={decideTable} hidden={{ ...hidden, id: t.pending.id, decision: "approve" }} submit="Approve" inline><input name="note" aria-label="Note" placeholder="Note (optional)" className="input min-w-[200px] py-1.5" /></ActionForm>
                      <ActionForm action={decideTable} hidden={{ ...hidden, id: t.pending.id, decision: "reject" }} submit="Send back" variant="secondary" inline><input name="note" required aria-label="Reason" placeholder="Reason (needed)" className="input min-w-[200px] py-1.5" /></ActionForm>
                    </div>
                  ) : <p className="text-xs text-muted">Waiting for a CRM owner to approve it.</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line p-5">
        <h3 className="mb-1 font-display text-base font-semibold">Upload a table</h3>
        <p className="mb-3 text-sm text-muted">A <b>lookup</b> (a fee schedule) needs a key column and a value column, for example <i>Country</i> and <i>Fee %</i>, and can have <i>Valid from</i> and <i>Valid to</i> dates so a change on a date does not lose the old rows. A <b>list</b> (exceptions) needs one column of values, for example job references. Upload the whole table each time: it replaces the live version once approved.</p>
        <ActionForm action={uploadClientTable} hidden={hidden} submit="Upload for approval" variant="secondary">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Table name" htmlFor="tkey" hint="Rules refer to it by this name."><input id="tkey" name="key" list="table-keys" required className="input" placeholder="fee_by_country" /><datalist id="table-keys">{tables.map((t) => <option key={t.id} value={t.key}>{t.title}</option>)}</datalist></Field>
            <Field label="Title (new tables)" htmlFor="ttitle"><input id="ttitle" name="title" className="input" placeholder="Fee by country" /></Field>
            <Field label="Kind" htmlFor="tkind"><select id="tkind" name="kind" className="input"><option value="lookup">Fee or value lookup</option><option value="list">List</option></select></Field>
            <Field label="Sheet (Excel only)" htmlFor="tsheet"><input id="tsheet" name="sheet" className="input" placeholder="Optional" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="File (Excel or CSV)" htmlFor="tfile"><input id="tfile" name="file" type="file" required accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="input" /></Field>
            <Field label="What this is and where it comes from" htmlFor="tnote"><input id="tnote" name="note" required className="input" placeholder="July fee schedule agreed with the client" /></Field>
          </div>
        </ActionForm>
      </div>
    </Panel>
  );
}
