"use server";

// Server actions for the Assure+ SRM functions (beyond the SRT desk). Every action checks the caller is staff,
// validates input, then calls a SQL function or a write that row-level security allows. Decisions (verify, approve,
// transitions, signatures) always go through the audited SQL functions.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseQuestions, parseSteps } from "@/lib/assure";
import type { FormResult } from "@/components/assure/action-form";

type DbError = { message: string; code?: string } | null;

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};
const num = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const lines = (v: string | null) => (v ?? "").split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isUuid = (v: string | null): v is string => !!v && uuid.safeParse(v).success;

// Messages raised by our own SQL functions are written for users; anything else gets a generic message.
function friendly(e: DbError, fallback = "That didn't save. Try again."): string {
  if (!e) return fallback;
  if (e.code === "P0001" || e.code === "42501") return e.message;
  if (e.code === "23505") return "That record already exists.";
  if (e.code === "23514") return "One of the values isn't allowed. Check the form and try again.";
  if (e.code === "23502") return "A required field is missing.";
  if (/row-level security|permission denied/.test(e.message)) return "You don't have permission to do that.";
  return fallback;
}
const fail = (e: DbError, fallback?: string): FormResult => ({ error: friendly(e, fallback) });
const done = (message: string, ...paths: string[]): FormResult => {
  for (const p of paths) revalidatePath(p);
  return { ok: true, message };
};
const supplierPath = (id: string | null) => (id ? `/assure/suppliers/${id}` : "/assure/suppliers");

/* ---------------- Supplier 360 ---------------- */

