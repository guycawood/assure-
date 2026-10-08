// Assure+ SRM: pure types, labels and calculations shared by the internal pages. No I/O.
import type { Tone } from "@/lib/srt";

export type Opt = { value: string; label: string; tone?: Tone };
export const optLabel = (list: Opt[], v: string | null | undefined) => list.find((o) => o.value === v)?.label ?? (v ? v.replace(/_/g, " ") : "");
export const optTone = (list: Opt[], v: string | null | undefined): Tone => list.find((o) => o.value === v)?.tone ?? "neutral";

/* ---------------- Supplier ---------------- */
export const SUPPLIER_STATUS: Opt[] = [
  { value: "active", label: "Active", tone: "ok" },
  { value: "pending_approval", label: "Pending approval", tone: "info" },
  { value: "onboarding", label: "Onboarding", tone: "info" },
  { value: "under_review", label: "Under review", tone: "warn" },
  { value: "suspended", label: "Suspended", tone: "bad" },
  { value: "offboarded", label: "Offboarded", tone: "neutral" },
  { value: "inactive", label: "Inactive", tone: "neutral" },
];
export const SUPPLIER_TIER: Opt[] = [
  { value: "strategic", label: "Strategic", tone: "accent" },
  { value: "preferred", label: "Preferred", tone: "ok" },
  { value: "approved", label: "Approved", tone: "info" },
  { value: "conditional", label: "Conditional", tone: "warn" },
  { value: "transactional", label: "Transactional", tone: "neutral" },
  { value: "tail", label: "Tail", tone: "neutral" },
];
export const RISK: Opt[] = [
  { value: "low", label: "Low", tone: "ok" },
  { value: "medium", label: "Medium", tone: "info" },
  { value: "high", label: "High", tone: "warn" },
  { value: "critical", label: "Critical", tone: "bad" },
];
export const ENTITY_TYPES: Opt[] = [
  { value: "manufacturer", label: "Manufacturer" }, { value: "distributor", label: "Distributor" },
  { value: "service_provider", label: "Service provider" }, { value: "raw_material", label: "Raw material" }, { value: "logistics", label: "Logistics" },
];
export const PAYMENT_TERMS: Opt[] = [
  { value: "immediate", label: "Immediate" }, { value: "net_7", label: "Net 7" }, { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" }, { value: "net_45", label: "Net 45" }, { value: "net_60", label: "Net 60" },
  { value: "net_90", label: "Net 90" }, { value: "custom", label: "Custom" },
];
const TERM_DAYS: Record<string, number> = { immediate: 0, net_7: 7, net_15: 15, net_30: 30, net_45: 45, net_60: 60, net_90: 90 };
export function paymentTermDays(terms: string | null | undefined, customDays?: number | null): number | null {
  if (!terms) return null;
  if (terms === "custom") return customDays ?? null;
  return TERM_DAYS[terms] ?? null;
}
export const paymentTermLabel = (terms: string | null | undefined, days?: number | null) =>
  terms === "custom" ? `Custom (${days ?? "?"} days)` : optLabel(PAYMENT_TERMS, terms);
/** NTI value = spend × NTI rate. */
export const ntiValue = (spend: number | null | undefined, rate: number | null | undefined) => (Number(spend ?? 0) * Number(rate ?? 0)) / 100;

export interface SupplierProfile {
  supplier_id: string;
  legal_entity: string | null;
  trading_name: string | null;
  entity_type: string | null;
  sub_category: string | null;
  vendor_code: string | null;
  uen_number: string | null;
  website: string | null;
  address: string | null;
  primary_contact_name: string | null;
  contact_phone: string | null;
  factory_count: number | null;
  payment_terms: string;
  payment_terms_days: number | null;
  nti_rate: number | null;
  annual_spend_forecast: number | null;
  risk_level: string;
  risk_reason: string | null;
  updated_at: string;
}

export interface Activity {
  id: number;
  supplier_id: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  title: string | null;
  body: string | null;
  kind: string;
  actor: string | null;
  created_at: string;
}

/* ---------------- Compliance ---------------- */
export type ExpiryStatus = "expired" | "expiring_soon" | "valid" | "no_expiry";
export const EXPIRY_WINDOW_DAYS = 90;
/** Mirrors assure_expiry_status() in SQL: expired once the date has passed, expiring within 90 days, else valid. */
export function expiryStatus(expiry: string | null | undefined, on: string = new Date().toISOString().slice(0, 10)): ExpiryStatus {
  if (!expiry) return "no_expiry";
  if (expiry < on) return "expired";
  const limit = new Date(on + "T00:00:00Z");
  limit.setUTCDate(limit.getUTCDate() + EXPIRY_WINDOW_DAYS);
  return expiry <= limit.toISOString().slice(0, 10) ? "expiring_soon" : "valid";
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

export const CERT_STATUS: Opt[] = [
  { value: "valid", label: "Valid", tone: "ok" },
  { value: "expiring_soon", label: "Expiring soon", tone: "warn" },
  { value: "expired", label: "Expired", tone: "bad" },
  { value: "pending", label: "To check", tone: "info" },
  { value: "rejected", label: "Rejected", tone: "bad" },
  { value: "not_applicable", label: "Not applicable", tone: "neutral" },
  { value: "no_expiry", label: "No expiry", tone: "ok" },
];
export interface Certificate {
  id: string;
  supplier_id: string;
  cert_type_id: string;
  cert_type_code: string | null;
  cert_type_name: string;
  region: string | null;
  market: string | null;
  cert_number: string | null;
  issuer: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  audit_score: number | null;
  document_path: string | null;
  not_applicable: boolean;
  verification_status: "pending" | "verified" | "rejected";
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  internal_notes: string | null;
  uploaded_by: string | null;
  uploaded_by_role: "internal" | "vendor";
  status: string;
  expiry_status: ExpiryStatus;
  days_left: number | null;
  created_at: string;
}

export const DOC_TYPES: Opt[] = [
  { value: "grn", label: "Goods received note" }, { value: "bill_of_lading", label: "Bill of lading" }, { value: "invoice", label: "Invoice" },
  { value: "delivery_note", label: "Delivery note" }, { value: "customs_declaration", label: "Customs declaration" },
  { value: "quality_certificate", label: "Quality certificate" }, { value: "packing_list", label: "Packing list" },
  { value: "proof_of_delivery", label: "Proof of delivery" }, { value: "insurance", label: "Insurance" }, { value: "nda", label: "NDA" },
  { value: "policy", label: "Policy" }, { value: "contract", label: "Contract" }, { value: "other", label: "Other" },
];
export const REVIEW_STATUS: Opt[] = [
  { value: "pending", label: "To check", tone: "info" }, { value: "verified", label: "Verified", tone: "ok" }, { value: "rejected", label: "Rejected", tone: "bad" },
];
export interface SupplierDocument {
  id: string;
  supplier_id: string;
  doc_type: string;
  title: string;
  file_path: string;
  po_reference: string | null;
  status: "pending" | "verified" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  uploaded_by: string | null;
  uploaded_by_role: "internal" | "vendor";
  created_at: string;
}

/* ---------------- Pre-assessment ---------------- */
export const PA_STATUS: Opt[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "submitted", label: "New", tone: "info" },
  { value: "under_review", label: "Vendor-manager review", tone: "accent" },
  { value: "vm_approved", label: "Approved by vendor manager", tone: "ok" },
  { value: "vm_rejected", label: "Declined", tone: "bad" },
  { value: "procurement_review", label: "Procurement review", tone: "accent" },
  { value: "negotiation", label: "Negotiation", tone: "warn" },
  { value: "onboarded", label: "Onboarded", tone: "ok" },
  { value: "rejected", label: "Rejected", tone: "bad" },
];
export const PA_PIPELINE = ["submitted", "under_review", "vm_approved", "procurement_review", "negotiation", "onboarded"];
/** Which transition buttons apply in a status (the database decides who may press them). */
export function paActions(status: string): { vm: string[]; proc: string[] } {
  return {
    vm: status === "submitted" ? ["start_review", "request_info", "vm_approve", "vm_reject"] : status === "under_review" ? ["request_info", "vm_approve", "vm_reject"] : [],
    proc: status === "vm_approved" ? ["start_procurement"] : status === "procurement_review" ? ["send_terms", "reject"] : status === "negotiation" ? ["confirm_onboarding", "reject"] : [],
  };
}
export const PA_ACTION_LABEL: Record<string, string> = {
  start_review: "Start review", request_info: "Ask the vendor for more information", vm_approve: "Approve and pass to procurement",
  vm_reject: "Decline", start_procurement: "Start procurement review", send_terms: "Send proposed terms", confirm_onboarding: "Confirm onboarding", reject: "Reject",
};
export interface PreAssessment {
  id: string;
  supplier_id: string;
  region: string | null;
  market: string | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string;
  major_category: string | null;
  head_office_country: string | null;
  data: Record<string, unknown>;
  status: string;
  workflow_stage: string;
  feedback_to_vendor: string | null;
  submitted_at: string | null;
  created_at: string;
}
export interface PreAssessmentReview {
  assessment_id: string;
  vm_notes: string | null;
  vm_reviewed_by: string | null;
  vm_reviewed_at: string | null;
  procurement_notes: string | null;
  nti_proposed: number | null;
  payment_terms_proposed: string | null;
  payment_terms_days_proposed: number | null;
  annual_spend_forecast: number | null;
  proposed_tier: string | null;
  nti_agreed: number | null;
  payment_terms_agreed: string | null;
  tier_agreed: string | null;
  procurement_reviewed_by: string | null;
  onboarded_by: string | null;
  onboarded_at: string | null;
}

/* ---------------- Quality ---------------- */
export const INSPECTION_TYPES: Opt[] = [
  { value: "incoming_material", label: "Incoming material" }, { value: "in_process", label: "In-process" },
  { value: "final", label: "Final" }, { value: "pre_shipment", label: "Pre-shipment" }, { value: "other", label: "Other" },
];
export const INSPECTION_RESULT: Opt[] = [
  { value: "pass", label: "Pass", tone: "ok" }, { value: "conditional_pass", label: "Conditional pass", tone: "warn" },
  { value: "fail", label: "Fail", tone: "bad" }, { value: "pending", label: "Pending", tone: "info" },
];
export const NCR_SEVERITY: Opt[] = [
  { value: "critical", label: "Critical", tone: "bad" }, { value: "major", label: "Major", tone: "warn" }, { value: "minor", label: "Minor", tone: "info" },
];
export const ACK_STATUS: Opt[] = [
  { value: "pending", label: "Waiting for vendor", tone: "warn" }, { value: "acknowledged", label: "Acknowledged", tone: "info" },
  { value: "responded", label: "Vendor responded", tone: "accent" }, { value: "disputed", label: "Disputed", tone: "bad" },
  { value: "resolved", label: "Resolved", tone: "ok" },
];
export interface Inspection {
  id: string;
  inspection_ref: string;
  supplier_id: string;
  po_reference: string | null;
  product_name: string | null;
  inspection_type: string;
  inspection_date: string;
  inspector: string | null;
  sample_size: number | null;
  defect_count: number;
  defects_found: string[] | null;
  aql_level: string | null;
  result: string;
  corrective_action_required: boolean;
  corrective_action_notes: string | null;
  internal_notes: string | null;
  created_at: string;
}
export interface Ncr {
  id: string;
  ncr_ref: string;
  supplier_id: string;
  inspection_id: string | null;
  category_id: string;
  severity: string;
  title: string;
  description: string | null;
  po_reference: string | null;
  status: "open" | "closed" | "cancelled";
  acknowledgement_status: string;
  supplier_response: string | null;
  root_cause: string | null;
  due_date: string | null;
  raised_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  internal_notes: string | null;
  created_at: string;
}
export interface CorrectiveAction {
  id: string;
  ncr_id: string;
  supplier_id: string;
  description: string;
  owner_side: "supplier" | "internal";
  due_date: string | null;
  status: "open" | "done" | "verified";
  done_by: string | null;
  done_at: string | null;
  done_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
}
/** Pass rate over inspections that have a result (pending excluded, unlike the prototype). */
export function passRate(results: string[]): number | null {
  const decided = results.filter((r) => r !== "pending");
  if (!decided.length) return null;
  return Math.round((decided.filter((r) => r === "pass").length / decided.length) * 100);
}

/* ---------------- Performance ---------------- */
export interface PerformanceRecord {
  id: string;
  supplier_id: string;
  period: string;
  cost_score: number | null;
  otif_score: number | null;
  quality_score: number | null;
  compliance_score: number | null;
  sustainability_score: number | null;
  composite_score: number | null;
  ncr_count: number;
  defect_rate: number | null;
  internal_notes: string | null;
  updated_at: string;
}
export const SCORE_KEYS = [
  ["cost_score", "Cost"], ["otif_score", "OTIF"], ["quality_score", "Quality"], ["compliance_score", "Compliance"], ["sustainability_score", "Sustainability"],
] as const;
/** Score colour bands from the prototype gauges: 80+ green, 60+ amber, else red. */
export const scoreTone = (s: number | null | undefined): Tone => (s === null || s === undefined ? "neutral" : s >= 80 ? "ok" : s >= 60 ? "warn" : "bad");
export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

export type ReportStatus = "on_track" | "watch" | "below" | "no_data";
/** Performance report rule: gap = smallest of (score − threshold); ≥0 on track, ≥−10 watch, else below. Missing scores don't count. */
export function reportStatus(compliance: number | null | undefined, sustainability: number | null | undefined, ct: number, st: number): ReportStatus {
  if ((compliance === null || compliance === undefined) && (sustainability === null || sustainability === undefined)) return "no_data";
  const gap = Math.min(compliance != null ? compliance - ct : 0, sustainability != null ? sustainability - st : 0);
  return gap >= 0 ? "on_track" : gap >= -10 ? "watch" : "below";
}
export const REPORT_STATUS: Opt[] = [
  { value: "below", label: "Below threshold", tone: "bad" }, { value: "watch", label: "Watch", tone: "warn" },
  { value: "on_track", label: "On track", tone: "ok" }, { value: "no_data", label: "No data", tone: "neutral" },
];
export const avg = (nums: (number | null | undefined)[]) => {
  const v = nums.filter((n): n is number => n !== null && n !== undefined).map(Number);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
export interface PerformanceIssue {
  id: string;
  supplier_id: string;
  issue_type: string;
  title: string;
  period: string | null;
  severity: string;
  acknowledgement_status: string;
  supplier_response: string | null;
  corrective_action: string | null;
  target_resolution_date: string | null;
  internal_notes: string | null;
  resolved_at: string | null;
  created_at: string;
}
export const SEVERITY: Opt[] = [
  { value: "critical", label: "Critical", tone: "bad" }, { value: "high", label: "High", tone: "warn" },
  { value: "medium", label: "Medium", tone: "info" }, { value: "low", label: "Low", tone: "neutral" },
];

/* ---------------- Contracts ---------------- */
export const CONTRACT_STATUS: Opt[] = [
  { value: "draft", label: "Draft", tone: "neutral" }, { value: "sent", label: "Sent", tone: "info" },
  { value: "viewed", label: "Viewed", tone: "info" }, { value: "in_review", label: "In review", tone: "accent" },
  { value: "signed", label: "Signed", tone: "ok" }, { value: "counter_signed", label: "Fully signed", tone: "ok" },
  { value: "declined", label: "Declined", tone: "bad" }, { value: "expired", label: "Expired", tone: "bad" },
  { value: "cancelled", label: "Cancelled", tone: "neutral" }, { value: "amended", label: "Amended", tone: "neutral" },
];
export const CONTRACT_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "drafts", label: "Drafts", statuses: ["draft"] },
  { key: "action", label: "Action required", statuses: ["in_review", "viewed"] },
  { key: "waiting", label: "Waiting for others", statuses: ["sent"] },
  { key: "finalized", label: "Finalised", statuses: ["signed", "counter_signed"] },
  { key: "rejected", label: "Declined or cancelled", statuses: ["declined", "cancelled"] },
  { key: "closed", label: "Expired or amended", statuses: ["expired", "amended"] },
];
export const DOCUMENT_TYPES: Opt[] = [
  { value: "contract", label: "Contract" }, { value: "amendment", label: "Amendment" }, { value: "nda", label: "NDA" },
  { value: "addendum", label: "Addendum" }, { value: "quote", label: "Quote" }, { value: "sow", label: "Statement of work" }, { value: "other", label: "Other" },
];
export const TEMPLATE_CATEGORIES: Opt[] = [
  { value: "proposals", label: "Proposals" }, { value: "sales_contracts", label: "Sales contracts" }, { value: "service_agreements", label: "Service agreements" },
  { value: "nda", label: "NDAs" }, { value: "sow", label: "Statements of work" }, { value: "terms_conditions", label: "Terms & conditions" },
  { value: "amendments", label: "Amendments" }, { value: "custom", label: "Custom" },
];
export const NEGOTIATION_ACTION: Record<string, string> = {
  accept_fix: "Accept / fix", use_query_matrix: "Use query matrix", use_query_matrix_conditions: "Use query matrix with conditions", hold_escalate: "Hold position / escalate",
};
export const CONTRACT_EXPIRY_ALERT_DAYS = 60;
/** Fully signed contracts whose end date falls in the next 60 days (or has just passed while still live). */
export function isContractExpiring(c: { status: string; end_date: string | null }, on = new Date().toISOString().slice(0, 10)) {
  if (!c.end_date || !["signed", "counter_signed"].includes(c.status)) return false;
  const d = daysBetween(on, c.end_date);
  return d <= CONTRACT_EXPIRY_ALERT_DAYS;
}
export interface Contract {
  id: string;
  contract_ref: string;
  supplier_id: string | null;
  region: string | null;
  market: string | null;
  template_id: string | null;
  title: string;
  document_type: string;
  status: string;
  version: number;
  parent_contract_id: string | null;
  content_summary: string | null;
  document_path: string | null;
  value: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  finalized_at: string | null;
  internal_notes: string | null;
  created_by: string | null;
  updated_at: string;
  created_at: string;
}
export interface ContractParty {
  id: string;
  contract_id: string;
  name: string;
  email: string;
  role: string;
  signing_order: number;
  is_internal: boolean;
  status: string;
  signed_at: string | null;
  signature_evidence: string | null;
}

