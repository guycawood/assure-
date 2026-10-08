import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canGovern, getAliases, getLibraryDef, getRecords, getUsageCounts } from "@/lib/library-data";
import { displayValue, schemaFor } from "@/modules/libraries";
import { moduleByKey } from "@/modules/registry";
import { formatDate } from "@/lib/srt";
import { Card, Empty, PageHead, Pill, type Crumb } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { AddRecordButton, CsvTools, RecordActions } from "./library-actions-ui";

export type LibrarySearch = { q?: string; show?: string; sort?: string; dir?: string; group?: string; [k: string]: string | undefined };

export const STATUS_TONE = { active: "ok", pending_approval: "warn", superseded: "neutral", retired: "neutral", rejected: "bad" } as const;
export const STATUS_LABEL = { active: "Active", pending_approval: "Awaiting approval", superseded: "Superseded", retired: "Deactivated", rejected: "Rejected" } as const;

/** Generic governed-library screen (Base44 Watchtower mechanics): search, filters, sort, group, add, correct, new version, deactivate/delete, CSV, history. */
export async function LibraryView({ libraryKey, basePath, sp, crumbs }: { libraryKey: string; basePath: string; sp: LibrarySearch; crumbs: Crumb[] }) {
  const me = await requireInternal();
  const supabase = await createClient();
  const def = await getLibraryDef(supabase, libraryKey);
  if (!def) notFound();
  const schema = schemaFor(libraryKey);
  const [records, governs, aliases] = await Promise.all([getRecords(supabase, libraryKey), canGovern(supabase, def.module), getAliases(supabase, libraryKey)]);
  const usage = await getUsageCounts(supabase, records.map((r) => r.id));
  const aliasIndex = new Map<string, string[]>();
  for (const a of aliases) if (a.active) aliasIndex.set(a.record_id, [...(aliasIndex.get(a.record_id) ?? []), a.alias.toLowerCase()]);

  const show = sp.show ?? "current";
  const q = (sp.q ?? "").trim().toLowerCase();
  const filterFields = schema.fields.filter((f) => f.filter);
  let rows = records.filter((r) =>
    show === "all" ? true : show === "inactive" ? ["retired", "superseded", "rejected"].includes(r.status) : ["active", "pending_approval"].includes(r.status));
  if (q) rows = rows.filter((r) => [r.name, r.code ?? "", ...(aliasIndex.get(r.id) ?? [])].some((s) => s.toLowerCase().includes(q)));
  for (const f of filterFields) {
    const v = sp[`f_${f.key}`];
    if (v) rows = rows.filter((r) => String(r.data[f.key] ?? (f.type === "boolean" ? false : "")) === v);
  }
  const sortKey = sp.sort ?? "name";
  const dir = sp.dir === "desc" ? -1 : 1;
  const val = (r: (typeof rows)[number]) => sortKey === "name" ? r.name.toLowerCase() : sortKey === "code" ? (r.code ?? "") : sortKey === "usage" ? usage.get(r.id) ?? 0 : (r.data[sortKey] as string | number) ?? "";
  rows = [...rows].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
  const groupBy = sp.group === "1" && schema.groupBy ? schema.fields.find((f) => f.key === schema.groupBy) : undefined;
  const groups = groupBy
    ? [...new Set(rows.map((r) => String(r.data[groupBy.key] ?? "")))].map((g) => ({ label: displayValue(groupBy, g || null), rows: rows.filter((r) => String(r.data[groupBy.key] ?? "") === g) }))
    : [{ label: "", rows }];
  const columns = schema.fields.filter((f) => f.column);
  const m = moduleByKey(def.module);
  const pending = records.filter((r) => r.status === "pending_approval").length;
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };
  const sortLink = (k: string) => link({ sort: k, dir: sortKey === k && dir === 1 ? "desc" : undefined });

  return (
    <>
      <PageHead crumbs={crumbs} title={def.label} sub={def.description ?? undefined}>
        {governs && <CsvTools libraryKey={libraryKey} rows={records.filter((r) => r.status === "active").map((r) => ({ code: r.code, name: r.name, effective_from: r.effective_from, data: r.data }))} />}
        {governs && <AddRecordButton libraryKey={libraryKey} label={def.label} />}
      </PageHead>

      <div className="flex flex-wrap gap-2 text-xs">
        <Pill tone="info">{m?.name ?? def.module} library</Pill>
        {def.requires_approval && <Pill tone="warn">Changes need a second approver</Pill>}
        {pending > 0 && <Pill tone="warn">{pending} awaiting approval</Pill>}
        {!governs && <Pill>Read only: admins and module owners make changes</Pill>}
      </div>
      {schema.note && <p className="rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-muted">{schema.note}</p>}

      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3.5">
          <label className="min-w-[220px] flex-1 text-sm"><span className="label">Search</span>
            <input name="q" defaultValue={sp.q} placeholder="Name, code or alias" className="input" /></label>
          {filterFields.map((f) => (
            <label key={f.key} className="text-sm"><span className="label">{f.label}</span>
              <select name={`f_${f.key}`} defaultValue={sp[`f_${f.key}`] ?? ""} className="input">
                <option value="">All</option>
                {f.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></label>
          ))}
          <label className="text-sm"><span className="label">Show</span>
            <select name="show" defaultValue={show} className="input">
              <option value="current">Current</option><option value="inactive">History and deactivated</option><option value="all">All versions</option>
            </select></label>
          {schema.groupBy && (
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="group" value="1" defaultChecked={sp.group === "1"} /> Group</label>
          )}
          <button className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:bg-surface-2">Apply</button>
          <span className="ml-auto pb-2 text-xs text-muted">Showing {rows.length} of {records.length}</span>
        </form>

        {rows.length === 0 ? (
          <Empty title={records.length ? "Nothing matches these filters" : "No records yet"}>{governs && !records.length ? "Add the first record, or import a CSV." : null}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th"><Link href={sortLink("name")} className="hover:text-fg">{schema.nameLabel ?? "Name"}</Link></th>
                  {columns.map((c) => <th key={c.key} className="th"><Link href={sortLink(c.key)} className="hover:text-fg">{c.label}</Link></th>)}
                  <th className="th">Effective</th>
                  <th className="th"><Link href={sortLink("usage")} className="hover:text-fg">Used</Link></th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.label}>
                  {groupBy && <tr><td colSpan={columns.length + 4} className="bg-surface-2 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-muted">{g.label} · {g.rows.length}</td></tr>}
                  {g.rows.map((r) => (
                    <tr key={r.id} className={["retired", "superseded", "rejected"].includes(r.status) ? "opacity-60" : ""}>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{r.name}</span>
                          {r.version > 1 && <span className="rounded bg-surface-2 px-1.5 text-[0.68rem] font-bold text-muted">v{r.version}</span>}
                          {r.status !== "active" && <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>}
                        </div>
                        <span className="text-xs text-muted">{r.code}{aliasIndex.get(r.id)?.length ? ` · aka ${aliasIndex.get(r.id)!.join(", ")}` : ""}</span>
                      </td>
                      {columns.map((c) => <td key={c.key} className="td max-w-[280px] truncate" title={displayValue(c, r.data[c.key])}>{displayValue(c, r.data[c.key])}</td>)}
                      <td className="td whitespace-nowrap text-xs text-muted">{formatDate(r.effective_from)}{r.effective_to ? ` → ${formatDate(r.effective_to)}` : " →"}</td>
                      <td className="td tabular-nums">{usage.get(r.id) ?? 0}</td>
                      <td className="td">
                        <RecordActions libraryKey={libraryKey} rec={r} usage={usage.get(r.id) ?? 0} historyHref={`${basePath}/${r.id}`} canGovern={governs} me={me.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted"><MSymbol name="info" size={15} /> Corrections fix typos. New versions start from a date and keep the old version for anything dated before. Every change is recorded in the audit trail.</p>
    </>
  );
}
