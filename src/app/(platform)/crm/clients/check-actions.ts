"use server";

import { createHash } from "node:crypto";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id as uuidField, str } from "@/lib/sourcing-actions";
import { annotate, runChecks, validateRuleset, type Approval, type Ruleset, type Summary, type TableData } from "@/lib/savings-check/engine";
import { gridToTable, parseTable, toCsv, type Table } from "@/lib/savings-check/file";
import { pickSheet, readWorkbook } from "@/lib/savings-check/xlsx";

// Runs a client's live rule set on an uploaded savings file. The file is read in memory and never stored: only the summary is kept.
const MAX_BYTES = 8 * 1024 * 1024, MAX_ROWS = 20000, SHOW = 300;

export type CheckState = {
  error?: string;
  result?: {
    version: number; file_name: string; rows: number; summary: Summary; saved: boolean;
    flagged: { index: number; label: string; approval: Approval; comment: string }[]; flagged_total: number; csv: string; download_name: string;
    sheet: string | null; sheet_names: string[];
  };
};

type Version = { id: string; version: number; status: string; doc: Ruleset };

export async function runSavingsCheck(_: CheckState, fd: FormData): Promise<CheckState> {
  await requireInternal();
  const clientId = uuidField(fd, "client_id");
  if (!clientId) return { error: "Client not found." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the savings file." };
  if (file.size > MAX_BYTES) return { error: "The file is over 8 MB. Split it, or remove columns the checks do not use." };
  if (/\.(xls|xlsb)$/i.test(file.name)) return { error: "This is an older Excel format. In Excel choose File, Save as, and pick Excel Workbook (.xlsx) or CSV UTF-8, then upload that." };
  const bytes = Buffer.from(await file.arrayBuffer());
  let table: Table, sheetUsed: string | null = null, sheetNames: string[] = [];
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    let sheets;
    try { sheets = await readWorkbook(bytes); } catch { return { error: "That Excel file could not be read. Check it opens in Excel, or save it as CSV UTF-8 and upload that." }; }
    sheetNames = sheets.map((s) => s.sheet);
    const picked = pickSheet(sheets, str(fd, "sheet"));
    if ("error" in picked) return { error: picked.error };
    sheetUsed = picked.sheet.sheet;
    table = gridToTable(picked.sheet.data);
  } else {
    table = parseTable(bytes.toString("utf8"));
  }
  if (table.headers.length === 0 || table.rows.length === 0) return { error: `${sheetUsed ? `The sheet "${sheetUsed}"` : "The file"} has no rows. The first row must be the column headings.` };
  if (table.rows.length > MAX_ROWS) return { error: `The file has ${table.rows.length.toLocaleString("en-GB")} rows. The limit is ${MAX_ROWS.toLocaleString("en-GB")}.` };

  const supabase = await createClient();
  const { data } = await supabase.rpc("crm_rulesets", { p_client: clientId });
  const live = ((data as Version[] | null) ?? []).find((v) => v.status === "published");
  if (!live) return { error: "This client has no live rules yet. Get a rule set approved first." };
  const tablesRes = await supabase.rpc("crm_client_tables_published", { p_client: clientId });
  const tables = (tablesRes.data as Record<string, TableData> | null) ?? {};
  const problems = validateRuleset(live.doc, Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.kind])));
  if (problems.length) return { error: `The live rule set has problems: ${problems.slice(0, 3).join("; ")}` };

  const only = fd.getAll("only").map(String).filter(Boolean);
  const { rows, summary } = runChecks(table.rows, live.doc, { headers: table.headers, onlyRules: only.length ? only : undefined, tables });
  const out = annotate(table.rows, rows);
  const csv = toCsv([...table.headers, "Check approval", "Check comments"].filter((h, i, a) => a.indexOf(h) === i), out);

  // Name each flagged line by the client's own identifying columns, so people can find it in their file.
  const map = live.doc.column_map ?? {};
  const label = (i: number) => {
    const raw = table.rows[i];
    const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? "" : String(v));
    const parts = ["job_ref", "spec_number"].map((f) => (map[f] ? cell(raw[map[f]]) : "")).filter(Boolean);
    return parts.length ? parts.join(" · ") : `Row ${i + 2}`;
  };
  const flaggedAll = rows.filter((r) => r.approval !== "pass");
  const order: Record<Approval, number> = { issue: 0, hold: 1, confirm: 2, pass: 3 };
  const flagged = [...flaggedAll].sort((a, b) => order[a.approval] - order[b.approval] || a.index - b.index).slice(0, SHOW)
    .map((r) => ({ index: r.index + 2, label: label(r.index), approval: r.approval, comment: r.comment }));

  const hash = createHash("sha256").update(bytes).digest("hex");
  const rec = await supabase.rpc("crm_check_run_save", { p_client: clientId, p_ruleset: live.id, p_file_name: file.name, p_file_hash: hash, p_rows: table.rows.length, p_summary: summary });
  const base = file.name.replace(/\.[^.]+$/, "");
  return {
    result: {
      version: live.version, file_name: file.name, rows: table.rows.length, summary, saved: !rec.error, flagged, flagged_total: flaggedAll.length, csv,
      download_name: `${base}-checked.csv`, sheet: sheetUsed, sheet_names: sheetNames,
    },
    ...(rec.error ? { error: `The check ran but could not be recorded: ${friendly(rec.error)}` } : {}),
  };
}