/* ---------------- Reviews ---------------- */
export const REVIEW_TYPES: Opt[] = [
  { value: "qbr", label: "QBR" }, { value: "check_in", label: "Check-in" }, { value: "escalation", label: "Escalation" },
  { value: "renewal", label: "Renewal" }, { value: "other", label: "Other" },
];
export const BR_STATUS: Opt[] = [
  { value: "scheduled", label: "Scheduled", tone: "info" }, { value: "completed", label: "Completed", tone: "ok" }, { value: "cancelled", label: "Cancelled", tone: "neutral" },
];
export const OUTCOME_STATUS: Opt[] = [
  { value: "not_set", label: "No outcomes yet", tone: "neutral" }, { value: "pending", label: "Waiting for approval", tone: "warn" },
  { value: "approved", label: "Approved", tone: "ok" }, { value: "rejected", label: "Rejected", tone: "bad" },
];
export const SENTIMENT: Opt[] = [
  { value: "positive", label: "Positive", tone: "ok" }, { value: "neutral", label: "Neutral", tone: "neutral" }, { value: "needs_attention", label: "Needs attention", tone: "warn" },
];
export const VENDOR_RESPONSE: Opt[] = [
  { value: "none", label: "No response yet" }, { value: "accepted", label: "Accepted", tone: "ok" },
  { value: "suggested_reschedule", label: "Reschedule requested", tone: "warn" }, { value: "notes", label: "Notes sent", tone: "info" },
];
export interface BusinessReview {
  id: string;
  supplier_id: string;
  title: string;
  description: string | null;
  review_type: string;
  meeting_date: string;
  status: string;
  internal_attendees: string[];
  vendor_attendees: string[];
  agenda_items: string[];
  presentation_path: string | null;
  shared_with_vendor: boolean;
  next_review_date: string | null;
  key_outcomes: string | null;
  discussion_notes: string | null;
  overall_sentiment: string | null;
  outcomes_approval_status: string;
  outcomes_approved_by: string | null;
  outcomes_approved_at: string | null;
  outcomes_review_note: string | null;
  vendor_response: string;
  vendor_suggested_date: string | null;
  vendor_notes: string | null;
  created_by: string | null;
}

