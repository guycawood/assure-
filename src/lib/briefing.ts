// Briefing+ pure helpers: labels, tones, types and the indicative eco grade maths. No I/O.
import type { Tone } from "@/lib/srt";

export type BriefStatus = "draft" | "submitted" | "in_ideation" | "spec_created" | "archived";
export type ApprovalStatus = "pending" | "approved" | "changes_requested";

export const BRIEF_STATUSES: BriefStatus[] = ["draft", "submitted", "in_ideation", "spec_created", "archived"];
export const BRIEF_STATUS: Record<BriefStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  in_ideation: { label: "In ideation", tone: "accent" },
  spec_created: { label: "Spec created", tone: "ok" },
  archived: { label: "Archived", tone: "neutral" },
};
export const APPROVAL: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting review", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  changes_requested: { label: "Changes requested", tone: "bad" },
};

export type Brief = {
  id: string; brief_code: string; campaign_id: string | null; campaign_name?: string | null; campaign_code?: string | null;
  region: string | null; market: string | null; client: string | null; brand: string | null; division: string | null;
  title: string; objective: string | null; brief_text: string | null; target_outlets: string | null;
  budget_low: number | null; budget_high: number | null; currency: string; target_launch: string | null;
  product_category: string | null; sustainability_targets: string | null; min_recycled_pct: number | null; require_fsc: boolean;
  status: BriefStatus; approval_status: ApprovalStatus | null; revision_count: number; submitted_at: string | null;
  reviewed_by: string | null; reviewed_at: string | null; approval_comments: string | null; resulting_job_id: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};

export type Campaign = {
  id: string; campaign_code: string; name: string; client: string | null; brands: string[]; division: string | null;
  brand_tier: string | null; objective: string | null; campaign_type: string | null; activation_objective: string | null;
  channels: string[]; store_types: string[]; p2p_stages: string[]; start_date: string | null; end_date: string | null;
  status: "planning" | "live" | "closed"; created_by: string | null; created_at: string;
  markets?: string[]; regions?: string[]; brief_count?: number;
};

export type BriefRevision = { id: number; brief_id: string; version: number; changes: { field: string; before: string; after: string }[]; previous_version: { field: string; value: string }[]; revised_by: string | null; revised_at: string };
export type BriefApproval = { id: number; brief_id: string; decision: "approved" | "changes_requested"; comments: string | null; decided_by: string | null; decided_at: string };
export type BriefEvent = { id: number; brief_id: string; event: string; from_status: string | null; to_status: string | null; note: string | null; actor: string | null; at: string };

export const CURRENCIES = ["GBP", "EUR", "USD", "SGD", "AUD"] as const;
export const REGIONS = ["EMEA", "Americas", "APAC", "GSC"] as const;
/** Markets until master data lands: ISO alpha-2 code, name and region (kept separate on every record). */
export const MARKETS: { code: string; name: string; region: string }[] = [
  { code: "GB", name: "United Kingdom", region: "EMEA" }, { code: "IE", name: "Ireland", region: "EMEA" },
  { code: "NL", name: "Netherlands", region: "EMEA" }, { code: "DE", name: "Germany", region: "EMEA" },
  { code: "FR", name: "France", region: "EMEA" }, { code: "IT", name: "Italy", region: "EMEA" },
  { code: "ES", name: "Spain", region: "EMEA" }, { code: "PL", name: "Poland", region: "EMEA" },
  { code: "ZA", name: "South Africa", region: "EMEA" }, { code: "US", name: "United States", region: "Americas" },
  { code: "BR", name: "Brazil", region: "Americas" }, { code: "MX", name: "Mexico", region: "Americas" },
  { code: "SG", name: "Singapore", region: "APAC" }, { code: "AU", name: "Australia", region: "APAC" },
  { code: "CN", name: "China", region: "APAC" }, { code: "JP", name: "Japan", region: "APAC" }, { code: "IN", name: "India", region: "APAC" },
];
export const marketName = (code: string | null | undefined) => (code ? MARKETS.find((m) => m.code === code)?.name ?? code : "");
export const CLIENT_OPTIONS = ["Heineken", "Unilever", "Coloplast", "BAU", "Other"] as const;

