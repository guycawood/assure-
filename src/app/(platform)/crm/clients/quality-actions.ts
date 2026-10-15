"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

/** The client's contractual minimum QA/QC level (feeds the QA/QC threshold rules). Audited in CRM. */
export async function setQaMinLevel(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const raw = str(fd, "level");
  const level = raw ? Number(raw) : null;
  if (level != null && (!Number.isInteger(level) || level < 1 || level > 5)) return { error: "Choose L1 to L5, or none." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_client_set_qa_min_level", { p_client: id(fd), p_level: level, p_reason: str(fd, "reason") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${id(fd)}`);
  return { ok: true, message: "Saved. New QA/QC plans for this client use it." };
}
