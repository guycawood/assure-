"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { exportCsvNow, loadTableCsv, resetDemoData, type Result } from "./actions";

/** Demo data store controls: CSV mirror, load a table from CSV, reset. Admins only. */
export function DemoStoreControls({ tables }: { tables: string[] }) {
  const [table, setTable] = useState(tables[0] ?? "");
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) => start(async () => setMsg(await fn()));
  return (
    <div className="space-y-3 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <button disabled={pending} onClick={() => run(exportCsvNow)} className={btn.secondary}><MSymbol name="download" size={18} /> Write CSVs now</button>
        <label className="ml-2"><span className="label">Load a table from its CSV</span>
          <select value={table} onChange={(e) => setTable(e.target.value)} className="input w-64">{tables.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <button disabled={pending || !table} onClick={() => { if (confirm(`Load .demo-data/csv/${table}.csv? Rows are added or updated by their ID.`)) run(() => loadTableCsv(table)); }} className={btn.secondary}><MSymbol name="upload" size={18} /> Load CSV</button>
        <button disabled={pending} onClick={() => { if (confirm("Reset all demo data back to the starting set? Everything recorded will be lost.")) run(resetDemoData); }} className={`${btn.danger} ml-auto`}><MSymbol name="restart_alt" size={18} /> Reset demo data</button>
      </div>
      {pending && <p className="text-muted">Working…</p>}
      {msg && <p className={`rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.message}</p>}
    </div>
  );
}
