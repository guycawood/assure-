"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runDocumentChecks } from "@/lib/ocr/run";
import type { FormResult } from "@/components/assure/action-form";

// Run the automatic check on a document again (for example after the OCR service has been set up).
export async function rerunCheck(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const type = String(fd.get("type") ?? ""), id = String(fd.get("id") ?? "");
  if (!["certificate", "document"].includes(type) || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "Item not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("docchecks_rerun", { p_type: type, p_id: id });
  if (error) return { error: error.message };
  try { await runDocumentChecks(3); } catch { /* the scheduler will pick it up */ }
  revalidatePath("/assure/compliance/review");
  return { ok: true, message: "Checked again." };
}
