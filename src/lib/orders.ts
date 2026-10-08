// Order Management+ pure logic: estimate maths (markup or margin, savings), PO and PSA status metadata.
import type { Tone } from "@/lib/srt";

export type PricingMode = "markup" | "margin";

/** Sell price from cost: markup adds % of cost; margin makes % of the sell price profit. Mirrors trg_estimates_before(). */
export function sellPrice(cost: number, mode: PricingMode, percent: number): number {
  if (mode === "margin") {
    if (percent >= 100) return NaN;
    return Math.round((cost / (1 - percent / 100)) * 100) / 100;
  }
  return Math.round(cost * (1 + percent / 100) * 100) / 100;
}
export const grossProfit = (cost: number, sell: number) => sell - cost;
export const marginPercent = (cost: number, sell: number) => (sell ? ((sell - cost) / sell) * 100 : 0);
export const savingsPercent = (saving: number | null | undefined, base: number | null | undefined) => (saving == null || !base ? null : (saving / base) * 100);

export interface Estimate {
  id: string; estimate_number: string; job_id: string; rfq_id: string | null; response_id: string | null; supplier_id: string; source: string; currency: string;
  base_cost: number; benchmark_value: number | null; benchmark_source: string | null; target_value: number | null; pricing_mode: PricingMode; pricing_percent: number;
  sell_price: number; savings_vs_benchmark: number | null; savings_vs_target: number | null; savings_target_percent: number | null; bypass_reason_code: string | null;
  selection_reason: string | null; status: string; client_order_ref: string | null; sent_at: string | null; approved_at: string | null; declined_reason: string | null;
  region: string; market: string; created_at: string; job_number: string; job_title: string; client_name: string; supplier_name: string; rfq_number: string | null;
}
export interface EstimateLine { id: string; estimate_id: string; spec_id: string; quantity: number; unit_cost: number; line_cost: number; benchmark_unit: number | null; target_unit: number | null }
export interface PurchaseOrder {
  id: string; po_number: string; job_id: string; estimate_id: string; supplier_id: string; currency: string; total_value: number; po_date: string; delivery_date: string | null;
  status: string; required_doa_level: number; doa_basis: string | null; exceeds_e_tender: boolean; approved_by: string | null; approver_doa_level: number | null;
  approved_at: string | null; rejected_reason: string | null; vendor_responded_at: string | null; vendor_decline_reason: string | null; region: string; market: string;
  notes: string | null; created_by: string | null; created_at: string; job_number: string; job_title: string; client_name: string; supplier_name: string;
  supplier_code: string | null; estimate_number: string; approved_by_name: string | null;
}

export const ESTIMATE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "With client", tone: "accent" },
  approved: { label: "Client approved", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
};
export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_approval: { label: "Awaiting DOA approval", tone: "warn" },
  rejected: { label: "Rejected", tone: "bad" },
  issued: { label: "Issued to vendor", tone: "accent" },
  accepted: { label: "Vendor accepted", tone: "ok" },
  declined: { label: "Vendor declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export type PsaStage = "draft" | "line_manager" | "procurement" | "approver" | "to_apply" | "applied" | "resolved" | "rejected";
export const PSA_STAGES: { value: PsaStage; label: string; tone: Tone; description: string }[] = [
  { value: "draft", label: "Request", tone: "neutral", description: "The requester describes the fee, supplier, job and business reason." },
  { value: "line_manager", label: "Line manager", tone: "warn", description: "The requester's line manager checks the request is valid." },
  { value: "procurement", label: "Procurement SME", tone: "warn", description: "Regional procurement tries to protect the PSA first." },
  { value: "approver", label: "Delegated approver", tone: "warn", description: "Someone with enough DOA authority confirms the exception." },
  { value: "to_apply", label: "To apply", tone: "accent", description: "FSSC / CST apply the fee exception and are notified." },
  { value: "applied", label: "Applied", tone: "ok", description: "Exception applied; reason, approver and value impact recorded." },
  { value: "resolved", label: "Resolved without exception", tone: "ok", description: "Supplier co-operation or an alternative supplier protected the PSA." },
  { value: "rejected", label: "Rejected", tone: "bad", description: "Rejected by the line manager or the approver." },
];
export const PSA_OUTCOMES = [
  { value: "supplier_cooperation", label: "Supplier co-operation", description: "Price reduction secured; PSA protected before the order." },
  { value: "alternative_supplier", label: "Alternative supplier", description: "PSA protected by switching supplier." },
  { value: "exception_confirmed", label: "Exception confirmed", description: "A fee exception is needed; goes to a delegated approver." },
] as const;
export const psaStage = (s: string) => PSA_STAGES.find((x) => x.value === s) ?? PSA_STAGES[0];
