"use server";

// Server actions for the nine-stage onboarding standard. Every rule (roles, segregation, exit criteria) is enforced in the
// database functions; these actions only validate shape and pass the call through.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type OnbResult = { ok?: boolean; error?: string; message?: string; matches?: DuplicateMatch[]; values?: Record<string, string> };
export type DuplicateMatch = { kind: "supplier" | "case"; supplier_id?: string; case_id?: string; case_no?: number; name: string; supplier_code?: string | null; market: string | null; state: string; reasons: string[] };

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const uuid = z.string().uuid();

// Messages raised by our own functions are written for users; anything else gets a generic message.
function friendly(error: { message: string; code?: string } | null, fallback = "That didn't save. Try again.") {
  if (!error) return undefined;
  if (error.code === "42501" || error.code === "P0001" || /^[A-Z]/.test(error.message)) return error.message.replace(/^ERROR:\s*/, "");
  return fallback;
}
function refresh(supplierId?: string | null) {
  revalidatePath("/assure/srt", "layout");
  if (supplierId) revalidatePath(`/assure/suppliers/${supplierId}`);
}

/* ---------------- Stage 1-3: request, duplicate check, triage ---------------- */

const requestSchema = z.object({
  business_case: z.string().min(1, "Describe the business need: why this supplier is needed."),
  supplier_type: z.enum(["manufacturer", "distributor", "service_provider", "raw_material", "logistics"], { message: "Choose the supplier type." }),
  category: z.string().min(1, "Choose a category."),
  tax_category_id: uuid.nullable(),
  client: z.enum(["Brightlane", "Northbrew", "Carewell", "BAU", "Other"]).nullable(),
  market: z.string().min(1, "Choose the market."),
  urgency: z.enum(["standard", "urgent"]),
  urgency_reason: z.string().nullable(),
  client_need: z.string().nullable(),
  required_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  estimated_spend: z.coerce.number({ message: "Enter the estimated annual spend." }).min(0, "Enter the estimated annual spend."),
  currency: z.string().length(3),
  proposed_name: z.string().min(1, "Enter the proposed supplier's name."),
  proposed_email: z.string().email("Enter a valid supplier contact email.").nullable(),
  proposed_contact: z.string().nullable(),
  proposed_website: z.string().nullable(),
  proposed_vat: z.string().nullable(),
  proposed_registration: z.string().nullable(),
  duplicate_confirmed: z.boolean(),
  linked_supplier_id: uuid.nullable(),
});

export async function submitOnboardingRequest(_: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const p = requestSchema.safeParse({
    business_case: s(fd, "business_case") ?? "", supplier_type: s(fd, "supplier_type") ?? "", category: s(fd, "category") ?? "",
    tax_category_id: s(fd, "tax_category_id"), client: s(fd, "client"), market: s(fd, "market") ?? "", urgency: s(fd, "urgency") ?? "standard",
    urgency_reason: s(fd, "urgency_reason"), client_need: s(fd, "client_need"), required_date: s(fd, "required_date"),
    estimated_spend: s(fd, "estimated_spend") ?? "", currency: (s(fd, "currency") ?? "EUR").toUpperCase(), proposed_name: s(fd, "proposed_name") ?? "",
    proposed_email: s(fd, "proposed_email"), proposed_contact: s(fd, "proposed_contact"), proposed_website: s(fd, "proposed_website"),
    proposed_vat: s(fd, "proposed_vat"), proposed_registration: s(fd, "proposed_registration"),
    duplicate_confirmed: fd.get("duplicate_confirmed") === "on", linked_supplier_id: s(fd, "linked_supplier_id"),
  });
  // The form is reset after each submit, so the values go back with any error or duplicate list.
  const values = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
  if (!p.success) return { error: p.error.issues[0].message, values };
  const supabase = await createClient();
  // Show possible duplicates before anything is saved; the requester confirms or links the existing supplier.
  if (!p.data.duplicate_confirmed && !p.data.linked_supplier_id) {
    const { data: matches, error } = await supabase.rpc("onboarding_duplicate_check", {
      p_name: p.data.proposed_name, p_vat: p.data.proposed_vat, p_registration: p.data.proposed_registration, p_email: p.data.proposed_email, p_code: null,
    });
    if (error) return { error: friendly(error), values };
    const list = (matches ?? []) as DuplicateMatch[];
    if (list.length) return { matches: list, values, error: "Possible duplicates found. Confirm it is not a duplicate, or link the existing supplier." };
  }
  const { data, error } = await supabase.rpc("onboarding_request_submit", { p: p.data });
  if (error) return { error: friendly(error), values };
  refresh();
  redirect(`/assure/srt/requests/${data as string}`);
}