export async function setSupplierStatus(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const ids = fd.getAll("ids").map(String).filter((x) => uuid.safeParse(x).success);
  const status = s(fd, "status");
  if (!ids.length) return { error: "Tick at least one supplier." };
  if (!status) return { error: "Choose a status." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_set_supplier_status_json", { p_ids: ids, p_status: status, p_reason: s(fd, "reason") });
  if (error) return fail(error);
  revalidatePath("/assure/suppliers", "layout");
  return { ok: true, message: `${data ?? 0} supplier${data === 1 ? "" : "s"} updated` };
}

export async function setRiskLevel(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  if (!isUuid(id)) return { error: "Supplier missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_set_risk_level", { p_supplier: id, p_level: s(fd, "risk_level"), p_reason: s(fd, "reason") });
  return error ? fail(error) : done("Risk level updated", supplierPath(id));
}

const profileSchema = z.object({
  legal_entity: z.string().nullable(), trading_name: z.string().nullable(),
  entity_type: z.enum(["manufacturer", "distributor", "service_provider", "raw_material", "logistics"]).nullable(),
  sub_category: z.string().nullable(), vendor_code: z.string().nullable(), uen_number: z.string().nullable(),
  website: z.string().regex(/^https?:\/\//i, "Website must start with http:// or https://").nullable(),
  address: z.string().nullable(), primary_contact_name: z.string().nullable(), contact_phone: z.string().nullable(),
  factory_count: z.number().int().min(0).nullable(),
  payment_terms: z.enum(["immediate", "net_7", "net_15", "net_30", "net_45", "net_60", "net_90", "custom"]),
  payment_terms_days: z.number().int().min(0).max(365).nullable(),
  nti_rate: z.number().min(0).max(100).nullable(),
  annual_spend_forecast: z.number().min(0).nullable(),
});

export async function saveProfile(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  if (!isUuid(id)) return { error: "Supplier missing." };
  const p = profileSchema.safeParse({
    legal_entity: s(fd, "legal_entity"), trading_name: s(fd, "trading_name"), entity_type: s(fd, "entity_type"), sub_category: s(fd, "sub_category"),
    vendor_code: s(fd, "vendor_code"), uen_number: s(fd, "uen_number"), website: s(fd, "website"), address: s(fd, "address"),
    primary_contact_name: s(fd, "primary_contact_name"), contact_phone: s(fd, "contact_phone"), factory_count: num(fd, "factory_count"),
    payment_terms: s(fd, "payment_terms") ?? "net_30", payment_terms_days: num(fd, "payment_terms_days"), nti_rate: num(fd, "nti_rate"),
    annual_spend_forecast: num(fd, "annual_spend_forecast"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  if (p.data.payment_terms === "custom" && p.data.payment_terms_days === null) return { error: "Enter the number of days for custom terms." };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_profiles").update({ ...p.data, payment_terms_days: p.data.payment_terms === "custom" ? p.data.payment_terms_days : null }).eq("supplier_id", id);
  return error ? fail(error) : done("Saved", supplierPath(id));
}

export async function logActivity(_: FormResult, fd: FormData): Promise<FormResult> {
  const me = await requireInternal();
  const id = s(fd, "supplier_id");
  const kind = s(fd, "kind");
  const title = s(fd, "title");
  if (!isUuid(id)) return { error: "Supplier missing." };
  if (!kind || !["note", "email", "meeting", "call"].includes(kind)) return { error: "Choose what you're logging." };
  if (!title) return { error: "Give it a short title." };
  const supabase = await createClient();
  const { error } = await supabase.from("assure_activity").insert({ supplier_id: id, entity: "note", action: "logged", kind, title, body: s(fd, "body"), actor: me.id });
  return error ? fail(error) : done("Logged", supplierPath(id));
}

/* ---------------- Compliance ---------------- */

export async function addCertificate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  const type = s(fd, "cert_type_id");
  if (!isUuid(id) || !isUuid(type)) return { error: "Choose the supplier and certificate type." };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_certificates").insert({
    supplier_id: id, cert_type_id: type, cert_number: s(fd, "cert_number"), issuer: s(fd, "issuer"),
    issue_date: s(fd, "issue_date"), expiry_date: s(fd, "expiry_date"), audit_score: num(fd, "audit_score"),
    document_path: s(fd, "document_path"), not_applicable: bool(fd, "not_applicable"), internal_notes: s(fd, "internal_notes"),
  });
  if (error) return fail(error);
  revalidatePath("/assure/compliance", "layout");
  return done("Certificate added. Someone else needs to verify it.", supplierPath(id));
}

export async function updateCertificate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Certificate missing." };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_certificates").update({
    cert_number: s(fd, "cert_number"), issue_date: s(fd, "issue_date"), expiry_date: s(fd, "expiry_date"),
    audit_score: num(fd, "audit_score"), internal_notes: s(fd, "internal_notes"), not_applicable: bool(fd, "not_applicable"),
  }).eq("id", id);
  if (error) return fail(error);
  revalidatePath("/assure/compliance", "layout");
  return done("Certificate saved", supplierPath(s(fd, "supplier_id")));
}

export async function reviewCertificate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const decision = s(fd, "decision");
  if (!isUuid(id) || (decision !== "verify" && decision !== "reject")) return { error: "Choose verify or reject." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_review_certificate", { p_id: id, p_decision: decision, p_reason: s(fd, "reason") });
  if (error) return fail(error);
  revalidatePath("/assure/compliance", "layout");
  return done(decision === "verify" ? "Certificate verified" : "Certificate rejected", supplierPath(s(fd, "supplier_id")));
}

export async function reviewDocument(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const decision = s(fd, "decision");
  if (!isUuid(id) || (decision !== "verify" && decision !== "reject")) return { error: "Choose verify or reject." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_review_document", { p_id: id, p_decision: decision, p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/compliance", "layout");
  return done(decision === "verify" ? "Document verified" : "Document rejected", supplierPath(s(fd, "supplier_id")));
}

export async function addDocument(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  if (!isUuid(id)) return { error: "Supplier missing." };
  const title = s(fd, "title");
  const path = s(fd, "file_path");
  if (!title || !path) return { error: "Enter a title and the file location." };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_documents").insert({ supplier_id: id, doc_type: s(fd, "doc_type") ?? "other", title, file_path: path, po_reference: s(fd, "po_reference") });
  if (error) return fail(error);
  revalidatePath("/assure/compliance", "layout");
  return done("Document added. Someone else needs to check it.", supplierPath(id));
}