/* ---------------- Tasks ---------------- */
export const TASK_STATUS: Opt[] = [
  { value: "open", label: "Open", tone: "info" }, { value: "in_progress", label: "In progress", tone: "accent" },
  { value: "completed", label: "Completed", tone: "warn" }, { value: "verified", label: "Verified", tone: "ok" },
];
export const TASK_CATEGORY: Opt[] = [
  { value: "quality", label: "Quality" }, { value: "delivery", label: "Delivery" }, { value: "compliance", label: "Compliance" },
  { value: "cost", label: "Cost" }, { value: "sustainability", label: "Sustainability" }, { value: "other", label: "Other" },
];
export const PRIORITY: Opt[] = [
  { value: "critical", label: "Critical", tone: "bad" }, { value: "high", label: "High", tone: "warn" },
  { value: "medium", label: "Medium", tone: "info" }, { value: "low", label: "Low", tone: "neutral" },
];
export interface Task {
  id: string;
  supplier_id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  due_date: string | null;
  source: string;
  status: string;
  progress_notes: string | null;
  completed_by: string | null;
  completed_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
}
export const isTaskOverdue = (t: Pick<Task, "status" | "due_date">, on = new Date().toISOString().slice(0, 10)) =>
  !!t.due_date && t.due_date < on && t.status !== "completed" && t.status !== "verified";
