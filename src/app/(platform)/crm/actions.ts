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

/* =================== Stage 2: HubSpot replacement =================== */

const ids = (fd: FormData, k = "ids") => fd.getAll(k).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));

/** One cell of the stakeholder grid (called from the grid, not a form). */
export async function setContactField(contactId: string, field: string, value: unknown): Promise<{ ok?: boolean; error?: string }> {
  const res = await call("crm_contact_set_field", { p_id: contactId, p_field: field, p_value: value === undefined ? null : value });
  return res.error ? { error: res.error } : { ok: true };
}

export async function reassignContacts(_: FormResult, fd: FormData): Promise<FormResult> {
  const list = ids(fd);
  if (!list.length) return { error: "Tick the contacts to reassign first." };
  const res = await call<number>("crm_contacts_reassign", { p_ids: list, p_owner: id(fd, "owner"), p_note: str(fd, "note") });
  return res.error ? { error: res.error } : { ok: true, message: `${res.data ?? 0} contact(s) reassigned.` };
}

export async function markContactsReviewed(_: FormResult, fd: FormData): Promise<FormResult> {
  const list = ids(fd);
  if (!list.length) return { error: "Tick the contacts you have reviewed first." };
  const res = await call<number>("crm_contacts_mark_reviewed", { p_ids: list });
  return res.error ? { error: res.error } : { ok: true, message: `${res.data ?? 0} contact(s) marked as reviewed.` };
}

export async function markContactLeft(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_contact_mark_left", { p_id: id(fd), p_note: str(fd, "note") });
  return res.error ? { error: res.error } : { ok: true, message: "Marked as left." };
}

export async function savePerformance(_: FormResult, fd: FormData): Promise<FormResult> {
  if (bad(fd, "budget", "probability")) return { error: "Numbers only in budget and probability." };
  const res = await call("crm_performance_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_contact: id(fd, "contact_id"), p_service: id(fd, "service_id"), p_title: str(fd, "title"),
    p_stage: str(fd, "stage"), p_next_step: id(fd, "next_step_id"), p_next_steps: str(fd, "next_steps"), p_cs_lead: id(fd, "cs_lead"), p_sme: id(fd, "sme"),
    p_budget: numOrNull(fd, "budget"), p_currency: str(fd, "currency"), p_probability: intOrNull(fd, "probability"), p_expected_close: str(fd, "expected_close"),
  });
  return res.error ? { error: res.error } : { ok: true, message: id(fd) ? "Updated." : "Added to the Performance Tracker." };
}

/* ---------- Surveys ---------- */
export async function createWave(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<string>("crm_survey_wave_create", { p_name: str(fd, "name"), p_period: str(fd, "period"), p_closes_on: str(fd, "closes_on") });
  if (res.error) return { error: res.error };
  redirect(`/crm/surveys/${res.data}`);
}
export async function addToWave(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<number>("crm_survey_wave_add", { p_wave: id(fd), p_client: id(fd, "client_id"), p_contacts: ids(fd, "contact_ids").length ? ids(fd, "contact_ids") : null });
  return res.error ? { error: res.error } : { ok: true, message: `${res.data ?? 0} contact(s) added.` };
}
export async function sendWave(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<string>("crm_survey_wave_send", { p_wave: id(fd) });
  if (res.error) return { error: res.error };
  if (res.data === "pending") {
    const supabase = await createClient();
    return { ok: true, message: (await sentForApproval(supabase, "CRM_SEND", id(fd) ?? "")) ?? "Sent for approval." };
  }
  return { ok: true, message: "Survey emails queued, each signed by the contact owner." };
}
export async function closeWave(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_survey_wave_close", { p_wave: id(fd) });
  return res.error ? { error: res.error } : { ok: true, message: "Survey closed." };
}

/* ---------- Forms ---------- */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field";
/** "Label | type | required | Option A, Option B" per line -> form fields. */
function parseFields(text: string) {
  const out: { key: string; label: string; type: string; required: boolean; options?: string[] }[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [label, type = "text", req = "", opts = ""] = line.split("|").map((x) => x.trim());
    const t = type.toLowerCase();
    const key = t === "email" ? "email" : /^(full )?name$/i.test(label) ? "full_name" : /job title/i.test(label) ? "job_title" : /phone/i.test(label) ? "phone" : slug(label);
    out.push({ key, label, type: t, required: /^(required|yes|y|true)$/i.test(req), ...(t === "select" ? { options: opts.split(",").map((o) => o.trim()).filter(Boolean) } : {}) });
  }
  return out;
}
export async function saveForm(_: FormResult, fd: FormData): Promise<FormResult> {
  const fields = parseFields(str(fd, "fields") ?? "");
  const res = await call<string>("crm_form_save", {
    p_id: id(fd), p_name: str(fd, "name"), p_description: str(fd, "description"), p_fields: fields, p_consent_text: str(fd, "consent_text"),
    p_client: id(fd, "client_id"), p_active: fd.has("active_field") ? bool(fd, "active") : true,
  });
  if (res.error) return { error: res.error };
  if (!id(fd)) redirect(`/crm/forms/${res.data}`);
  return { ok: true, message: "Form saved." };
}

