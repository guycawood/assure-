"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id as uuidField, str, type FormResult } from "@/lib/sourcing-actions";

// Working a feedback case. The database enforces each step's rules (cause, root cause and action before resolving; the client told before closing).
async function step(fd: FormData, fn: string, args: (id: string) => Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const id = uuidField(fd, "case_id");
  if (!id) return { error: "Case not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args(id));
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/feedback/cases/${id}`);
  revalidatePath("/crm/feedback/cases");
  revalidatePath("/crm/feedback");
  return { ok: true, message };
}

export async function acknowledgeCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_acknowledge", (id) => ({ p_id: id, p_note: str(fd, "note") }), "Acknowledged.");
}
export async function assignCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_assign", (id) => ({ p_id: id, p_owner: uuidField(fd, "owner"), p_note: str(fd, "note") }), "Assigned.");
}
export async function saveCaseFindings(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_save_findings", (id) => ({ p_id: id, p_cause: str(fd, "cause"), p_root_cause: str(fd, "root_cause"), p_action: str(fd, "action_taken") }), "Findings saved.");
}
export async function resolveCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_resolve", (id) => ({ p_id: id, p_note: str(fd, "note") }), "Resolved. Now tell the client and record how they reacted.");
}
export async function informClient(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_inform_client", (id) => ({ p_id: id, p_how: str(fd, "how"), p_note: str(fd, "note") }), "Recorded that the client was told.");
}
export async function closeCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_close", (id) => ({ p_id: id, p_outcome: str(fd, "outcome"), p_note: str(fd, "note") }), "Closed.");
}
export async function reopenCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_reopen", (id) => ({ p_id: id, p_note: str(fd, "note") }), "Reopened.");
}
export async function escalateCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_escalate", (id) => ({ p_id: id, p_note: str(fd, "note") }), "Escalated. The CRM owners have been told.");
}
export async function commentCase(_: FormResult, fd: FormData): Promise<FormResult> {
  return step(fd, "crm_case_comment", (id) => ({ p_id: id, p_note: str(fd, "note") }), "Note added.");
}