/* ---------------- Pre-assessment ---------------- */

export async function paTransition(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const action = s(fd, "action");
  if (!isUuid(id) || !action) return { error: "Choose an action." };
  const terms = ["send_terms", "confirm_onboarding"].includes(action)
    ? Object.fromEntries(Object.entries({
        nti: num(fd, "nti"), payment_terms: s(fd, "payment_terms"), payment_terms_days: num(fd, "payment_terms_days"),
        annual_spend_forecast: num(fd, "annual_spend_forecast"), tier: s(fd, "tier"),
      }).filter(([, v]) => v !== null))
    : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_pa_transition", { p_id: id, p_action: action, p_notes: s(fd, "notes"), p_feedback: s(fd, "feedback"), p_terms: terms });
  if (error) return fail(error);
  revalidatePath("/assure/pre-assessments", "layout");
  return done("Saved");
}

/* ---------------- Quality ---------------- */

export async function logInspection(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  if (!isUuid(id)) return { error: "Choose the supplier." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_log_inspection", {
    p: {
      supplier_id: id, po_reference: s(fd, "po_reference"), product_name: s(fd, "product_name"), inspection_type: s(fd, "inspection_type"),
      inspection_date: s(fd, "inspection_date"), sample_size: s(fd, "sample_size"), defect_count: s(fd, "defect_count"),
      defects_found: lines(s(fd, "defects_found")), aql_level: s(fd, "aql_level"), result: s(fd, "result") ?? "pending",
      corrective_action_required: bool(fd, "corrective_action_required"), corrective_action_notes: s(fd, "corrective_action_notes"),
      internal_notes: s(fd, "internal_notes"),
    },
  });
  if (error) return fail(error);
  revalidatePath("/assure/quality", "layout");
  return done("Inspection logged", supplierPath(id));
}

export async function setInspectionResult(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Inspection missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_set_inspection_result", { p_id: id, p_result: s(fd, "result"), p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/quality", "layout");
  return done("Result updated");
}

export async function raiseNcr(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supplier = s(fd, "supplier_id");
  const category = s(fd, "category_id");
  const title = s(fd, "title");
  if (!isUuid(supplier) || !isUuid(category)) return { error: "Choose the supplier and category." };
  if (!title) return { error: "Describe the non-conformance in a few words." };
  const supabase = await createClient();
  const inspection = s(fd, "inspection_id");
  const { data, error } = await supabase.from("ncrs").insert({
    supplier_id: supplier, category_id: category, severity: s(fd, "severity") ?? "major", title, description: s(fd, "description"),
    po_reference: s(fd, "po_reference"), inspection_id: isUuid(inspection) ? inspection : null, due_date: s(fd, "due_date"), internal_notes: s(fd, "internal_notes"),
  }).select("id").single();
  if (error) return fail(error);
  revalidatePath("/assure/quality", "layout");
  redirect(`/assure/quality/ncr/${(data as { id: string }).id}`);
}

export async function setNcrNotes(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "NCR missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_ncr_set_notes", { p_id: id, p_notes: s(fd, "internal_notes") });
  return error ? fail(error) : done("Notes saved", `/assure/quality/ncr/${id}`);
}

export async function addCorrectiveAction(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "ncr_id");
  const description = s(fd, "description");
  if (!isUuid(id) || !description) return { error: "Describe the corrective action." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_ca_add", { p_ncr: id, p_description: description, p_owner: s(fd, "owner_side") ?? "supplier", p_due: s(fd, "due_date") });
  return error ? fail(error) : done("Corrective action added", `/assure/quality/ncr/${id}`);
}

