// RFQ+ pure logic: benchmark (computeLineBenchmark), price dispersion and price-curve scenarios (white paper,
// Data Intelligence pillar). Mirrors rfq_line_benchmark() in the database, which is what the award uses.
import type { Tone } from "@/lib/srt";

export type RfqStatus = "draft" | "sent" | "awarded" | "cancelled";
export const RFQ_STATUS: { value: RfqStatus; label: string; tone: Tone }[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "sent", label: "Out for quotes", tone: "accent" },
  { value: "awarded", label: "Awarded", tone: "ok" },
  { value: "cancelled", label: "Cancelled", tone: "bad" },
];
export const rfqStatus = (s: string) => RFQ_STATUS.find((x) => x.value === s) ?? { value: s, label: s, tone: "neutral" as Tone };

export const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  awarded: { label: "Awarded", tone: "ok" },
  declined: { label: "Not awarded", tone: "neutral" },
};
export const INVITE_STATUS: Record<string, { label: string; tone: Tone }> = {
  invited: { label: "Invited", tone: "neutral" },
  viewed: { label: "Viewed", tone: "info" },
  quoted: { label: "Quoted", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
};
export const FINANCE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Finance pending", tone: "warn" },
  approved: { label: "Finance approved", tone: "ok" },
  declined: { label: "Finance declined", tone: "bad" },
};

export interface Rfq {
  id: string; rfq_number: string; job_id: string; title: string; status: RfqStatus; currency: string; due_at: string; estimated_value: number | null;
  region: string; market: string; control_band: string | null; min_quotes_required: number | null; min_quotes_basis: string | null;
  high_value_threshold: number | null; high_value_alert: boolean; high_value_approved_by: string | null; high_value_approved_at: string | null;
  notes: string | null; created_by: string | null; created_at: string; sent_at: string | null; awarded_response_id: string | null; awarded_at: string | null;
  award_reason: string | null; bypass_reason_code: string | null; cancelled_reason: string | null;
  job_number: string; job_title: string; client_name: string; invited_count: number; quote_count: number; declined_count: number; line_count: number;
  awarded_supplier_name: string | null;
}
export interface RfqLine { id: string; rfq_id: string; spec_id: string; line_no: number; quantity_breaks: number[]; target_prices: (number | null)[] | null; show_targets: boolean; notes: string | null }
export interface RfqInvitation { rfq_id: string; supplier_id: string; status: string; cross_border: boolean; invited_at: string; viewed_at: string | null; responded_at: string | null; declined_at: string | null; decline_reason: string | null; supplier_name: string; supplier_code: string | null; supplier_market: string | null; purchasing_blocked: boolean; supplier_active: boolean }
export interface RfqResponse {
  id: string; rfq_id: string; supplier_id: string; status: string; source: string; currency: string; lead_time_days: number | null; total_value: number | null;
  notes: string | null; submitted_at: string | null; finance_status: string; finance_at: string | null; finance_notes: string | null;
  supplier_name: string; supplier_code: string | null; supplier_market: string | null; purchasing_blocked: boolean; supplier_active: boolean;
}
export interface ResponsePrice { response_id: string; line_id: string; quantity: number; unit_price: number; lead_time_days: number | null }

/** Average of the quotes, re-averaged within ± tolerance % of that average (computeLineBenchmark). 0 when no quotes. */
export function computeLineBenchmark(prices: number[], tolerancePercent: number | null | undefined): number {
  const p = prices.filter((x) => Number.isFinite(x));
  if (p.length === 0) return 0;
  const avg = p.reduce((s, x) => s + x, 0) / p.length;
  if (tolerancePercent == null || tolerancePercent <= 0) return avg;
  const within = p.filter((x) => Math.abs(x - avg) <= (avg * tolerancePercent) / 100);
  return within.length === 0 ? avg : within.reduce((s, x) => s + x, 0) / within.length;
}

/** Lowest-to-highest spread as a % of the lowest quote. */
export function priceDispersion(prices: number[]): number | null {
  const p = prices.filter((x) => Number.isFinite(x) && x > 0);
  if (p.length < 2) return null;
  const lo = Math.min(...p);
  return ((Math.max(...p) - lo) / lo) * 100;
}

export type CurveScenario = "in_range" | "low_outlier" | "high_outlier";
/** Price-curve position of one quote against the benchmark: low outlier → investigate, high outlier → renegotiate. */
export function curveScenario(price: number, benchmark: number, tolerancePercent = 15): { scenario: CurveScenario; label: string; tone: Tone } {
  if (!benchmark) return { scenario: "in_range", label: "In range", tone: "ok" };
  const dev = ((price - benchmark) / benchmark) * 100;
  if (dev < -tolerancePercent) return { scenario: "low_outlier", label: "Low outlier: investigate", tone: "warn" };
  if (dev > tolerancePercent) return { scenario: "high_outlier", label: "High outlier: renegotiate", tone: "bad" };
  return { scenario: "in_range", label: "In range", tone: "ok" };
}

/** Saving of a quote vs the target (positive = cheaper than target). */
export const savingVsTarget = (unitPrice: number, target: number | null | undefined, qty: number) => (target == null ? null : (target - unitPrice) * qty);

export function isBiddingOpen(r: Pick<Rfq, "status" | "due_at">, now = Date.now()) {
  return r.status === "sent" && new Date(r.due_at).getTime() > now;
}
