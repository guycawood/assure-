"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bool, friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";
import { sentForApproval } from "@/components/approvals/pending";

// CRM server actions. Every write is a security definer SQL function (crm_*) that checks the caller and audits the change.

async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error?: string }> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: friendly(error) };
  revalidatePath("/crm", "layout");
  return { data: data as T };
}

const bad = (fd: FormData, ...keys: string[]) => keys.some((k) => Number.isNaN(numOrNull(fd, k)));
const intOrNull = (fd: FormData, k: string) => {
  const n = numOrNull(fd, k);
  return n == null || Number.isNaN(n) ? null : Math.round(n);
};

/* ---------- Clients ---------- */
export async function createClientAccount(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "credit_limit")) return { error: "The credit limit must be a number." };
  const res = await call<string>("crm_client_create", {
    p_code: str(fd, "code"), p_name: str(fd, "name"), p_currency: str(fd, "currency"), p_hq_market: str(fd, "hq_market"),
    p_sector: str(fd, "sector"), p_credit_limit: numOrNull(fd, "credit_limit"), p_note: str(fd, "note"),
  });
  if (res.error) return { error: res.error };
  revalidatePath("/sourcing/admin");
  redirect(`/crm/clients/${res.data}`);
}

export async function resubmitSetup(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_client_setup_resubmit", { p_client: id(fd), p_note: str(fd, "note") });
  return res.error ? { error: res.error } : { ok: true, message: "Sent to Finance again." };
}

export async function requestTermsChange(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "markup", "commission", "rebate", "payment_terms_days")) return { error: "Numbers only in the terms fields." };
  const res = await call<string>("crm_terms_request", {
    p_client: id(fd), p_markup: numOrNull(fd, "markup"), p_commission: numOrNull(fd, "commission"), p_rebate: numOrNull(fd, "rebate"),
    p_payment_terms_days: intOrNull(fd, "payment_terms_days"), p_reason: str(fd, "reason"), p_contract: id(fd, "contract_id"),
  });
  if (res.error) return { error: res.error };
  const supabase = await createClient();
  return { ok: true, message: (await sentForApproval(supabase, "CRM_TERMS", id(fd) ?? "")) ?? "Change requested." };
}

/* ---------- Accounts and contacts ---------- */
export async function saveAccount(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_account_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_market: str(fd, "market"), p_account_lead: id(fd, "account_lead"),
    p_tier_id: id(fd, "tier_id"), p_status: str(fd, "status") ?? "active", p_notes: str(fd, "notes"),
  });
  return res.error ? { error: res.error } : { ok: true, message: id(fd) ? "Account updated." : "Account added." };
}

export async function saveContact(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_contact_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_account: id(fd, "account_id"), p_full_name: str(fd, "full_name"), p_job_title: str(fd, "job_title"),
    p_email: str(fd, "email"), p_phone: str(fd, "phone"), p_market: str(fd, "market"), p_decision_role: str(fd, "decision_role") ?? "user",
    p_consent: bool(fd, "consent"), p_active: fd.has("active_field") ? bool(fd, "active") : true,
  });
  return res.error ? { error: res.error } : { ok: true, message: id(fd) ? "Contact updated." : "Contact added." };
}

/* ---------- Activity ---------- */
export async function logInteraction(_: FormResult, fd: FormData): Promise<FormResult> {
  const when = str(fd, "occurred_at");
  const res = await call("crm_interaction_log", {
    p_client: id(fd, "client_id"), p_account: id(fd, "account_id"), p_opportunity: id(fd, "opportunity_id"), p_type_id: id(fd, "type_id"),
    p_subject: str(fd, "subject"), p_summary: str(fd, "summary"), p_occurred_at: when ? new Date(when).toISOString() : null,
    p_contact: id(fd, "contact_id"), p_owner: id(fd, "owner"),
  });
  return res.error ? { error: res.error } : { ok: true, message: "Logged." };
}

/* ---------- Pipeline ---------- */
export async function createOpportunity(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "value")) return { error: "The value must be a number." };
  const res = await call("crm_opportunity_create", {
    p_client: id(fd, "client_id"), p_account: id(fd, "account_id"), p_title: str(fd, "title"), p_value: numOrNull(fd, "value"),
    p_currency: str(fd, "currency"), p_expected_close: str(fd, "expected_close"), p_stage: str(fd, "stage") ?? "lead",
    p_description: str(fd, "description"), p_owner: id(fd, "owner"),
  });
  return res.error ? { error: res.error } : { ok: true, message: "Opportunity added." };
}

export async function updateOpportunity(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "value", "probability")) return { error: "Numbers only in value and probability." };
  const res = await call("crm_opportunity_update", {
    p_id: id(fd), p_title: str(fd, "title"), p_value: numOrNull(fd, "value"), p_currency: str(fd, "currency"),
    p_probability: intOrNull(fd, "probability"), p_expected_close: str(fd, "expected_close"), p_description: str(fd, "description"),
  });
  return res.error ? { error: res.error } : { ok: true, message: "Saved." };
}