/** Share of tasks completed or verified. */
export const taskProgress = (tasks: Pick<Task, "status">[]) =>
  tasks.length ? Math.round((tasks.filter((t) => t.status === "completed" || t.status === "verified").length / tasks.length) * 100) : 0;

/* ---------------- Surveys ---------------- */
export const SURVEY_CATEGORIES: Opt[] = [
  { value: "onboarding", label: "Onboarding" }, { value: "compliance", label: "Compliance" }, { value: "performance", label: "Performance" },
  { value: "esg", label: "ESG & sustainability" }, { value: "quality", label: "Quality" }, { value: "general", label: "General" },
];
export const QUESTION_TYPES: Opt[] = [
  { value: "text", label: "Short text" }, { value: "textarea", label: "Long text" }, { value: "single_choice", label: "Single choice" },
  { value: "multiple_choice", label: "Multiple choice" }, { value: "rating", label: "Rating (1-5)" }, { value: "yes_no", label: "Yes / no" }, { value: "date", label: "Date" },
];
export const SURVEY_STATUS: Opt[] = [
  { value: "draft", label: "With the vendor", tone: "neutral" }, { value: "submitted", label: "Awaiting review", tone: "info" },
  { value: "under_review", label: "Under review", tone: "accent" }, { value: "completed", label: "Completed", tone: "ok" }, { value: "rejected", label: "Sent back", tone: "bad" },
];
export type Question = { id: string; text: string; type: string; options?: string[]; required?: boolean };
/**
 * Parse the question editor's text: one question per line, "type | question text | option, option | optional".
 * Lines without a pipe are short-text required questions.
 */
