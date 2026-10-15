"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, str, type FormResult } from "@/lib/sourcing-actions";

// QA/QC actions for adm Indicia staff. Every decision is made by a SQL function that checks the role (quality),
// maker-checker (never the uploader / requester) and the state, and writes the audit row in the same transaction.

function refresh(fd: FormData) {
  const po = id(fd, "po");
  if (po) revalidatePath(`/orders/purchase-orders/${po}`);
  revalidatePath("/orders/qaqc");
  revalidatePath("/orders", "layout");
}

export async function reviewCheckpoint(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const approve = str(fd, "decision") === "verify";
  const supabase = await createClient();
  const { error } = await supabase.rpc("qaqc_review_checkpoint", { p_checkpoint: id(fd), p_approve: approve, p_note: str(fd, "note") });
  if (error) return { error: friendly(error) };
  refresh(fd);
  return { ok: true, message: approve ? "Verified." : "Rejected; the vendor has been told what to fix and an NCR is open in SRM." };
}

export async function setLevel(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const level = Number(str(fd, "level"));
  if (!Number.isInteger(level) || level < 1 || level > 5) return { error: "Choose a level from L1 to L5." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qaqc_set_level", { p_plan: id(fd), p_level: level, p_reason: str(fd, "reason") });
  if (error) return { error: friendly(error) };
  refresh(fd);
  return { ok: true, message: data === "pending" ? "Below the level the rules ask for, so a quality role has to approve it. It is in their approvals inbox." : `Level set to L${level}.` };
}

export async function requestWaiver(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("qaqc_request_waiver", { p_plan: id(fd), p_reason: str(fd, "reason") });
  if (error) return { error: friendly(error) };
  refresh(fd);
  return { ok: true, message: "Waiver requested; a quality role decides it in the approvals inbox." };
}

export async function createPlans(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qaqc_plan_create", { p_po: id(fd, "po"), p_spec: id(fd, "spec") });
  if (error) return { error: friendly(error) };
  refresh(fd);
  return { ok: true, message: `${data ?? 0} QA/QC plan(s) in place.` };
}