export const CAMPAIGN_TYPES = [
  { value: "always_on", label: "Always-on" }, { value: "seasonal", label: "Seasonal" }, { value: "tactical", label: "Tactical" },
];
export const ACTIVATION_OBJECTIVES = [
  { value: "trial", label: "Trial" }, { value: "trade_up", label: "Trade-up" }, { value: "conversion", label: "Conversion" },
  { value: "loyalty", label: "Loyalty" }, { value: "basket_value", label: "Basket value" },
];
export const CHANNELS = ["Off-trade", "On-trade", "Impulse", "E-commerce"];
export const STORE_TYPES = ["Hypermarket", "Supermarket", "Convenience", "Drugstore", "Petrol", "Bar / cafe"];
export const P2P_STAGES = ["Connect", "Engage", "Sell"];
export const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  planning: { label: "Planning", tone: "info" }, live: { label: "Live", tone: "ok" }, closed: { label: "Closed", tone: "neutral" },
};
export const optLabel = (list: { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? v ?? "";

// ---------------------------------------------------------------------------
// Ideation (prototype briefIdeation / ideateProductTypesForObjective)
// ---------------------------------------------------------------------------
export const SPEC_TYPES = ["2d", "3d", "custom_goods_services", "design", "promo_merch"] as const;
export type SpecType = (typeof SPEC_TYPES)[number];
export const SPEC_TYPE_LABEL: Record<string, string> = {
  "2d": "2D print", "3d": "3D display", custom_goods_services: "Custom / services", design: "Design", promo_merch: "Promo / merch",
};

export type EcoTag = "eco_friendly" | "moderate" | "high_impact";
export const ECO_TAGS: EcoTag[] = ["eco_friendly", "moderate", "high_impact"];
export const ECO_TAG: Record<EcoTag, { label: string; tone: Tone }> = {
  eco_friendly: { label: "Eco-friendly", tone: "ok" }, moderate: { label: "Moderate", tone: "warn" }, high_impact: { label: "High impact", tone: "bad" },
};
export const ECO_DIM_LABEL: Record<string, string> = { carbon_footprint: "Carbon", recycled_content: "Recycled", end_of_life: "End of life" };
export type Eco = { score: number; tag: EcoTag; rationale: string; dimensions: { carbon_footprint: number | null; recycled_content: number | null; end_of_life: number | null } };

const clamp = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : null);
export const ecoTagFor = (score: number): EcoTag => (score >= 75 ? "eco_friendly" : score >= 50 ? "moderate" : "high_impact");

/** Indicative only: there is no governed Impact Grade behind these numbers yet. */
export function normalizeEco(raw: unknown): Eco | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = clamp(r.score);
  if (score == null) return null;
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  return {
    score,
    tag: ECO_TAGS.includes(r.tag as EcoTag) ? (r.tag as EcoTag) : ecoTagFor(score),
    rationale: typeof r.rationale === "string" ? r.rationale : "",
    dimensions: { carbon_footprint: clamp(d.carbon_footprint), recycled_content: clamp(d.recycled_content), end_of_life: clamp(d.end_of_life) },
  };
}

export function bundleEco(ecos: (Eco | null | undefined)[]) {
  const list = ecos.filter((e): e is Eco => !!e);
  if (!list.length) return null;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const score = avg(list.map((e) => e.score))!;
  return {
    score, tag: ecoTagFor(score), count: list.length,
    dimensions: Object.fromEntries((["carbon_footprint", "recycled_content", "end_of_life"] as const).map((k) => [k, avg(list.map((e) => e.dimensions[k]))])),
  };
}

export type SubstrateSpecs = {
  substrate_type?: string | null; measurement_basis?: string | null; grammage_gsm?: number | null; thickness_mm?: number | null;
  density_kg_per_m3?: number | null; recycled_content_percent?: number | null; fsc_certified?: boolean; verification_status?: string | null;
};

/** A brief concept (spec direction). Everything priced or graded here is an indicative creative suggestion. */
export type SpecConcept = {
  name: string; rationale: string; suggested_spec_type: SpecType | string; suggested_substrate_name: string | null;
  suggested_substrate_id: string | null; suggested_length: number | null; suggested_width: number | null; suggested_depth: number | null;
  suggested_unit: string | null; suggested_calc_method: "quantity" | "square_measurement" | null; creative_direction: string;
  risks: string[]; fit_score: number | null; indicative_quantity: number | null; indicative_unit_price: number | null;
  indicative_total: number | null; price_currency: string | null; price_basis: string | null; eco: Eco | null; substrate_specs?: SubstrateSpecs | null;
};

export type ProductTypeSuggestion = {
  product_type_name: string; product_type_id: string; rationale: string; suggested_spec_type: SpecType | string;
  client_history_match: boolean; eco: Eco | null;
};

export type ConceptRow = {
  id: string; session_id: string; message_id: number; brief_id: string | null; kind: "spec_concept" | "product_type"; idx: number;
  is_top: boolean; name: string; data: SpecConcept & ProductTypeSuggestion; substrate_record_id: string | null;
  touchpoint_record_id: string | null; model: string; prompt_version: string; demo: boolean; created_at: string;
};
export type MessageRow = { id: number; session_id: string; role: "user" | "assistant"; content: string; model: string | null; prompt_version: string | null; demo: boolean; created_at: string };
export type CreativeParams = { innovation: string; sustainability: string; budget: string; format?: string };
export const DEFAULT_PARAMS: CreativeParams = { innovation: "balanced", sustainability: "medium", budget: "respect" };
export const PARAM_OPTIONS: Record<"innovation" | "sustainability" | "budget", { value: string; label: string }[]> = {
  innovation: [{ value: "safe", label: "Safe / evolutionary" }, { value: "balanced", label: "Balanced" }, { value: "bold", label: "Bold / novel" }],
  sustainability: [{ value: "low", label: "Low priority" }, { value: "medium", label: "Medium" }, { value: "high", label: "High: prefer low-emission" }],
  budget: [{ value: "respect", label: "Respect budget" }, { value: "flexible", label: "Flexible" }, { value: "premium", label: "Push premium" }],
};
export const PARAM_LABEL = { innovation: "Innovation", sustainability: "Sustainability", budget: "Budget" } as const;

export function money(n: number | null | undefined, currency = "GBP") {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return `${currency} ${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}
export const budgetRange = (b: Pick<Brief, "budget_low" | "budget_high" | "currency">) =>
  b.budget_low == null && b.budget_high == null ? "" : `${b.currency} ${b.budget_low != null ? Number(b.budget_low).toLocaleString("en-GB") : "?"} – ${b.budget_high != null ? Number(b.budget_high).toLocaleString("en-GB") : "?"}`;

export const canIdeate = (b: Pick<Brief, "status" | "approval_status">) => b.status === "in_ideation" && b.approval_status === "approved";
