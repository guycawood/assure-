// SRM onboarding (the nine-stage standard): shared types, labels and display helpers. Pure, no I/O.
import type { Tone } from "@/lib/srt";

export type Taxonomy = "submitted" | "in_review" | "approved" | "declined" | "exception" | "on_hold";

/** One status vocabulary for cases, suppliers, tickets and gates (mirrors srm_status_taxonomy in the database). */
export const TAXONOMY: Record<Taxonomy, { label: string; tone: Tone }> = {
  submitted: { label: "Submitted", tone: "info" },
  in_review: { label: "In review", tone: "accent" },
  approved: { label: "Approved", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  exception: { label: "Exception", tone: "warn" },
  on_hold: { label: "On hold", tone: "neutral" },
};

export function taxonomyOf(kind: "ticket" | "gate" | "case" | "fast_track", status: string, resolution?: string | null): Taxonomy {
  switch (kind) {
    case "ticket":
      if (status === "new" || status === "triage") return "submitted";
      if (status === "resolved") return (resolution ?? "completed") === "completed" ? "approved" : "declined";
      return "in_review";
    case "gate":
      if (status === "verified" || status === "not_required") return "approved";
      if (status === "rejected") return "declined";
      if (status === "requested" || status === "received") return "in_review";
      return "submitted";
    case "case":
      return status === "submitted" ? "submitted" : status === "in_onboarding" ? "in_review" : status === "released" ? "approved" : status === "on_hold" ? "on_hold" : "declined";
    case "fast_track":
      return status === "requested" ? "submitted" : status === "approved" ? "exception" : status === "closed" ? "approved" : "declined";
  }
}

export const STAGES: { no: number; key: string; label: string; owner: string }[] = [
  { no: 1, key: "need", label: "Business need", owner: "Requester" },
  { no: 2, key: "intake", label: "Intake", owner: "Requester / SRT" },
  { no: 3, key: "triage", label: "Triage", owner: "Procurement" },
  { no: 4, key: "due_diligence", label: "Due diligence", owner: "Supplier / SRT" },
  { no: 5, key: "risk", label: "Risk gates", owner: "Category Manager / Quality" },
  { no: 6, key: "contracts", label: "Contracts", owner: "SRT / Legal" },
  { no: 7, key: "finance", label: "Finance approval", owner: "Local Finance" },
  { no: 8, key: "systems", label: "System enablement", owner: "ERP / SRT" },
  { no: 9, key: "activate", label: "Activate & govern", owner: "Procurement" },
];

/** What a supplier's onboarding looks like in one line, e.g. "In review · stage 4 of 9 (Due diligence)". */
export function onboardingLine(s: { onboarding_state?: string | null; onboarding_stage?: number | null; onboarding_released?: boolean | null; onboarding_baseline?: string | null }): string {
  const t = TAXONOMY[(s.onboarding_state ?? "in_review") as Taxonomy] ?? TAXONOMY.in_review;
  if (s.onboarding_released) return s.onboarding_baseline === "legacy" ? "Approved · onboarded before the nine-stage standard" : "Approved · released for use";
  const st = STAGES.find((x) => x.no === s.onboarding_stage);
  return `${t.label} · stage ${s.onboarding_stage ?? 1} of 9${st ? ` (${st.label})` : ""}`;
}

export const SUPPLIER_TYPES = [
  { value: "manufacturer", label: "Manufacturer" },
  { value: "distributor", label: "Distributor" },
  { value: "service_provider", label: "Service provider" },
  { value: "raw_material", label: "Raw material" },
  { value: "logistics", label: "Logistics" },
];

export const SUPPLIER_CATEGORIES = ["Print", "POSM", "Packaging", "Fixtures", "Signage", "Components", "Premiums", "Logistics", "Services"];

export const RELATIONSHIPS = [
  { value: "incumbent", label: "Incumbent (client-nominated or existing relationship)" },
  { value: "strategic", label: "Strategic (long-term supplier for the category)" },
  { value: "tactical", label: "Tactical (a specific need)" },
];

export const CADENCES = [
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Every 6 months" },
  { value: "annual", label: "Annual" },
  { value: "biennial", label: "Every 2 years" },
];

export const SYSTEMS = [
  { value: "stocktool", label: "StockTool" },
  { value: "erp", label: "NAV / ERP" },
  { value: "sourcing_hub", label: "Sourcing Hub" },
];

export const EVENTS = [
  { value: "material_change", label: "Material change (ownership, site, bank, legal entity)" },
  { value: "client_request", label: "Client request" },
  { value: "adverse_finding", label: "Adverse finding (audit, press, sanctions hit)" },
];

export const CASE_STATUS_LABEL: Record<string, string> = {
  submitted: "Waiting for triage", in_onboarding: "In onboarding", released: "Released", declined: "Declined",
  duplicate: "Duplicate of an existing supplier", withdrawn: "Withdrawn", on_hold: "On hold",
};

export const GATE_STATUS_PLAIN: Record<string, string> = {
  missing: "Not started", requested: "Requested", received: "Received, to check", verified: "Done", rejected: "Rejected", not_required: "Not required",
};

/** The local name of the company registration number, where we know it. */
const REG_NAMES: Record<string, string> = {
  Singapore: "UEN", "United Kingdom": "Companies House number", Colombia: "NIT", Germany: "Handelsregister number (HRB)",
  France: "SIREN", China: "Unified social credit code", India: "CIN", "Hong Kong": "Business registration number", Vietnam: "Enterprise code",
  Malaysia: "SSM number", Australia: "ABN", "United States": "EIN", Canada: "Business number (BN)", Mexico: "RFC", Brazil: "CNPJ", Poland: "KRS",
  Portugal: "NIPC", Spain: "CIF", Italy: "Codice fiscale", Netherlands: "KvK number", Turkey: "MERSIS number", Sweden: "Organisationsnummer",
  Thailand: "Juristic person number", Philippines: "SEC registration number", Indonesia: "NIB", Slovakia: "IČO",
};

export function registrationLabel(market: string | null | undefined): string {
  const local = market ? REG_NAMES[market] : undefined;
  return local ? `Company registration number (${local})` : "Company registration number";
}

export const daysLabel = (n: number | null | undefined) => (n == null ? "" : n === 1 ? "1 day" : `${n} days`);

export type StageItem = {
  gate_key: string; label: string; status: string; clear: boolean; critical: boolean; expiry_date: string | null; expired: boolean;
  gap_id: string | null; gap_due: string | null; allows_gap: boolean; system: boolean; note: string | null; rejection_reason: string | null; vendor_facing: boolean;
};
export type RecordStage = { stage_no: number; key: string; label: string; owner: string; controls: string; exit_criterion: string; complete: boolean; items: StageItem[] };

export type SupplierRecord = {
  supplier: {
    id: string; name: string; supplier_code: string | null; market: string | null; region: string | null; client: string | null; category: string | null;
    status: string; active: boolean; state: Taxonomy; stage: number; stage_since: string; released: boolean; baseline: "standard" | "legacy"; blocked: boolean;
    block_reason: string | null; route: string; ids_synced_at: string | null; next_review_due: string | null; procurement_owner: string | null; srt_owner: string | null; email: string | null;
  };
  identity: { legal_entity: string | null; registration_number: string | null; vat_number: string | null; supplier_type: string | null; website: string | null; risk_level: string };
  case: (Record<string, unknown> & { id: string; case_no: number; status: string; route: string | null; relationship: string | null; requested_by_name: string | null;
    triaged_by_name: string | null; activated_by_name: string | null; business_case: string; estimated_spend: number | null; currency: string; urgency: string }) | null;
  cases: { id: string; case_no: number; kind: string; status: string; requested_at: string; trigger_event: string | null; business_case: string }[];
  stages: RecordStage[];
  gaps: { id: string; gate: string; gate_key: string; reason: string; status: string; due_date: string; owner_type: string; owner_name: string | null;
    raised_by: string | null; raised_by_name: string | null; decided_by_name: string | null; decision_note: string | null }[];
  risk_review: (Record<string, unknown> & { status: string; needs_cm: boolean; needs_quality: boolean; cm_decision: string | null; quality_decision: string | null;
    submitted_by: string | null; submitted_by_name: string | null; cm_by_name: string | null; quality_by_name: string | null; category_fit: string;
    competitiveness: string | null; nti_percent: number | null; quality: string | null; sustainability: string | null; audit_needed: boolean; audit_notes: string | null;
    client_requirements: string | null; rules_applied: string[]; cm_note: string | null; quality_note: string | null }) | null;
  risk_rules: { needs_cm: boolean; needs_quality: boolean; audit_required: boolean; codes: string[] } | null;
  contracts: { doc: string; label: string; gate_status: string | null; contracts: { id: string; title: string; ref: string | null; status: string; stored: boolean; end_date: string | null }[] }[];
  untagged_contracts: { id: string; title: string; status: string }[];
  system_ids: { system: string; label: string; required: boolean; gate_status: string | null; external_id: string | null; name_in_system: string | null;
    vat_in_system: string | null; reconciled: boolean | null; recorded_at: string | null }[];
  panels: string[];
  activation: (Record<string, unknown> & { owner_name: string | null; activated_by_name: string | null; training: string; evidence_location: string;
    review_cadence: string; next_review_due: string; activated_at: string }) | null;
  fast_track: (Record<string, unknown> & { id: string; status: string; urgency_reason: string; client_need: string; required_date: string; close_by: string;
    scope_value_cap: number | null; scope_currency: string; scope_systems: string[]; scope_note: string | null; requested_by: string | null; requested_by_name: string | null;
    director_name: string | null; finance_name: string | null; jobs: { id: string; job_number: string; title: string }[] }) | null;
  remediation: { id: string; item: string; gate_key: string | null; owner_type: string; owner_name: string | null; due_date: string; status: string; overdue: boolean; note: string | null }[];
  certificates: { label: string; status: string; expiry_date: string | null; days_left: number | null }[];
  approvals: { type: string; title: string; status: string; role: string; requested_by: string | null; requested_at: string; decided_by: string | null; decided_at: string | null; note: string | null }[];
  decisions: { type: string; decision: string; note: string | null; by: string | null; at: string }[];
  events: { at: string; title: string; kind: string; by: string | null; source: string }[];
  min_pack: { ok: boolean; items: { key: string; label: string; ok: boolean }[] };
  review_tasks: { id: string; title: string; due_date: string; status: string; cadence: string; outcome: string | null }[];
  can: { triage: boolean; gap_decide: boolean; risk_cm: boolean; risk_quality: boolean; finance: boolean; ids: boolean; activate: boolean; director: boolean; vendor_manager: boolean };
};

export type Dashboard = {
  escalation_days: number;
  totals: Record<Taxonomy | "blocked" | "suppliers", number>;
  pipeline: { stage_no: number; key: string; label: string; owner: string; count: number; avg_days: number | null; max_days: number | null; over: number }[];
  by_owner: { owner: string; count: number; avg_days: number | null; over: number }[];
  stuck: { supplier_id: string; name: string; stage_no: number; stage: string; owner: string; days: number; state: Taxonomy }[];
  missing_evidence: { gate_key: string; label: string; stage_no: number; count: number }[];
  gaps: { id: string; supplier_id: string; name: string; gate: string; reason: string; status: string; due_date: string; days_left: number; owner: string | null }[];
  remediation_overdue: { id: string; supplier_id: string; name: string; item: string; due_date: string; days_overdue: number; owner_type: string; owner: string | null }[];
  remediation_open: number;
  fast_tracks: { id: string; supplier_id: string; name: string; status: string; close_by: string; value_cap: number | null; currency: string; jobs: number; director: boolean; finance: boolean }[];
  cert_expiry: { supplier_id: string; name: string; gate: string; expiry_date: string; days_left: number }[];
  inactive: { supplier_id: string; name: string; reason: string }[];
  duplicates: { a_id: string; a: string; b_id: string; b: string; reason: string }[];
  segregation: { kind: string; ref: string; supplier_id: string | null; detail: string }[];
  cases: { id: string; case_no: number; name: string; status: string; taxonomy: Taxonomy; kind: string; client: string | null; market: string; urgency: string;
    requested_by: string | null; requested_at: string; supplier_id: string | null; matches: number }[];
  review_tasks: { id: string; cadence: string; scope: string; title: string; detail: string | null; due_date: string; supplier_id: string | null; owner_role: string | null }[];
  filters: { regions: string[]; markets: string[]; clients: string[]; categories: string[] };
};

export type VendorTracker = {
  name: string; released: boolean; stage: number; exception: boolean; blocked_by_overdue: boolean;
  stages: { stage_no: number; label: string; text: string; action: string | null; status: "done" | "current" | "upcoming"; needs_you: boolean }[];
  items: { label: string; stage_no: number; status: string; what_to_fix: string | null; expired: boolean }[];
  remediation: { item: string; due_date: string; overdue: boolean }[];
  gaps: { item: string; due_date: string }[];
};