export async function setCorrectiveAction(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Action missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_ca_set_status", { p_id: id, p_status: s(fd, "status"), p_note: s(fd, "note") });
  return error ? fail(error) : done("Updated", `/assure/quality/ncr/${s(fd, "ncr_id")}`);
}

export async function closeNcr(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "NCR missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_ncr_close", { p_id: id, p_outcome: s(fd, "outcome") ?? "closed", p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/quality", "layout");
  return done("NCR updated");
}

/* ---------------- Performance ---------------- */

export async function recordPerformance(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  const period = s(fd, "period");
  if (!isUuid(id)) return { error: "Supplier missing." };
  if (!period || !/^\d{4}-Q[1-4]$/.test(period)) return { error: "Period must look like 2026-Q3." };
  const scores: Record<string, number | string | null> = {};
  for (const k of ["cost", "otif", "quality", "compliance", "sustainability", "defect_rate"]) {
    const v = num(fd, k);
    if (v !== null && (v < 0 || v > 100)) return { error: "Scores and defect rate are 0 to 100." };
    scores[k] = v;
  }
  scores.ncr_count = num(fd, "ncr_count") ?? 0;
  scores.notes = s(fd, "notes");
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_record_performance", { p_supplier: id, p_period: period, p_scores: scores });
  if (error) return fail(error);
  revalidatePath("/assure/performance", "layout");
  return done(`Scores for ${period} saved`, supplierPath(id));
}

export async function generateIssues(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "supplier_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_generate_issues", { p_supplier: isUuid(id) ? id : null });
  if (error) return fail(error);
  revalidatePath("/assure/performance", "layout");
  return done(data ? `${data} new issue${data === 1 ? "" : "s"} raised` : "No new issues: everything above the thresholds is already in the feed", supplierPath(id));
}

export async function resolveIssue(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Issue missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_issue_resolve", { p_id: id, p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/performance", "layout");
  return done("Issue resolved", supplierPath(s(fd, "supplier_id")));
}

/* ---------------- Contracts ---------------- */

export async function createContract(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const title = s(fd, "title");
  if (!title) return { error: "Give the contract a title." };
  const supplier = s(fd, "supplier_id");
  const template = s(fd, "template_id");
  const supabase = await createClient();
  let content = s(fd, "content_summary");
  if (!content && isUuid(template)) {
    const { data: tpl } = await supabase.from("contract_templates").select("content").eq("id", template).maybeSingle();
    content = (tpl as { content: string | null } | null)?.content ?? null;
  }
  const { data, error } = await supabase.from("contracts").insert({
    title, supplier_id: isUuid(supplier) ? supplier : null, template_id: isUuid(template) ? template : null,
    document_type: s(fd, "document_type") ?? "contract", value: num(fd, "value"), currency: s(fd, "currency") ?? "EUR",
    start_date: s(fd, "start_date"), end_date: s(fd, "end_date"), due_date: s(fd, "due_date"), content_summary: content,
    document_path: s(fd, "document_path"), internal_notes: s(fd, "internal_notes"),
  }).select("id").single();
  if (error) return fail(error);
  revalidatePath("/assure/contracts", "layout");
  redirect(`/assure/contracts/${(data as { id: string }).id}`);
}

export async function updateContract(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Contract missing." };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { internal_notes: s(fd, "internal_notes"), due_date: s(fd, "due_date") };
  if (fd.get("draft") === "1") Object.assign(patch, {
    title: s(fd, "title"), document_type: s(fd, "document_type"), value: num(fd, "value"), currency: s(fd, "currency") ?? "EUR",
    start_date: s(fd, "start_date"), end_date: s(fd, "end_date"), content_summary: s(fd, "content_summary"), document_path: s(fd, "document_path"),
  });
  const { error } = await supabase.from("contracts").update(patch).eq("id", id);
  return error ? fail(error) : done("Contract saved", `/assure/contracts/${id}`);
}