export async function moveOpportunity(_: FormResult, fd: FormData): Promise<FormResult> {
  const stage = str(fd, "stage");
  const res = await call<string>("crm_opportunity_move", { p_id: id(fd), p_stage: stage, p_note: str(fd, "note"), p_lost_reason: id(fd, "lost_reason_id") });
  if (res.error) return { error: res.error };
  if (res.data === "pending") {
    const supabase = await createClient();
    return { ok: true, message: (await sentForApproval(supabase, "CRM_OPP_WON", id(fd) ?? "")) ?? "Sent for confirmation." };
  }
  return { ok: true, message: stage === "won" ? "Marked won. Create the campaign in Briefing+ when you're ready." : stage === "lost" ? "Marked lost." : "Moved." };
}

export async function opportunityToCampaign(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<string>("crm_opportunity_to_campaign", { p_id: id(fd), p_name: str(fd, "name") });
  if (res.error) return { error: res.error };
  revalidatePath("/briefing", "layout");
  return { ok: true, message: "Campaign created in Briefing+ (planning)." };
}

/* ---------- Account plans ---------- */
export async function savePlan(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "growth_target")) return { error: "The growth target must be a number." };
  const res = await call("crm_plan_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_account: id(fd, "account_id"), p_title: str(fd, "title"),
    p_period_start: str(fd, "period_start"), p_period_end: str(fd, "period_end"), p_objectives: str(fd, "objectives"),
    p_growth_target: numOrNull(fd, "growth_target"), p_currency: str(fd, "currency"), p_status: str(fd, "status") ?? "draft", p_owner: id(fd, "owner"),
  });
  return res.error ? { error: res.error } : { ok: true, message: id(fd) ? "Plan updated." : "Plan added." };
}

export async function addPlanAction(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_plan_action_add", { p_plan: id(fd, "plan_id"), p_action: str(fd, "action"), p_owner: id(fd, "owner"), p_due: str(fd, "due_date") });
  return res.error ? { error: res.error } : { ok: true, message: "Action added." };
}

export async function setPlanAction(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_plan_action_set", { p_id: id(fd), p_status: str(fd, "status") });
  return res.error ? { error: res.error } : { ok: true, message: "Updated." };
}

/* ---------- Contracts ---------- */
export async function saveContract(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "value", "payment_terms_days", "markup", "min_margin", "commission", "rebate", "notice_days")) return { error: "Numbers only in the value and terms fields." };
  const res = await call("crm_contract_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_type: str(fd, "contract_type"), p_parent: id(fd, "parent_id"), p_title: str(fd, "title"),
    p_start: str(fd, "start_date"), p_end: str(fd, "end_date"), p_renewal: str(fd, "renewal_date"), p_notice_days: intOrNull(fd, "notice_days"),
    p_value: numOrNull(fd, "value"), p_currency: str(fd, "currency"), p_payment_terms_days: intOrNull(fd, "payment_terms_days"),
    p_markup: numOrNull(fd, "markup"), p_min_margin: numOrNull(fd, "min_margin"), p_commission: numOrNull(fd, "commission"),
    p_rebate: numOrNull(fd, "rebate"), p_auto_renew: bool(fd, "auto_renew"), p_sustainability: str(fd, "sustainability"), p_notes: str(fd, "notes"),
  });
  return res.error ? { error: res.error } : { ok: true, message: id(fd) ? "Contract updated." : "Contract added as a draft." };
}

export async function signContract(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<string>("crm_contract_sign", { p_id: id(fd), p_note: str(fd, "note") });
  if (res.error) return { error: res.error };
  if (res.data === "pending") {
    const supabase = await createClient();
    return { ok: true, message: (await sentForApproval(supabase, "CRM_CONTRACT", id(fd) ?? "")) ?? "Sent for approval." };
  }
  return { ok: true, message: "Contract signed." };
}

export async function renewContract(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "value")) return { error: "The value must be a number." };
  const res = await call<string>("crm_contract_renew", {
    p_id: id(fd), p_end: str(fd, "end_date"), p_value: numOrNull(fd, "value"), p_renewal: str(fd, "renewal_date"), p_note: str(fd, "note"),
  });
  if (res.error) return { error: res.error };
  if (res.data === "pending") {
    const supabase = await createClient();
    return { ok: true, message: (await sentForApproval(supabase, "CRM_CONTRACT", id(fd) ?? "")) ?? "Sent for approval." };
  }
  return { ok: true, message: "Contract renewed." };
}

/* ---------- Feedback ---------- */
export async function captureFeedback(_: FormResult, fd: FormData): Promise<FormResult> {
  const score = intOrNull(fd, "score");
  const res = await call("crm_feedback_capture", {
    p_client: id(fd, "client_id"), p_account: id(fd, "account_id"), p_contact: id(fd, "contact_id"), p_score: score, p_comment: str(fd, "comment"),
  });
  return res.error ? { error: res.error } : { ok: true, message: "Feedback recorded." };
}

export async function followUpFeedback(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_feedback_follow_up", { p_id: id(fd), p_note: str(fd, "note") });
  return res.error ? { error: res.error } : { ok: true, message: "Follow-up recorded." };
}
