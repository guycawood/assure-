// Sourcing Hub parity: shared types, labels and pure helpers for spec forms, structured Promo & Merch fields, RFQ terms,
// vendor quote details, estimate commercials (cost split, GSC commission, client rebate), client POs and the Stocktool
// hand-off dashboard. No I/O here, so it can be unit tested and used in previews.
import type { Tone } from "@/lib/srt";
import type { Spec } from "@/lib/sourcing";
import type { PricingMode } from "@/lib/orders";

export type SpecForm = "ideation" | "open" | "fixed";
export const SPEC_FORMS: { value: SpecForm; label: string; hint: string }[] = [
  { value: "fixed", label: "Fixed spec", hint: "Everything is decided: suppliers quote exactly this." },
  { value: "open", label: "Open spec", hint: "The essentials are fixed; suppliers can suggest materials or finishes." },
  { value: "ideation", label: "Ideation brief", hint: "A loose product development brief: suppliers send back a proposed spec with their price." },
];
export const specForm = (v: string | null | undefined) => SPEC_FORMS.find((f) => f.value === v) ?? SPEC_FORMS[0];

export const TESTING_CHECKS = [
  { value: "pre_screen", label: "Pre-screen" },
  { value: "lab_test", label: "Lab test" },
  { value: "full_inspection", label: "Full inspection" },
  { value: "drop_test", label: "Drop test" },
  { value: "loading_test", label: "Loading test" },
  { value: "final_inspection", label: "Final inspection" },
] as const;
export const testingLabel = (v: string) => TESTING_CHECKS.find((x) => x.value === v)?.label ?? v.replace(/_/g, " ");

/** Structured spec fields added for the Sourcing Hub (columns on job_specs, also on v_specs). */
export interface SpecHubFields {
  spec_form: SpecForm; product_category: string | null; product_sub_type: string | null; has_components: boolean; size_description: string | null;
  material: string | null; substrate_weight_gsm: number | null; branding_method_id: string | null; life_expectancy: string | null; finished_style: string | null;
  testing_checklist: string[] | null; aql_level_id: string | null; has_lighting_electronics: boolean; lighting_electronics_detail: string | null;
  units_per_inner: number | null; units_per_outer: number | null; carton_length_cm: number | null; carton_width_cm: number | null; carton_height_cm: number | null;
  packing_method: string | null; design_guidelines: string | null; end_market: string | null; reusable: boolean | null; number_of_uses: number | null;
  designed_for_disassembly: boolean | null; recycled_content_percent: number | null; origin_country: string | null; unit_of_measure: string;
  selling_unit_qty: number | null; moq: number | null; net_weight_kg: number | null; gross_weight_kg: number | null; revision: number; revised_at: string | null;
}
export type SpecHub = Spec & SpecHubFields & { branding_method_name: string | null; aql_level_name: string | null; on_live_rfq: boolean };

/** Text fields of the structured spec form (form name = column name). */
export const SPEC_TEXT_FIELDS = [
  "product_category", "product_sub_type", "size_description", "material", "life_expectancy", "finished_style", "lighting_electronics_detail",
  "packing_method", "design_guidelines", "end_market", "origin_country", "unit_of_measure",
] as const;
export const SPEC_INT_FIELDS = ["units_per_inner", "units_per_outer", "number_of_uses", "selling_unit_qty", "moq"] as const;
export const SPEC_DECIMAL_FIELDS = ["substrate_weight_gsm", "carton_length_cm", "carton_width_cm", "carton_height_cm", "recycled_content_percent", "net_weight_kg", "gross_weight_kg"] as const;
/** Yes / no / not set. */
export const SPEC_TRISTATE_FIELDS = ["reusable", "designed_for_disassembly"] as const;
export const SPEC_BOOL_FIELDS = ["has_components", "has_lighting_electronics"] as const;

export interface SpecRevision { id: string; spec_id: string; revision: number; change_note: string | null; snapshot: Record<string, unknown>; created_by: string | null; created_at: string }

/** What still blocks a spec from going to RFQ (mirrors rfq_send for promo lines). */
export function rfqBlockers(spec: Pick<Spec, "spec_type" | "hs_code">): string[] {
  const out: string[] = [];
  if (spec.spec_type === "promo_merch" && !(spec.hs_code ?? "").trim()) out.push("HS code (mandatory for promo and merch)");
  return out;
}

/* ---------------- RFQ terms ---------------- */

export const MAX_BREAKS = 12;
export interface DeliveryPoint { id?: string; point_no?: number; label: string; address?: string | null; country?: string | null; quantity?: number | null; delivery_date?: string | null }

/**
 * Delivery points typed one per line: "Label; country; quantity; YYYY-MM-DD" (only the label is required).
 * Returns the points or the first error.
 */
export function parseDeliveryPoints(text: string | null | undefined): { points: DeliveryPoint[]; error?: string } {
  const points: DeliveryPoint[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [label, country, qty, date] = line.split(";").map((s) => s.trim());
    if (!label) return { points, error: "Each delivery point needs a name." };
    const quantity = qty ? Number(qty.replace(/[\s,]/g, "")) : null;
    if (quantity != null && (!Number.isInteger(quantity) || quantity <= 0)) return { points, error: `Delivery point "${label}": the quantity must be a whole number above zero.` };
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { points, error: `Delivery point "${label}": write the date as YYYY-MM-DD.` };
    points.push({ label, country: country || null, quantity, delivery_date: date || null });
  }
  return { points };
}
export const formatDeliveryPoints = (pts: DeliveryPoint[]) =>
  pts.map((p) => [p.label, p.country ?? "", p.quantity ?? "", p.delivery_date ?? ""].join("; ").replace(/(; )+$/, "")).join("\n");