export function parseQuestions(text: string): { questions: Question[]; error?: string } {
  const types = new Set(QUESTION_TYPES.map((t) => t.value));
  const out: Question[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const parts = line.includes("|") ? line.split("|").map((p) => p.trim()) : ["text", line];
    const [type, qtext, opts, flag] = parts;
    if (!types.has(type)) return { questions: [], error: `Line ${i + 1}: unknown question type "${type}"` };
    if (!qtext) return { questions: [], error: `Line ${i + 1}: write the question` };
    const options = opts ? opts.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    if ((type === "single_choice" || type === "multiple_choice") && !options?.length) return { questions: [], error: `Line ${i + 1}: list the options` };
    out.push({ id: `q${i + 1}`, text: qtext, type, ...(options?.length ? { options } : {}), required: flag?.toLowerCase() !== "optional" });
  }
  return { questions: out };
}
export const questionsToText = (qs: Question[]) =>
  qs.map((q) => [q.type, q.text, (q.options ?? []).join(", "), q.required === false ? "optional" : ""].join(" | ").replace(/( \| )+$/, "")).join("\n");

/* ---------------- Workflows ---------------- */
export const WORKFLOW_TYPES: Opt[] = [
  { value: "onboarding", label: "Onboarding" }, { value: "tier_upgrade", label: "Tier upgrade" }, { value: "annual_review", label: "Annual review" },
  { value: "compliance_renewal", label: "Compliance renewal" }, { value: "offboarding", label: "Offboarding" }, { value: "custom", label: "Custom" },
];
export const WORKFLOW_STATUS: Opt[] = [
  { value: "in_progress", label: "In progress", tone: "accent" }, { value: "on_hold", label: "On hold", tone: "warn" },
  { value: "completed", label: "Completed", tone: "ok" }, { value: "cancelled", label: "Cancelled", tone: "neutral" }, { value: "rejected", label: "Rejected", tone: "bad" },
];
export const STEP_STATUS: Opt[] = [
  { value: "pending", label: "Not started", tone: "neutral" }, { value: "in_progress", label: "Waiting for approval", tone: "accent" },
  { value: "approved", label: "Approved", tone: "ok" }, { value: "rejected", label: "Rejected", tone: "bad" }, { value: "skipped", label: "Skipped", tone: "neutral" },
];
export const APPROVER_ROLES: Opt[] = [
  { value: "vendor_manager", label: "Vendor manager (SRT agent or lead)" }, { value: "procurement_lead", label: "Procurement (procurement or head)" },
  { value: "compliance", label: "Compliance (SRT agent or lead)" }, { value: "executive", label: "Executive (Procurement head)" },
];
/** Mirrors assure_can_approve() in SQL. */
export function canApprove(role: string, me: { is_admin: boolean; srt_role: string | null }) {
  if (me.is_admin) return true;
  const r = me.srt_role ?? "";
  return role === "vendor_manager" || role === "compliance" ? ["agent", "lead"].includes(r) : role === "procurement_lead" ? ["procurement", "head"].includes(r) : role === "executive" ? r === "head" : false;
}
export type TemplateStep = { title: string; description?: string; approver_role: string; sla_days: number };
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  workflow_type: string;
  category: string;
  priority: string;
  steps: TemplateStep[];
  version: number;
  is_active: boolean;
}
export interface WorkflowInstance {
  id: string;
  template_id: string | null;
  name: string;
  workflow_type: string;
  supplier_id: string;
  priority: string;
  status: string;
  current_step: number;
  started_at: string;
  completed_at: string | null;
  initiated_by: string | null;
}
export interface WorkflowStep {
  id: string;
  instance_id: string;
  idx: number;
  name: string;
  description: string | null;
  approver_role: string;
  sla_days: number;
  due_date: string | null;
  status: string;
  acted_by: string | null;
  acted_at: string | null;
  notes: string | null;
}
/** "title | approver_role | days" per line. */
export function parseSteps(text: string): { steps: TemplateStep[]; error?: string } {
  const roles = new Set(APPROVER_ROLES.map((r) => r.value));
  const steps: TemplateStep[] = [];
  for (const [i, line] of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).entries()) {
    const [title, role = "vendor_manager", days = "3"] = line.split("|").map((p) => p.trim());
    if (!title) return { steps: [], error: `Line ${i + 1}: give the step a title` };
    if (!roles.has(role)) return { steps: [], error: `Line ${i + 1}: unknown approver role "${role}"` };
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) return { steps: [], error: `Line ${i + 1}: target days must be a whole number of at least 1` };
    steps.push({ title, approver_role: role, sla_days: n });
  }
  if (!steps.length) return { steps: [], error: "Add at least one step" };
  return { steps };
}

