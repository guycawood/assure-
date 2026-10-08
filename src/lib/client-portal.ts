// Client Portal: types and plain-English labels (no I/O). Everything here is client-safe by construction:
// the SQL functions (client_portal_*) only return sell prices, statuses and dates, never supplier or cost fields.
import type { Tone } from "@/lib/srt";

export type ClientRole = "approver" | "viewer" | "preview";
export type Account = { id: string; code: string; name: string; currency: string; role: ClientRole };
export type Money = { currency: string; amount: number };

export type Summary = {
  live_campaigns: number; open_briefs: number; estimates_awaiting: number; orders_in_progress: number;
  spend_ytd: Money[]; savings_ytd: Money[];
};

export type Campaign = {
  id: string; campaign_code: string; name: string; client_name: string; brands: string[]; objective: string | null;
  campaign_type: string | null; activation_objective: string | null; start_date: string | null; end_date: string | null;
  status: "planning" | "live" | "closed"; markets: string[]; brief_count: number;
};

export type BriefRow = {
  id: string; brief_code: string; title: string; campaign_name: string | null; campaign_code: string | null; client_name: string | null;
  region: string | null; market: string | null; brand: string | null; status: string; approval_status: string | null;
  target_launch: string | null; submitted_at: string | null; budget_low: number | null; budget_high: number | null; currency: string; comment_count: number;
};
export type ClientComment = { id: number; body: string; created_at: string; author_name: string; client_name: string };
export type BriefDetail = BriefRow & {
  objective: string | null; brief_text: string | null; target_outlets: string | null; product_category: string | null;
  sustainability_targets: string | null; min_recycled_pct: number | null; require_fsc: boolean; client_id: string;
  timeline: { event: string; to_status: string | null; at: string }[]; comments: ClientComment[];
};

export type Decision = { decision: "approve" | "decline"; comment: string | null; client_order_ref: string | null; decided_at: string; decided_by_name: string | null };
export type EstimateRow = {
  id: string; estimate_number: string; job_id: string; job_number: string; job_title: string; brand: string | null; campaign_name: string | null;
  client_id: string; client_name: string; currency: string; sell_price: number; status: "sent" | "approved" | "declined";
  sent_at: string | null; approved_at: string | null; client_order_ref: string | null; declined_reason: string | null;
  region: string; market: string; role: ClientRole | null; decision: Decision | null;
};
export type EstimateLine = { spec_no: number; title: string; spec_type: string; description: string | null; quantity: number; unit_sell: number; line_sell: number };
export type EstimateDetail = EstimateRow & { lines: EstimateLine[]; decisions: Decision[] };

export type Milestones = { estimate_approved: string | null; order_placed: string | null; in_production: string | null; delivered: string | null; closed: string | null };
export type OrderRow = {
  id: string; job_number: string; title: string; brand: string | null; campaign_name: string | null; client_name: string; client_job_ref: string | null;
  region: string; market: string; status: string; opened_date: string; target_delivery_date: string | null; closed_at: string | null;
  estimates: { estimate_number: string; currency: string; sell_price: number; approved_at: string; client_order_ref: string | null }[];
  orders: { po_number: string; status: string; po_date: string; delivery_date: string | null; placed_at: string | null; accepted_at: string | null }[];
  milestones: Milestones;
};

export type EffectivenessRow = {
  id: string; campaign_id: string; campaign_name: string; campaign_code: string; region: string; market: string; touchpoint: string;
  p2p_stage: string | null; channel: string | null; period_start: string | null; period_end: string | null; spend: number; currency: string;
  units: number | null; execution_score: number | null; uplift_pct: number | null; uplift_source: string;
};

export type Report = {
  by_month: { month: string; currency: string; spend: number; savings: number; estimates: number }[];
  by_market: { region: string; market: string; currency: string; spend: number; savings: number; estimates: number }[];
  sustainability: { specs: number; specs_with_co2e: number; co2e_kg: number; units: number; by_market: { market: string; co2e_kg: number; specs: number }[] };
  effectiveness: { touchpoint: string; rows: number; avg_execution: number | null; avg_uplift: number | null; measured: number }[];
};

