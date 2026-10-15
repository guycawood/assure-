"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { IMPORT_FIELDS, defaultMapping, mapRows, parseCsv, type ImportKind } from "@/lib/crm-import";
import type { ImportReport } from "@/lib/crm";
import { runImport } from "@/app/(platform)/crm/actions";

const KINDS: { value: ImportKind; label: string }[] = [
  { value: "companies", label: "Companies" }, { value: "contacts", label: "Contacts" }, { value: "deals", label: "Deals" },
  { value: "performance", label: "Client Stakeholder Performance" },
];

/** HubSpot CSV import: read the file in the browser, map columns (HubSpot headers pre-mapped), dry run, then apply all-or-nothing. */
export function ImportWizard() {
  const [kind, setKind] = useState<ImportKind>("contacts");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [cells, setCells] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [onDup, setOnDup] = useState("skip");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = async (file: File | undefined, k = kind) => {
    setReport(null); setError(null);
    if (!file) return;
    if (file.size > 5_000_000) { setError("The file is over 5 MB. Split it and import in parts."); return; }
    const grid = parseCsv(await file.text());
    if (grid.length < 2) { setError("The file has no data rows."); return; }
    setFileName(file.name); setHeaders(grid[0]); setCells(grid.slice(1)); setMapping(defaultMapping(k, grid[0]));
  };
  const run = (dryRun: boolean) => start(async () => {
    setError(null);
    const res = await runImport(kind, mapRows(cells, headers, mapping), dryRun, fileName, mapping, onDup);
    if ("error" in res && res.error) { setError(res.error); if (!dryRun) setReport(null); return; }
    setReport((res as { report: ImportReport }).report);
  });
  const missing = IMPORT_FIELDS[kind].filter((f) => f.required && !Object.values(mapping).includes(f.key));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="label">What are you importing?</span>
          <select className="input" value={kind} onChange={(e) => { const k = e.target.value as ImportKind; setKind(k); setMapping(defaultMapping(k, headers)); setReport(null); }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select></label>
        <label className="block"><span className="label">HubSpot export (CSV)</span>
          <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => load(e.target.files?.[0])} /></label>
        <label className="block"><span className="label">When a record already exists</span>
          <select className="input" value={onDup} onChange={(e) => setOnDup(e.target.value)}>
            <option value="skip">Skip it</option><option value="update">Fill in blanks and keep the HubSpot ID</option>
          </select></label>
      </div>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      {headers.length > 0 && (
        <>
          <p className="text-sm text-muted">{fileName}: {cells.length} rows. Check the column mapping (HubSpot&apos;s default headers are matched for you):</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {headers.map((h) => (
              <label key={h} className="flex items-center gap-2 text-sm">
                <span className="w-40 truncate font-semibold" title={h}>{h}</span>
                <select className="input" value={mapping[h] ?? ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                  <option value="">Ignore</option>
                  {IMPORT_FIELDS[kind].map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && <p className="text-sm text-warn">Map a column to: {missing.map((m) => m.label).join(", ")}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.secondary} disabled={pending || missing.length > 0} onClick={() => run(true)}>{pending ? "Checking…" : "Dry run (writes nothing)"}</button>
            <button type="button" className={btn.primary} disabled={pending || missing.length > 0 || !report || report.applied || report.errors.length > 0}
              onClick={() => { if (window.confirm(`Import ${report?.create ?? 0} new and ${report?.update ?? 0} updated records? All or nothing.`)) run(false); }}>Import</button>
          </div>
        </>
      )}
      {report && (
        <div className="space-y-2 rounded-xl border border-line p-4 text-sm">
          <p className="font-semibold">{report.applied ? "Imported" : "Dry run"}: {report.rows} rows · {report.create} new · {report.update} to update · {report.skip} skipped · {report.errors.length} errors</p>
          {report.errors.length > 0 && <div><p className="font-semibold text-bad">Fix these first (nothing is imported while any row has an error):</p>
            <ul className="list-disc pl-5 text-bad">{report.errors.slice(0, 50).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul></div>}
          {report.duplicates.length > 0 && <div><p className="font-semibold">Already in CRM:</p>
            <ul className="list-disc pl-5 text-muted">{report.duplicates.slice(0, 50).map((d) => <li key={d.row}>Row {d.row}: matches {d.match} (by {d.reason})</li>)}</ul></div>}
          {report.warnings.length > 0 && <ul className="list-disc pl-5 text-warn">{report.warnings.slice(0, 30).map((w, i) => <li key={i}>Row {w.row}: {w.message}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