export async function addParty(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "contract_id");
  const name = s(fd, "name");
  const email = s(fd, "email");
  if (!isUuid(id) || !name || !email || !z.string().email().safeParse(email).success) return { error: "Enter a name and a valid email." };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_parties").insert({
    contract_id: id, name, email, role: s(fd, "role") ?? "signer", signing_order: num(fd, "signing_order") ?? 1, is_internal: bool(fd, "is_internal"),
  });
  return error ? fail(error) : done("Recipient added", `/assure/contracts/${id}`);
}

export async function removeParty(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Recipient missing." };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_parties").delete().eq("id", id);
  return error ? fail(error) : done("Recipient removed", `/assure/contracts/${s(fd, "contract_id")}`);
}

export async function contractAction(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const action = s(fd, "action");
  if (!isUuid(id) || !action) return { error: "Choose an action." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_contract_action", { p_id: id, p_action: action, p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/contracts", "layout");
  if (action === "amend" && typeof data === "string") redirect(`/assure/contracts/${data}`);
  return done("Done");
}

export async function signParty(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Recipient missing." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_contract_sign", { p_party: id, p_evidence: s(fd, "evidence") });
  if (error) return fail(error);
  revalidatePath("/assure/contracts", "layout");
  return done(data === "counter_signed" ? "Signature recorded. Every signer is done, so the contract is finalised." : "Signature recorded");
}

export async function commentContract(_: FormResult, fd: FormData): Promise<FormResult> {
  const me = await requireInternal();
  const id = s(fd, "contract_id");
  const body = s(fd, "body");
  if (!isUuid(id) || !body) return { error: "Write a comment first." };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_activity").insert({ contract_id: id, event_type: "commented", description: body, actor: me.id });
  return error ? fail(error) : done("Comment added", `/assure/contracts/${id}`);
}

export async function addNegotiation(_: FormResult, fd: FormData): Promise<FormResult> {
  const me = await requireInternal();
  const id = s(fd, "contract_id");
  const clause = s(fd, "clause");
  const complexity = s(fd, "complexity");
  const risk = s(fd, "risk");
  if (!isUuid(id) || !clause || !complexity || !risk) return { error: "Enter the clause, complexity and risk." };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_negotiations").insert({ contract_id: id, clause, complexity, risk, rationale: s(fd, "rationale"), logged_by: me.id });
  return error ? fail(error) : done("Logged", `/assure/contracts/${id}`);
}

export async function saveTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const name = s(fd, "name");
  if (!name) return { error: "Give the template a name." };
  const row = { name, category: s(fd, "category") ?? "custom", folder: s(fd, "folder"), description: s(fd, "description"), content: s(fd, "content"), is_active: bool(fd, "is_active") };
  const supabase = await createClient();
  const { error } = isUuid(id) ? await supabase.from("contract_templates").update(row).eq("id", id) : await supabase.from("contract_templates").insert(row);
  return error ? fail(error) : done("Template saved", "/assure/contracts/templates");
}

export async function deleteTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Template missing." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("contract_templates").delete().eq("id", id).select("id");
  if (error) return fail(error, "Templates used by contracts can't be deleted; mark them inactive instead.");
  if (!(data as unknown[] | null)?.length) return { error: "Only an admin or the person who created it can delete this template." };
  return done("Template deleted", "/assure/contracts/templates");
}

/* ---------------- Business reviews ---------------- */

export async function saveReview(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const supplier = s(fd, "supplier_id");
  const title = s(fd, "title");
  const meeting = s(fd, "meeting_date");
  if (!isUuid(id) && !isUuid(supplier)) return { error: "Choose the supplier." };
  if (!title || !meeting || !date.safeParse(meeting).success) return { error: "Enter a topic and the meeting date." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_review_save", {
    p_id: isUuid(id) ? id : null,
    p: {
      supplier_id: supplier, title, description: s(fd, "description"), review_type: s(fd, "review_type"), meeting_date: meeting,
      status: s(fd, "status"), internal_attendees: lines(s(fd, "internal_attendees")), vendor_attendees: lines(s(fd, "vendor_attendees")),
      agenda_items: (s(fd, "agenda_items") ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
      shared_with_vendor: bool(fd, "shared_with_vendor"), key_outcomes: s(fd, "key_outcomes") ?? "", discussion_notes: s(fd, "discussion_notes") ?? "",
      overall_sentiment: s(fd, "overall_sentiment") ?? "", next_review_date: s(fd, "next_review_date") ?? "",
    },
  });
  if (error) return fail(error);
  revalidatePath("/assure/reviews", "layout");
  if (!isUuid(id)) redirect(`/assure/reviews/${data as string}`);
  return done("Review saved");
}

