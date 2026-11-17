"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormResult } from "@/components/assure/action-form";

// ESG concerns and joint approvals. The database decides who may sign which side and every rule.
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ""));
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(fn: string, args: Record<string, unknown>, message: string | ((d: unknown) => string)): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath("/assure", "layout");
  return { ok: true, message: typeof message === "function" ? message(data) : message };
}

export async function requestOnboardingApproval(_: FormResult, fd: FormData): Promise<FormResult> {
  if (!uuid(s(fd, "supplier"))) return { error: "Choose a vendor." };
  return run("joint_approval_request", { p_type: "onboarding", p_subject: s(fd, "supplier"), p_summary: s(fd, "summary") || "Onboarding approval", p_supplier: s(fd, "supplier") },
    "Requested. Procurement directors and the Sustainability team have been told.");
}

export async function signApproval(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("joint_approval_sign", { p_id: s(fd, "id"), p_approve: true, p_note: s(fd, "note") || null }, (r) =>
    r === "approved" ? "Both sides have signed. It is approved." : r === "rejected" ? "Rejected. The person who asked has been told." : "Your signature is recorded. It waits for the other side.");
}

export async function rejectApproval(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("joint_approval_sign", { p_id: s(fd, "id"), p_approve: false, p_note: s(fd, "note") }, "Rejected. The person who asked has been told.");
}

export async function withdrawApproval(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("joint_approval_withdraw", { p_id: s(fd, "id"), p_note: s(fd, "note") || null }, "Withdrawn.");
}

export async function raiseEsgConcern(_: FormResult, fd: FormData): Promise<FormResult> {
  if (!uuid(s(fd, "supplier"))) return { error: "Choose a vendor." };
  return run("esg_flag_raise", { p_supplier: s(fd, "supplier"), p_severity: s(fd, "severity") || "medium", p_summary: s(fd, "summary"), p_detail: s(fd, "detail") || null, p_job: uuid(s(fd, "job")) ? s(fd, "job") : null, p_document: null },
    "Concern raised. The vendor's procurement and SRT owners have been told.");
}

export async function proposeEsgDecision(_: FormResult, fd: FormData): Promise<FormResult> {
  return run("esg_flag_propose_decision", { p_flag: s(fd, "id"), p_decision: s(fd, "decision"), p_note: s(fd, "note") }, "Proposed. It takes effect when a procurement director and the Sustainability team both sign.");
}

export async function setJointOnboarding(_: FormResult, fd: FormData): Promise<FormResult> {
  const on = s(fd, "value") === "on";
  return run("division_setting_set", { p_module: "assure", p_key: "joint_onboarding_required", p_value: on, p_reason: s(fd, "reason") }, on ? "Release now needs a joint approval." : "Release no longer needs a joint approval.");
}
