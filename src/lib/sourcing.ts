// Sourcing+ shared types, labels and small pure helpers (also used by RFQ+ and Order Management+ pages).
import type { Tone } from "@/lib/srt";

export const REGIONS = ["APAC", "EMEA", "Americas", "GSC"] as const;
export type Region = (typeof REGIONS)[number];

export type JobStatus = "open" | "quoting" | "ordered" | "in_production" | "delivered" | "closed" | "cancelled";
export const JOB_STATUS: { value: JobStatus; label: string; tone: Tone }[] = [
  { value: "open", label: "Open", tone: "info" },
  { value: "quoting", label: "Quoting", tone: "accent" },
  { value: "ordered", label: "Ordered", tone: "warn" },
  { value: "in_production", label: "In production", tone: "warn" },
  { value: "delivered", label: "Delivered", tone: "ok" },
  { value: "closed", label: "Closed", tone: "neutral" },
  { value: "cancelled", label: "Cancelled", tone: "bad" },
];
/** Legal next steps, mirroring job_set_status() in the database. */
export const JOB_NEXT: Record<JobStatus, JobStatus[]> = {
  open: ["quoting", "cancelled"],
  quoting: ["open", "ordered", "cancelled"],
  ordered: ["in_production", "cancelled"],
  in_production: ["delivered", "cancelled"],
  delivered: ["closed", "in_production"],
  closed: [],
  cancelled: [],
};

export type SpecType = "2d" | "3d" | "custom_goods_services" | "design" | "promo_merch";
export const SPEC_TYPES: { value: SpecType; label: string; hint: string }[] = [
  { value: "2d", label: "2D print", hint: "Posters, banners, signage, shelf strips" },
  { value: "3d", label: "3D display", hint: "Displays, stands, gondolas, fixtures" },
  { value: "promo_merch", label: "Promo and merch", hint: "Premiums, clothing, gifting" },
  { value: "custom_goods_services", label: "Custom goods and services", hint: "Freight, kitting, postage" },
  { value: "design", label: "Design", hint: "Artwork, creative, industrial design" },
];
export const COMPONENT_TYPES = ["body", "base", "header", "panel", "fixing", "print", "finishing", "packaging", "other"] as const;

export type Route = "adopt" | "adapt" | "create" | "push";
export const ROUTES: { value: Route; label: string; tone: Tone; description: string }[] = [
  { value: "adopt", label: "Adopt", tone: "ok", description: "Exact rate-card match: the card price applies, no RFQ." },
  { value: "adapt", label: "Adapt", tone: "info", description: "Inside the tolerance band: priced from the card, no RFQ." },
  { value: "push", label: "Push", tone: "accent", description: "We state the price; the supplier confirms in the vendor portal." },
  { value: "create", label: "Create", tone: "warn", description: "New, complex or high value: run an RFQ." },
];

export interface SourcingClient {
  id: string; code: string; name: string; default_currency: string; default_markup_percent: number; savings_target_percent: number;
  quote_tolerance_percent: number | null; min_quotes_required: number; e_tender_threshold: number | null; active: boolean; notes: string | null;
}
export interface BillingEntity { id: string; code: string; name: string; region: Region; market: string; vat_number: string | null; currency: string; active: boolean }

export interface Job {
  id: string; job_number: string; title: string; client_id: string; billing_entity_id: string | null; region: Region; market: string;
  brief_id: string | null; category: string | null; campaign_name: string | null; brand: string | null; client_job_ref: string | null;
  budget: number | null; currency: string; opened_date: string; quote_due_date: string | null; target_delivery_date: string | null;
  status: JobStatus; manager: string | null; notes: string | null; created_by: string | null; created_at: string;
  client_name: string; client_code: string; billing_entity_name: string | null; spec_count: number; rfq_count: number; po_count: number;
}

export interface Spec {
  id: string; job_id: string; spec_no: number; title: string; spec_type: SpecType; description: string | null; calculation_method: string;
  hs_code: string | null; substrate_id: string | null; size_unit: "mm" | "cm" | "in" | null; unit_weight_grams: number | null;
  packaging_weight_grams: number | null; weight_basis: string | null; co2e_kg_per_unit: number | null; co2e_total_kg: number | null;
  co2e_detail: unknown; co2e_computed_at: string | null; spec_data: Record<string, unknown>; region: Region; market: string; is_draft: boolean;
  created_at: string; job_number: string; job_title: string; client_name: string; substrate_name: string | null; total_quantity: number;
  triage_id: string | null; route: Route | null; triage_reason: string | null; confidence: number | null; triage_unit_price: number | null;
  push_status: "pending" | "accepted" | "declined" | null; triage_supplier_id: string | null; triage_supplier_name: string | null;
  triage_at: string | null; triage_source: string | null; rate_card_name: string | null;
}
export interface SpecVersion { id: string; spec_id: string; name: string; quantity: number; finished_length: number | null; finished_width: number | null; item_code: string | null; unit_weight_grams: number | null; sort: number }
export interface SpecComponent {
  id: string; spec_id: string; version_id: string | null; component_name: string; component_type: string; is_packaging: boolean; substrate_id: string | null;
  quantity_per_unit: number; area_length_cm: number | null; area_width_cm: number | null; direct_weight_grams: number | null;
  thickness_mm_override: number | null; grammage_gsm_override: number | null; derived_weight_grams: number | null; notes: string | null; sort: number;
}

export interface LibraryRecord { id: string; library_key: string; code: string | null; name: string; data: Record<string, unknown>; status: string; version: number; effective_from: string; effective_to: string | null }

export interface SourcingEvent { id: number; job_id: string | null; entity: string; entity_id: string | null; event: string; detail: Record<string, unknown>; actor: string | null; at: string }

export const jobStatus = (s: string) => JOB_STATUS.find((x) => x.value === s) ?? { value: s, label: s, tone: "neutral" as Tone };
export const specType = (s: string) => SPEC_TYPES.find((x) => x.value === s)?.label ?? s;
export const route = (r: string | null | undefined) => ROUTES.find((x) => x.value === r);

const SYMBOL: Record<string, string> = { EUR: "€", GBP: "£", USD: "$", SGD: "S$" };
export function money(n: number | null | undefined, currency = "EUR", digits = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return `${SYMBOL[currency] ?? currency + " "}${v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) })}`;
}
export const unitMoney = (n: number | null | undefined, currency = "EUR") => money(n, currency, 2);
export const pct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${Number(n).toFixed(digits)}%`);

/** Plain-English labels for audit events. */
export const EVENT_LABEL: Record<string, string> = {
  created: "Created", status_changed: "Status changed", location_changed: "Region or market changed", triaged: "Triaged",
  push_accepted: "Supplier accepted the pushed price", push_declined: "Supplier declined the pushed price", edited: "Edited",
  suppliers_set: "Suppliers chosen", high_value_alert: "High-value alert", high_value_approved: "High value approved", sent: "Sent",
  cancelled: "Cancelled", quote_submitted: "Quote submitted", quote_logged: "Quote logged by buyer", supplier_declined: "Supplier declined",
  finance_approved: "Finance approved a quote", finance_declined: "Finance declined a quote", awarded: "Awarded", priced: "Pricing set",
  approved: "Approved", declined: "Declined", rejected: "Rejected", vendor_accepted: "Vendor accepted the PO", vendor_declined: "Vendor declined the PO",
  submitted: "Submitted", line_manager_approved: "Line manager approved", line_manager_rejected: "Line manager rejected", assessed: "Procurement assessed",
  applied: "Applied", settings_changed: "Settings changed", access_changed: "Access changed",
};
