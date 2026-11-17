"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id as uuidField, str, type FormResult } from "@/lib/sourcing-actions";
import { parseTableUpload } from "@/lib/savings-check/engine";
import { gridToTable, parseTable } from "@/lib/savings-check/file";
import { pickSheet, readWorkbook } from "@/lib/savings-check/xlsx";

// Fee schedules and exception lists for a client's savings checks: uploaded from a file, approved by a different CRM owner before they apply.
export async function uploadClientTable(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const client = uuidField(fd, "client_id"), key = (str(fd, "key") ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const kind = str(fd, "kind") === "list" ? "list" : "lookup";
  const file = fd.get("file");
  if (!client) return { error: "Client not found." };
  if (!key) return { error: "Name the table, for example fee_by_country." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the file." };
  if (file.size > 8 * 1024 * 1024) return { error: "The file is over 8 MB." };
  if (/\.(xls|xlsb)$/i.test(file.name)) return { error: "This is an older Excel format. Save it as Excel Workbook (.xlsx) or CSV UTF-8 and upload that." };
  const bytes = Buffer.from(await file.arrayBuffer());
  let table;
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    let sheets;
    try { sheets = await readWorkbook(bytes); } catch { return { error: "That Excel file could not be read." }; }
    const picked = pickSheet(sheets, str(fd, "sheet"));
    if ("error" in picked) return { error: picked.error };
    table = gridToTable(picked.sheet.data);
  } else table = parseTable(bytes.toString("utf8"));
  const parsed = parseTableUpload(table.headers, table.rows, kind);
  if (parsed.errors.length) return { error: `Fix the file and upload it again. ${parsed.errors.join(" ")}` };

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_table_upload", { p_client: client, p_key: key, p_title: str(fd, "title"), p_kind: kind, p_rows: parsed.rows, p_note: str(fd, "note"), p_file: file.name });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${client}`);
  return { ok: true, message: `Uploaded ${parsed.rows.length.toLocaleString("en-GB")} rows from column${parsed.columns.length === 1 ? "" : "s"} ${parsed.columns.join(", ")}. Another CRM owner needs to approve it before checks use it.` };
}

export async function decideTable(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const approve = fd.get("decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_table_decide", { p_version: str(fd, "id"), p_approve: approve, p_note: str(fd, "note") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${uuidField(fd, "client_id")}`);
  return { ok: true, message: approve ? "Approved. Checks now use this table." : "Sent back with your reason." };
}

export async function withdrawTable(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_table_withdraw", { p_version: str(fd, "id") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${uuidField(fd, "client_id")}`);
  return { ok: true, message: "Withdrawn." };
}