/* ---------------- Training ---------------- */
export const TRAINING_STATUS: Opt[] = [
  { value: "assigned", label: "Assigned", tone: "info" }, { value: "in_progress", label: "In progress", tone: "accent" },
  { value: "completed", label: "Completed", tone: "ok" }, { value: "waived", label: "Waived", tone: "neutral" }, { value: "overdue", label: "Overdue", tone: "bad" },
];
/** Overdue is worked out on read: past due and not completed or waived. */
export const trainingStatus = (a: { status: string; due_date: string | null }, on = new Date().toISOString().slice(0, 10)) =>
  a.status === "completed" || a.status === "waived" ? a.status : a.due_date && a.due_date < on ? "overdue" : a.status;

/* ---------------- Activity ---------------- */
export const ACTIVITY_ICON: Record<string, string> = {
  supplier: "storefront", certificate: "workspace_premium", document: "description", pre_assessment: "assignment", inspection: "fact_check",
  ncr: "report", issue: "warning", performance: "monitoring", contract: "contract", review: "groups", task: "task_alt", survey: "quiz",
  workflow: "account_tree", note: "sticky_note_2",
};

/* ---------------- CSV ---------------- */
/** CSV cell with formula-injection protection (values starting = + - @ are prefixed with '). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

/* ---------------- Calendar ---------------- */
/** Weeks (Monday first) covering the month of `ym` ("YYYY-MM"). Each day is "YYYY-MM-DD". */
export function monthGrid(ym: string): string[][] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const weeks: string[][] = [];
  const d = new Date(start);
  do {
    const w: string[] = [];
    for (let i = 0; i < 7; i++) { w.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    weeks.push(w);
  } while (d.getUTCMonth() === m - 1);
  return weeks;
}
export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (ym: string) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