export async function approveOutcomes(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Review missing." };
  const approve = s(fd, "decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_review_approve_outcomes", { p_id: id, p_approve: approve, p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/reviews", "layout");
  return done(approve ? "Outcomes approved" : "Outcomes rejected");
}

/* ---------------- Tasks ---------------- */

export async function createTask(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supplier = s(fd, "supplier_id");
  const title = s(fd, "title");
  if (!isUuid(supplier) || !title) return { error: "Choose the supplier and give the task a title." };
  const supabase = await createClient();
  const { error } = await supabase.from("action_plan_tasks").insert({
    supplier_id: supplier, title, description: s(fd, "description"), category: s(fd, "category") ?? "other",
    priority: s(fd, "priority") ?? "medium", due_date: s(fd, "due_date"), source: s(fd, "source") ?? "manual",
  });
  if (error) return fail(error);
  revalidatePath("/assure/tasks");
  return done("Task added", supplierPath(supplier));
}

export async function setTaskStatus(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Task missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_task_set_status", { p_id: id, p_status: s(fd, "status"), p_note: s(fd, "note") });
  if (error) return fail(error);
  revalidatePath("/assure/tasks");
  return done("Task updated", supplierPath(s(fd, "supplier_id")));
}

/* ---------------- Surveys ---------------- */

export async function saveSurveyTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const name = s(fd, "name");
  if (!name) return { error: "Give the survey a name." };
  const q = parseQuestions(s(fd, "questions") ?? "");
  if (q.error) return { error: q.error };
  if (!q.questions.length) return { error: "Add at least one question." };
  const row = { name, description: s(fd, "description"), category: s(fd, "category") ?? "general", questions: q.questions, is_active: bool(fd, "is_active") };
  const supabase = await createClient();
  const { error } = isUuid(id) ? await supabase.from("survey_templates").update(row).eq("id", id) : await supabase.from("survey_templates").insert(row);
  return error ? fail(error) : done("Survey template saved", "/assure/surveys");
}

export async function launchSurvey(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const tpl = s(fd, "template_id");
  const supplier = s(fd, "supplier_id");
  if (!isUuid(tpl) || !isUuid(supplier)) return { error: "Choose the survey and the supplier." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_survey_launch", { p_template: tpl, p_supplier: supplier, p_due: s(fd, "due_date") });
  return error ? fail(error) : done("Survey sent to the vendor", "/assure/surveys");
}

export async function reviewSurvey(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Response missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_survey_review", { p_id: id, p_decision: s(fd, "decision"), p_notes: s(fd, "notes"), p_feedback: s(fd, "feedback") });
  if (error) return fail(error);
  revalidatePath("/assure/surveys", "layout");
  return done("Review saved");
}

/* ---------------- Workflows ---------------- */

export async function launchWorkflow(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const tpl = s(fd, "template_id");
  const supplier = s(fd, "supplier_id");
  if (!isUuid(tpl) || !isUuid(supplier)) return { error: "Choose the workflow and the supplier." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_workflow_launch", { p_template: tpl, p_supplier: supplier, p_priority: s(fd, "priority") });
  if (error) return fail(error);
  revalidatePath("/assure/workflows", "layout");
  redirect(`/assure/workflows/${data as string}`);
}

export async function workflowAct(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Workflow missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_workflow_act", { p_instance: id, p_action: s(fd, "action"), p_notes: s(fd, "notes") });
  if (error) return fail(error);
  revalidatePath("/assure/workflows", "layout");
  return done("Saved");
}

export async function saveWorkflowTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const name = s(fd, "name");
  if (!name) return { error: "Give the workflow a name." };
  const st = parseSteps(s(fd, "steps") ?? "");
  if (st.error) return { error: st.error };
  const row = {
    name, description: s(fd, "description"), workflow_type: s(fd, "workflow_type") ?? "custom", category: s(fd, "category") ?? "other",
    priority: s(fd, "priority") ?? "medium", steps: st.steps, is_active: bool(fd, "is_active"),
  };
  const supabase = await createClient();
  const { error } = isUuid(id) ? await supabase.from("workflow_templates").update(row).eq("id", id) : await supabase.from("workflow_templates").insert(row);
  return error ? fail(error) : done("Workflow template saved", "/assure/workflows");
}

/* ---------------- Messages ---------------- */

export async function startConversation(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supplier = s(fd, "supplier_id");
  const subject = s(fd, "subject");
  if (!isUuid(supplier) || !subject) return { error: "Choose the supplier and write a subject." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("conversations").insert({ supplier_id: supplier, subject }).select("id").single();
  if (error) return fail(error);
  const id = (data as { id: string }).id;
  const body = s(fd, "body");
  if (body) await supabase.from("messages").insert({ conversation_id: id, body });
  revalidatePath("/assure/messages");
  redirect(`/assure/messages?c=${id}`);
}

export async function sendMessage(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "conversation_id");
  const body = s(fd, "body");
  if (!isUuid(id) || !body) return { error: "Write a message first." };
  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({ conversation_id: id, body });
  return error ? fail(error) : done("Sent", "/assure/messages");
}

export async function markConversationRead(id: string): Promise<void> {
  await requireInternal();
  if (!uuid.safeParse(id).success) return;
  const supabase = await createClient();
  await supabase.rpc("assure_mark_conversation_read", { p_conversation: id });
}

/* ---------------- Training ---------------- */

export async function saveTrainingModule(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  const title = s(fd, "title");
  const url = s(fd, "url");
  if (!title) return { error: "Give the module a title." };
  if (url && !/^https:\/\//i.test(url)) return { error: "Links must start with https://" };
  const row = {
    title, resource_type: s(fd, "resource_type") ?? "document", description: s(fd, "description"), url, content: s(fd, "content"),
    category: s(fd, "category") ?? "General", audience: s(fd, "audience") ?? "all", duration_minutes: num(fd, "duration_minutes"),
    display_order: num(fd, "display_order") ?? 0, active: bool(fd, "active"),
  };
  const supabase = await createClient();
  const { error } = isUuid(id) ? await supabase.from("training_modules").update(row).eq("id", id) : await supabase.from("training_modules").insert(row);
  return error ? fail(error) : done("Training module saved", "/assure/training");
}

export async function startTraining(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "module_id");
  if (!isUuid(id)) return { error: "Module missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_training_start", { p_module: id });
  return error ? fail(error) : done("Started", "/assure/training");
}

export async function trainingProgress(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = s(fd, "id");
  if (!isUuid(id)) return { error: "Assignment missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assure_training_progress", { p_id: id, p_status: s(fd, "status"), p_reason: s(fd, "reason") });
  return error ? fail(error) : done("Updated", "/assure/training");
}

export async function assignTraining(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const moduleId = s(fd, "module_id");
  const users = fd.getAll("users").map(String).filter((x) => uuid.safeParse(x).success);
  if (!isUuid(moduleId) || !users.length) return { error: "Choose the module and at least one person." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assure_training_assign_json", { p_module: moduleId, p_users: users, p_due: s(fd, "due_date") });
  if (error) return fail(error);
  return done(`${data ?? 0} assignment${data === 1 ? "" : "s"} made (people already assigned are skipped)`, "/assure/training");
}
