"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { coerceData, schemaFor } from "@/modules/libraries";

// Every write goes through a security-definer SQL function that checks the caller can govern the module
// and writes the audit row in the same transaction. These actions only shape the input.

export type Result = { ok: boolean; message: string };
const ok = (message: string): Result => ({ ok: true, message });
const fail = (message: string): Result => ({ ok: false, message });

function refresh() {
  revalidatePath("/", "layout");
}

async function call(fn: string, args: Record<string, unknown>, success: string): Promise<Result> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return fail(error.message);
  refresh();
  return ok(success);
}

export type RecordInput = { code: string; name: string; effective_from: string; notes: string; reason: string; data: Record<string, unknown> };

export async function createRecord(key: string, input: RecordInput): Promise<Result> {
  const { data, errors } = coerceData(schemaFor(key), input.data);
  if (!input.name.trim()) errors.unshift("Name is required");
  if (errors.length) return fail(errors.join(". "));
  return call("library_create", { p_key: key, p_code: input.code || null, p_name: input.name, p_data: data, p_effective_from: input.effective_from || null, p_notes: input.notes || null }, "Added.");
}

export async function updateRecord(key: string, id: string, input: RecordInput): Promise<Result> {
  const { data, errors } = coerceData(schemaFor(key), input.data);
  if (!input.name.trim()) errors.unshift("Name is required");
  if (errors.length) return fail(errors.join(". "));
  return call("library_update", { p_id: id, p_name: input.name, p_data: data, p_notes: input.notes || null, p_reason: input.reason }, "Correction saved.");
}

export async function supersedeRecord(key: string, id: string, input: RecordInput): Promise<Result> {
  const { data, errors } = coerceData(schemaFor(key), input.data);
  if (!input.name.trim()) errors.unshift("Name is required");
  if (errors.length) return fail(errors.join(". "));
  return call("library_supersede", { p_id: id, p_name: input.name, p_data: data, p_effective_from: input.effective_from || null, p_note: input.reason }, "New version created.");
}

export async function approveRecord(id: string, approve: boolean, note: string): Promise<Result> {
  return call("library_approve", { p_id: id, p_approve: approve, p_note: note || null }, approve ? "Approved." : "Rejected.");
}
export async function retireRecord(id: string, note: string): Promise<Result> {
  return call("library_retire", { p_id: id, p_note: note || null }, "Deactivated.");
}
export async function reactivateRecord(id: string, note: string): Promise<Result> {
  return call("library_reactivate", { p_id: id, p_note: note || null }, "Reactivated.");
}
export async function deleteRecord(id: string, note: string): Promise<Result> {
  return call("library_delete", { p_id: id, p_note: note || null }, "Deleted.");
}
export async function addAlias(id: string, alias: string, source: string): Promise<Result> {
  if (!alias.trim()) return fail("Enter an alias");
  return call("library_alias_add", { p_record: id, p_alias: alias, p_source: source || null }, "Alias added.");
}
export async function toggleAlias(aliasId: string): Promise<Result> {
  return call("library_alias_toggle", { p_alias: aliasId }, "Alias updated.");
}

/** CSV rows (already parsed in the browser): every row is validated against the schema; nothing is written if any row fails. */
export async function importRecords(key: string, rows: Record<string, string>[]): Promise<Result> {
  const schema = schemaFor(key);
  const errors: string[] = [];
  const payload = rows.map((r, i) => {
    const { data, errors: e } = coerceData(schema, r);
    if (!r.name?.trim()) e.unshift("name is required");
    e.forEach((m) => errors.push(`Row ${i + 2}: ${m}`));
    return { code: r.code || null, name: r.name, effective_from: r.effective_from || null, data };
  });
  if (!rows.length) return fail("The file has no rows.");
  if (errors.length) return fail(`Nothing imported. ${errors.slice(0, 8).join(" · ")}${errors.length > 8 ? ` (+${errors.length - 8} more)` : ""}`);
  return call("library_import", { p_key: key, p_rows: payload, p_note: `CSV import (${rows.length} rows)` }, `${rows.length} records imported.`);
}

// ---- Change requests ----
export async function submitChangeRequest(input: { module: string; sourceArea: string; text: string; category: string; libraryKey?: string; recordId?: string }): Promise<Result> {
  if (!input.text.trim()) return fail("Describe the change you'd like.");
  return call("cr_submit", { p_module: input.module, p_source_area: input.sourceArea, p_text: input.text, p_category: input.category || null, p_library: input.libraryKey || null, p_record: input.recordId || null }, "Thanks, your suggestion is logged for review.");
}
export async function startReview(id: string): Promise<Result> {
  return call("cr_start_review", { p_id: id }, "Review started.");
}
export async function reviewChangeRequest(id: string, input: { status: string; category: string; impact: string; notes: string; principles: string[]; conflicts: boolean; conflicting: string[] }): Promise<Result> {
  return call("cr_review", {
    p_id: id, p_status: input.status, p_category: input.category || null, p_impact: input.impact || null, p_notes: input.notes || null,
    p_principles_checked: input.principles, p_conflicts: input.conflicts, p_conflicting: input.conflicting,
  }, "Review saved.");
}
export async function markImplemented(id: string, notes: string): Promise<Result> {
  return call("cr_mark_implemented", { p_id: id, p_notes: notes || null }, "Marked as implemented.");
}
export async function verifyChangeRequest(id: string, notes: string): Promise<Result> {
  return call("cr_verify", { p_id: id, p_notes: notes }, "Verified and closed.");
}