export async function triageRequest(caseId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const decision = s(fd, "decision");
  if (!["approve", "decline", "duplicate"].includes(decision ?? "")) return { error: "Choose approve, decline or duplicate." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("onboarding_triage", {
    p_case: caseId, p_decision: decision, p_route: s(fd, "route"), p_relationship: s(fd, "relationship"), p_note: s(fd, "note"),
    p_existing_supplier: s(fd, "existing_supplier"),
  });
  if (error) return { error: friendly(error) };
  refresh(data as string | null);
  revalidatePath(`/assure/srt/requests/${caseId}`);
  return { ok: true, message: decision === "approve" ? "Approved: the supplier record is created and the information request can be sent." : "Recorded." };
}

export async function setCaseStatus(caseId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_case_set_status", { p_case: caseId, p_status: s(fd, "status"), p_note: s(fd, "note") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/assure/srt/requests/${caseId}`);
  refresh();
  return { ok: true, message: "Saved." };
}

/* ---------------- Stage 4: documented gaps ---------------- */

export async function raiseGap(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_gap_raise", {
    p_supplier: supplierId, p_gate: s(fd, "gate"), p_reason: s(fd, "reason"), p_owner: s(fd, "owner"), p_owner_type: s(fd, "owner_type"), p_due: s(fd, "due"),
  });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Gap proposed; a second person approves it." };
}

export async function decideGap(supplierId: string, gapId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_gap_decide", { p_gap: gapId, p_approve: fd.get("decision") === "approve", p_note: s(fd, "note") });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Decision recorded." };
}

/* ---------------- Stage 5: risk gates ---------------- */

export async function submitRiskReview(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const nti = s(fd, "nti_percent");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("onboarding_risk_submit", {
    p_supplier: supplierId,
    p: {
      category_fit: s(fd, "category_fit"), competitiveness: s(fd, "competitiveness"), nti_percent: nti === null ? null : Number(nti), quality: s(fd, "quality"),
      sustainability: s(fd, "sustainability"), audit_needed: fd.get("audit_needed") === "on", audit_notes: s(fd, "audit_notes"), client_requirements: s(fd, "client_requirements"),
    },
  });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: data === "approved" ? "No further approval needed under the risk rules." : "Submitted for approval." };
}

export async function decideRisk(supplierId: string, role: "cm" | "quality", _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_risk_decide", { p_supplier: supplierId, p_role: role, p_approve: fd.get("decision") === "approve", p_note: s(fd, "note") });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Decision recorded." };
}

/* ---------------- Stage 6-9 ---------------- */

export async function linkContract(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_contract_link", { p_contract: s(fd, "contract"), p_doc: s(fd, "doc") });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Contract tagged." };
}

export async function decideFinance(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_finance_decide", { p_supplier: supplierId, p_approve: fd.get("decision") === "approve", p_note: s(fd, "note") });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Finance decision recorded." };
}

export async function recordSystemId(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_record_system_id", {
    p_supplier: supplierId, p_system: s(fd, "system"), p_external_id: s(fd, "external_id"), p_name: s(fd, "name_in_system"), p_vat: s(fd, "vat_in_system"),
  });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "ID recorded. Reconcile when every required system has returned its ID." };
}

export async function reconcileIds(supplierId: string): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_reconcile_ids", { p_supplier: supplierId });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "IDs reconciled and status synchronised." };
}

export async function allocatePanels(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const panels = (s(fd, "panels") ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_allocate_panels", { p_supplier: supplierId, p_panels: panels });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Groups and panels saved." };
}

export async function activateSupplier(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_activate", {
    p_supplier: supplierId,
    p: {
      owner: s(fd, "owner"), welcome_pack_sent: fd.get("welcome_pack_sent") === "on", training: s(fd, "training"), evidence_location: s(fd, "evidence_location"),
      expiry_confirmed: fd.get("expiry_confirmed") === "on", review_cadence: s(fd, "review_cadence"), note: s(fd, "note"),
    },
  });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Released for use." };
}

/* ---------------- Fast-track ---------------- */

export async function requestFastTrack(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const jobs = fd.getAll("jobs").map(String).filter((j) => uuid.safeParse(j).success);
  const cap = s(fd, "value_cap");
  const supabase = await createClient();
  const { error } = await supabase.rpc("fast_track_request", {
    p_supplier: supplierId, p_urgency_reason: s(fd, "urgency_reason"), p_client_need: s(fd, "client_need"), p_required_date: s(fd, "required_date"),
    p_scope: { jobs, value_cap: cap === null ? null : Number(cap), currency: s(fd, "currency") ?? "EUR", systems: fd.getAll("systems").map(String), note: s(fd, "scope_note") },
    p_close_by: s(fd, "close_by"),
  });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Requested: the Procurement Director and Local Finance both approve it in their approvals inbox." };
}

export async function updateRemediation(supplierId: string, itemId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("onboarding_remediation_update", { p_item: itemId, p_status: s(fd, "status"), p_note: s(fd, "note") });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Saved." };
}

/* ---------------- Governance ---------------- */

export async function raiseRevalidation(supplierId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("srm_raise_event", { p_supplier: supplierId, p_event: s(fd, "event"), p_note: s(fd, "note") });
  if (error) return { error: friendly(error) };
  refresh(supplierId);
  return { ok: true, message: "Revalidation opened." };
}

export async function runReviewCadence(): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("srm_run_review_cadence", {});
  if (error) return { error: friendly(error) };
  refresh();
  return { ok: true, message: `${data ?? 0} review task(s) created.` };
}

export async function closeReviewTask(taskId: string, _: OnbResult, fd: FormData): Promise<OnbResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("srm_review_task_close", { p_task: taskId, p_outcome: s(fd, "outcome") });
  if (error) return { error: friendly(error) };
  refresh();
  return { ok: true, message: "Review recorded." };
}