// ---------------------------------------------------------------------------
// Labels (client-facing wording)
// ---------------------------------------------------------------------------
export const BRIEF_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "With adm Indicia for review", tone: "info" },
  in_ideation: { label: "Approved, ideas in progress", tone: "accent" },
  spec_created: { label: "Moved to production planning", tone: "ok" },
  archived: { label: "Closed", tone: "neutral" },
};

export function estimateStatus(e: Pick<EstimateRow, "status" | "decision">): { label: string; tone: Tone } {
  if (e.status === "approved") return { label: "Approved", tone: "ok" };
  if (e.status === "declined") return { label: "Declined", tone: "bad" };
  if (e.decision?.decision === "approve") return { label: "You approved: adm Indicia is confirming", tone: "info" };
  if (e.decision?.decision === "decline") return { label: "You declined: adm Indicia is following up", tone: "warn" };
  return { label: "Waiting for your decision", tone: "warn" };
}

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Being set up", tone: "neutral" },
  quoting: { label: "Being priced", tone: "info" },
  ordered: { label: "Ordered", tone: "accent" },
  in_production: { label: "In production", tone: "accent" },
  delivered: { label: "Delivered", tone: "ok" },
  closed: { label: "Complete", tone: "ok" },
};

export const ORDER_STATUS: Record<string, string> = {
  pending_approval: "Being placed",
  issued: "Placed with our production partner",
  accepted: "Confirmed by our production partner",
};

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  planning: { label: "Planning", tone: "info" },
  live: { label: "Live", tone: "ok" },
  closed: { label: "Closed", tone: "neutral" },
};

export const BRIEF_EVENT: Record<string, string> = {
  submitted: "Brief submitted",
  approved: "Brief approved",
  changes_requested: "Changes being made",
  archived: "Brief closed",
  handoff_created: "Concept chosen, sent to production planning",
  spec_created: "Production planning started",
};

const STEP_ORDER = ["estimate_approved", "order_placed", "in_production", "delivered", "closed"] as const;
const STEP_LABEL: Record<(typeof STEP_ORDER)[number], string> = {
  estimate_approved: "Estimate approved",
  order_placed: "Order placed",
  in_production: "In production",
  delivered: "Delivered",
  closed: "Complete",
};
const STATUS_RANK: Record<string, number> = { open: -1, quoting: -1, ordered: 1, in_production: 2, delivered: 3, closed: 4, cancelled: -1 };

/** Progress timeline for an order: a step is done when it has a date or the job status is past it. */
export function orderSteps(o: Pick<OrderRow, "status" | "milestones" | "estimates">) {
  const rank = STATUS_RANK[o.status] ?? -1;
  const steps = STEP_ORDER.map((k, i) => {
    const at = o.milestones[k];
    const done = Boolean(at) || (k === "estimate_approved" ? o.estimates.length > 0 : rank >= i);
    return { key: k, label: STEP_LABEL[k], at, done };
  });
  const current = steps.findIndex((s) => !s.done);
  return { steps, current: current === -1 ? steps.length : current };
}

/** Group money by currency into one display string, largest first. */
export function moneyList(list: Money[], fmt: (n: number, c: string) => string): string {
  if (!list.length) return fmt(0, "EUR");
  return list.map((m) => fmt(Number(m.amount), m.currency)).join(" + ");
}

export const isUuid = (s: string | undefined | null): s is string => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Append the preview parameter to a portal link (internal preview keeps the client in the URL). */
export const withPreview = (href: string, preview: string | null) => (preview ? `${href}${href.includes("?") ? "&" : "?"}preview=${preview}` : href);

export function fmtMoney(n: number | null | undefined, currency = "EUR", digits = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) }).format(Number(n));
  } catch {
    return `${currency} ${Number(n).toLocaleString("en-GB")}`;
  }
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}