/* ---------------- Vendor quote details ---------------- */

export interface QuoteLineDetail {
  line_id: string; lead_time_days: number | null; carton_length_cm: number | null; carton_width_cm: number | null; carton_height_cm: number | null;
  units_per_carton: number | null; gross_weight_kg: number | null; net_weight_kg: number | null; hs_code: string | null; country_of_origin: string | null;
  run_on_price: number | null; sample_cost: number | null; sample_lead_time_days: number | null; recycled_content_percent: number | null;
  reusable: boolean | null; number_of_uses: number | null; proposed_spec: string | null; notes: string | null;
}
export interface QuoteAlternative { id?: string; response_id?: string; line_id: string; alt_no?: number; description: string; quantity: number; unit_price: number; lead_time_days: number | null }
export interface PointPrice { response_id?: string; delivery_point_id: string; quantity: number; unit_price: number }

/** Run-on: what extra units cost, given the price per block of N additional units. */
export const runOnCost = (extraUnits: number, blockSize: number | null | undefined, blockPrice: number | null | undefined) =>
  !blockSize || blockPrice == null ? null : Math.ceil(extraUnits / blockSize) * Number(blockPrice);

/* ---------------- Estimate commercials ---------------- */

export const COST_CATEGORIES = [
  { value: "testing", label: "Testing" },
  { value: "inspection", label: "Inspection" },
  { value: "samples", label: "Samples" },
  { value: "logistics", label: "Logistics" },
  { value: "design", label: "Design" },
  { value: "installation", label: "Installation" },
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number]["value"];
export interface CostLine { id: string; estimate_id: string; category: CostCategory; description: string | null; amount: number; supplier_id: string | null; sort: number }
export const costLabel = (v: string) => (v === "product" ? "Product" : COST_CATEGORIES.find((c) => c.value === v)?.label ?? v);

/**
 * Sell price: cost with markup or margin, grossed up so GSC commission and the client's year-end rebate (both % of sell)
 * don't eat the margin. Mirrors public._estimate_sell().
 */
export function estimateSell(cost: number, mode: PricingMode, percent: number, commission = 0, rebate = 0): number {
  if (mode === "margin" && percent >= 100) return NaN;
  if (commission + rebate >= 100) return NaN;
  const pre = mode === "margin" ? cost / (1 - percent / 100) : cost * (1 + percent / 100);
  return Math.round((pre / (1 - (commission + rebate) / 100)) * 100) / 100;
}
/** Split of a sell price into cost, commission, rebate and what adm Indicia keeps. */
export function sellBreakdown(cost: number, sell: number, commission = 0, rebate = 0) {
  const commissionAmount = Math.round(sell * commission) / 100;
  const rebateAmount = Math.round(sell * rebate) / 100;
  return { commissionAmount, rebateAmount, netRevenue: sell - commissionAmount - rebateAmount, grossProfit: sell - commissionAmount - rebateAmount - cost };
}

export interface ClientPo { id: string; estimate_id: string; po_number: string; amount: number; currency: string; po_date: string; file_id: string | null; created_at: string }

export type OrderFlag = "pending_estimate_approval" | "po_pending" | "po_received";
export const ORDER_FLAG: Record<OrderFlag, { label: string; tone: Tone }> = {
  pending_estimate_approval: { label: "Pending estimate approval", tone: "accent" },
  po_pending: { label: "PO pending", tone: "warn" },
  po_received: { label: "PO received", tone: "ok" },
};
/** Same rule as v_estimates.order_flag. */
export function orderFlag(status: string, sell: number, poTotal: number, poCount: number, clientOrderRef: string | null): OrderFlag | null {
  if (status === "sent") return "pending_estimate_approval";
  if (status !== "approved") return null;
  if (poTotal + 0.005 >= sell || (poCount === 0 && (clientOrderRef ?? "").trim() !== "")) return "po_received";
  return "po_pending";
}

/* ---------------- Hand-off (hypercare) dashboard ---------------- */

export interface HandoffRow {
  id: string; estimate_number: string; job_id: string; job_number: string; job_title: string; client_name: string; currency: string; sell_price: number;
  approved_at: string | null; outbox_id: string | null; outbox_status: "queued" | "sent" | "failed" | null; queued_at: string | null; sent_at: string | null;
  days_to_handoff: number | null; days_since_approval: number | null; missing_fields: string[] | null;
}
export interface HandoffStats {
  approved: number; handedOff: number; handedOffPercent: number | null; awaiting: number; awaitingPercent: number | null;
  avgDaysToHandoff: number | null; onHold: HandoffRow[]; missingCounts: { field: string; count: number }[];
}
/** % handed to Stocktool, % awaiting action, average days approved → handed off, and what is on hold for missing data. */
export function handoffStats(rows: HandoffRow[]): HandoffStats {
  const approved = rows.length;
  const handed = rows.filter((r) => r.outbox_status === "sent");
  const awaiting = rows.filter((r) => r.outbox_status !== "sent");
  const days = handed.map((r) => Number(r.days_to_handoff)).filter((d) => Number.isFinite(d));
  const onHold = awaiting.filter((r) => (r.missing_fields ?? []).length > 0);
  const counts = new Map<string, number>();
  for (const r of onHold) for (const f of r.missing_fields ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  const pctOf = (n: number) => (approved ? Math.round((n / approved) * 1000) / 10 : null);
  return {
    approved, handedOff: handed.length, handedOffPercent: pctOf(handed.length), awaiting: awaiting.length, awaitingPercent: pctOf(awaiting.length),
    avgDaysToHandoff: days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null,
    onHold, missingCounts: [...counts.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
  };
}