/* ---------- Lists and emails ---------- */
export async function saveList(_: FormResult, fd: FormData): Promise<FormResult> {
  const filters: Record<string, string | boolean> = {};
  for (const k of ["client_id", "department", "relationship_rag", "influence_level", "decision_level", "quadrant", "market", "owner", "owner_role", "decision_role"]) {
    const v = str(fd, k);
    if (v) filters[k] = v;
  }
  if (str(fd, "receive_survey")) filters.receive_survey = str(fd, "receive_survey") === "true";
  if (bool(fd, "all_staff")) filters.all_staff = true;
  const res = await call<string>("crm_list_save", {
    p_id: id(fd), p_name: str(fd, "name"), p_description: str(fd, "description"), p_kind: str(fd, "kind"), p_audience: str(fd, "audience"), p_filters: filters,
  });
  return res.error ? { error: res.error } : { ok: true, message: "List saved." };
}
export async function addToList(_: FormResult, fd: FormData): Promise<FormResult> {
  const c = ids(fd, "contact_ids"), p = ids(fd, "profile_ids");
  if (!c.length && !p.length) return { error: "Choose who to add." };
  const res = await call<number>("crm_list_add", { p_list: id(fd), p_contacts: c.length ? c : null, p_profiles: p.length ? p : null });
  return res.error ? { error: res.error } : { ok: true, message: `${res.data ?? 0} added.` };
}
export async function removeFromList(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_list_remove", { p_list: id(fd), p_member: id(fd, "member") });
  return res.error ? { error: res.error } : { ok: true, message: "Removed." };
}
export async function saveEmail(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<string>("crm_email_save", {
    p_id: id(fd), p_name: str(fd, "name"), p_list: id(fd, "list_id"), p_template: id(fd, "template_id"), p_subject: str(fd, "subject"), p_body: str(fd, "body"), p_link: str(fd, "link"),
  });
  if (res.error) return { error: res.error };
  if (!id(fd)) redirect(`/crm/emails/${res.data}`);
  return { ok: true, message: "Saved." };
}
export async function sendEmail(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<string>("crm_email_send", { p_email: id(fd) });
  if (res.error) return { error: res.error };
  if (res.data === "pending") {
    const supabase = await createClient();
    return { ok: true, message: (await sentForApproval(supabase, "CRM_SEND", id(fd) ?? "")) ?? "Sent for approval." };
  }
  return { ok: true, message: "Queued for sending. Anyone excluded is listed with the reason." };
}
export async function simulateEmailEvents(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call<number>("crm_email_simulate_events", { p_email: id(fd) });
  return res.error ? { error: res.error } : { ok: true, message: `${res.data ?? 0} demo events added (simulated, no provider connected).` };
}

/* ---------- HubSpot import ---------- */
export async function runImport(kind: string, rows: Record<string, string>[], dryRun: boolean, fileName: string, mapping: Record<string, string>, onDuplicate: string) {
  const res = await call<import("@/lib/crm").ImportReport>("crm_import", {
    p_kind: kind, p_rows: rows, p_dry_run: dryRun, p_file_name: fileName || null, p_mapping: mapping, p_on_duplicate: onDuplicate === "update" ? "update" : "skip",
  });
  if (res.error) return { error: res.error };
  if (!dryRun) revalidatePath("/crm", "layout");
  return { report: res.data };
}
/* ---------- Client business reviews and actions ---------- */
export async function saveReview(_: FormResult, fd: FormData): Promise<FormResult> {
  const agenda = (str(fd, "agenda") ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const res = await call<string>("crm_review_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_account: id(fd, "account_id"), p_type: str(fd, "review_type"), p_title: str(fd, "title"),
    p_scheduled_on: str(fd, "scheduled_on"), p_agenda: agenda, p_internal: ids(fd, "internal_attendees"), p_contacts: ids(fd, "contact_attendees"),
    p_client_visible: fd.has("visible_field") ? bool(fd, "client_visible") : true,
  });
  if (res.error) return { error: res.error };
  if (!id(fd)) redirect(`/crm/reviews/${res.data}`);
  return { ok: true, message: "Review saved." };
}
export async function generatePack(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_review_generate_pack", { p_id: id(fd) });
  return res.error ? { error: res.error } : { ok: true, message: "Pack generated from the latest CRM data." };
}
export async function setReviewStatus(_: FormResult, fd: FormData): Promise<FormResult> {
  const status = str(fd, "status");
  const res = await call("crm_review_set_status", { p_id: id(fd), p_status: status, p_outcomes: str(fd, "outcomes"), p_notes: str(fd, "notes") });
  return res.error ? { error: res.error } : { ok: true, message: status === "closed" ? "Review closed." : status === "held" ? "Marked as held." : status === "cancelled" ? "Review cancelled." : "Saved." };
}
export async function saveCrmAction(_: FormResult, fd: FormData): Promise<FormResult> {
  const res = await call("crm_action_save", {
    p_id: id(fd), p_client: id(fd, "client_id"), p_title: str(fd, "title"), p_detail: str(fd, "detail"), p_owner: id(fd, "owner"), p_due: str(fd, "due_date"),
    p_review: id(fd, "review_id"), p_client_visible: bool(fd, "client_visible"), p_account: id(fd, "account_id"),
  });
  return res.error ? { error: res.error } : { ok: true, message: id(fd) ? "Action updated." : "Action added." };
}
export async function setCrmActionStatus(_: FormResult, fd: FormData): Promise<FormResult> {
  const plan = str(fd, "kind") === "plan";
  const res = plan
    ? await call("crm_plan_action_set", { p_id: id(fd), p_status: str(fd, "status") === "cancelled" ? "dropped" : str(fd, "status") === "in_progress" ? "open" : str(fd, "status") })
    : await call("crm_action_set_status", { p_id: id(fd), p_status: str(fd, "status"), p_note: str(fd, "note") });
  return res.error ? { error: res.error } : { ok: true, message: "Updated." };
}