"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { MSymbol } from "@/components/symbol";
import { btn } from "@/components/ui";
import { schemaFor } from "@/modules/libraries";
import { RecordForm, type FormMode } from "./record-form";
import {
  approveRecord, createRecord, deleteRecord, importRecords, reactivateRecord, retireRecord, supersedeRecord, updateRecord, type Result,
} from "@/app/(platform)/watchtower/library-actions";

type Rec = { id: string; code: string | null; name: string; data: Record<string, unknown>; status: string; notes: string | null; created_by: string | null };

export function AddRecordButton({ libraryKey, label }: { libraryKey: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={btn.primary}><MSymbol name="add" size={18} /> Add</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add to ${label}`} wide>
        <RecordForm libraryKey={libraryKey} mode="create" onSubmit={(i) => createRecord(libraryKey, i)} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

/** Per-row actions. In-use records can only be deactivated; unused ones can also be deleted. */
export function RecordActions({ libraryKey, rec, usage, historyHref, canGovern, me }: { libraryKey: string; rec: Rec; usage: number; historyHref: string; canGovern: boolean; me: string }) {
  const [mode, setMode] = useState<FormMode | "retire" | "delete" | "reactivate" | "approve" | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const close = () => { setMode(null); setNote(""); setMsg(null); };
  const run = (fn: () => Promise<Result>) => start(async () => { const r = await fn(); setMsg(r); if (r.ok) close(); });

  const icon = (name: string, title: string, onClick: () => void) => (
    <button onClick={onClick} title={title} aria-label={title} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
      <MSymbol name={name} size={18} />
    </button>
  );

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link href={historyHref} title="History and versions" aria-label="History and versions" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><MSymbol name="history" size={18} /></Link>
      {canGovern && rec.status === "pending_approval" && rec.created_by !== me && icon("task_alt", "Approve or reject", () => setMode("approve"))}
      {canGovern && (rec.status === "active" || rec.status === "pending_approval") && icon("edit", "Correct", () => setMode("update"))}
      {canGovern && rec.status === "active" && icon("difference", "New version from a date", () => setMode("supersede"))}
      {canGovern && rec.status === "active" && icon(usage > 0 ? "block" : "delete", usage > 0 ? "Deactivate (in use)" : "Deactivate or delete", () => setMode(usage > 0 ? "retire" : "delete"))}
      {canGovern && rec.status === "retired" && icon("settings_backup_restore", "Reactivate", () => setMode("reactivate"))}

      <Modal open={mode === "update" || mode === "supersede"} onClose={close} title={mode === "update" ? `Correct ${rec.name}` : `New version of ${rec.name}`} wide>
        {(mode === "update" || mode === "supersede") && (
          <RecordForm libraryKey={libraryKey} mode={mode} initial={rec}
            onSubmit={(i) => (mode === "update" ? updateRecord(libraryKey, rec.id, i) : supersedeRecord(libraryKey, rec.id, i))} onDone={close} />
        )}
      </Modal>

      <Modal open={mode === "retire" || mode === "delete" || mode === "reactivate" || mode === "approve"} onClose={close}
        title={mode === "approve" ? `Review ${rec.name}` : mode === "reactivate" ? `Reactivate ${rec.name}` : mode === "retire" ? `Deactivate ${rec.name}` : `Remove ${rec.name}`}>
        <div className="space-y-3 text-sm">
          {mode === "retire" && <p>This record is used in <b>{usage}</b> place{usage === 1 ? "" : "s"}, so it can&apos;t be deleted. Deactivating keeps existing references working and stops it being chosen for new work.</p>}
          {mode === "delete" && <p>Nothing uses this record. You can deactivate it (kept for the record) or delete it permanently.</p>}
          {mode === "approve" && <p>This change needs a second person. Approving makes it live{schemaFor(libraryKey) ? "" : ""}; rejecting needs a reason.</p>}
          <label className="block"><span className="label">Note{mode === "approve" ? " (required to reject)" : ""}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input" /></label>
          {msg && !msg.ok && <p className="rounded-lg bg-bad-soft px-3 py-2 text-bad">{msg.message}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={close} className={btn.secondary}>Cancel</button>
            {mode === "approve" && <>
              <button disabled={pending} onClick={() => run(() => approveRecord(rec.id, false, note))} className={btn.danger}>Reject</button>
              <button disabled={pending} onClick={() => run(() => approveRecord(rec.id, true, note))} className={btn.primary}>Approve</button>
            </>}
            {(mode === "retire" || mode === "delete") && <button disabled={pending} onClick={() => run(() => retireRecord(rec.id, note))} className={btn.secondary}>Deactivate</button>}
            {mode === "delete" && <button disabled={pending} onClick={() => run(() => deleteRecord(rec.id, note))} className={btn.danger}>Delete permanently</button>}
            {mode === "reactivate" && <button disabled={pending} onClick={() => run(() => reactivateRecord(rec.id, note))} className={btn.primary}>Reactivate</button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---- CSV ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function CsvTools({ libraryKey, rows }: { libraryKey: string; rows: { code: string | null; name: string; effective_from: string; data: Record<string, unknown> }[] }) {
  const schema = schemaFor(libraryKey);
  const cols = ["code", "name", "effective_from", ...schema.fields.map((f) => f.key)];
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  const exportCsv = () => {
    const lines = [cols.join(","), ...rows.map((r) => [r.code, r.name, r.effective_from, ...schema.fields.map((f) => r.data[f.key])].map(esc).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${libraryKey}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const onFile = (file: File) => {
    file.text().then((text) => {
      const grid = parseCsv(text.replace(/^﻿/, ""));
      const head = (grid[0] ?? []).map((h) => h.trim());
      const missing = ["name", ...schema.fields.filter((f) => f.required).map((f) => f.key)].filter((k) => !head.includes(k));
      if (missing.length) { setMsg({ ok: false, message: `Missing columns: ${missing.join(", ")}` }); return; }
      const objs = grid.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
      start(async () => setMsg(await importRecords(libraryKey, objs)));
    });
  };

  return (
    <>
      <button onClick={exportCsv} className={btn.secondary}><MSymbol name="download" size={18} /> Export</button>
      <button onClick={() => setOpen(true)} className={btn.secondary}><MSymbol name="upload" size={18} /> Import</button>
      <Modal open={open} onClose={() => { setOpen(false); setMsg(null); }} title="Import from CSV" sub="Every row is checked first. If any row has a problem, nothing is imported.">
        <div className="space-y-3 text-sm">
          <p>Columns: <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{cols.join(", ")}</code>. Lists use semicolons. Tip: export first to get the right layout.</p>
          <input type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="block w-full text-sm" />
          {pending && <p className="text-muted">Checking and importing…</p>}
          {msg && <p className={`rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.message}</p>}
        </div>
      </Modal>
    </>
  );
}
