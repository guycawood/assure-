"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type FormResult = { ok?: boolean; error?: string; message?: string };
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Approve or reject a pending approval request (approval_requests). Maker-checker and roles are enforced in SQL. */
export async function decideApprovalRequest(_prev: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const approve = str(fd, "decision") === "approve";
  const { error } = await supabase.rpc("approval_request_decide", { p_id: str(fd, "id"), p_approve: approve, p_note: str(fd, "note") || null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: approve ? "Approved and applied." : "Rejected; the requester has been told." };
}

/** The requester (or an admin) withdraws a pending request. */
export async function cancelApprovalRequest(_prev: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("approval_request_cancel", { p_id: str(fd, "id"), p_note: str(fd, "note") || null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Request withdrawn." };
}
