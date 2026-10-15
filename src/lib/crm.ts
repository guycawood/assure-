// CRM labels, types and small calculations (pure, no I/O).
import type { Tone } from "@/lib/srt";

export const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const OPEN_STAGES: Stage[] = ["lead", "qualified", "proposal", "negotiation"];

export const STAGE: Record<string, { label: string; tone: Tone }> = {
  lead: { label: "Lead", tone: "neutral" },
  qualified: { label: "Qualified", tone: "info" },
  proposal: { label: "Proposal", tone: "accent" },
  negotiation: { label: "Negotiation", tone: "warn" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "bad" },
};

export const ACCOUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  prospect: { label: "Prospect", tone: "info" },
  active: { label: "Active", tone: "ok" },
  dormant: { label: "Dormant", tone: "warn" },
  closed: { label: "Closed", tone: "neutral" },
};

export const CONTRACT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  signed: { label: "Signed", tone: "ok" },
  ended: { label: "Ended", tone: "neutral" },
};

export const CONTRACT_TYPE: Record<string, string> = { msa: "MSA", sow: "SOW", other: "Other" };

export const PLAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "ok" },
  closed: { label: "Closed", tone: "neutral" },
};

export const ACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  done: { label: "Done", tone: "ok" },
  dropped: { label: "Dropped", tone: "neutral" },
};

export const SETUP_STATUS: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Ready for jobs", tone: "ok" },
  pending: { label: "Waiting for Finance", tone: "warn" },
  rejected: { label: "Set-up refused", tone: "bad" },
};

export const DECISION_ROLES = [
  { value: "sponsor", label: "Sponsor" },
  { value: "approver", label: "Approver" },
  { value: "buyer", label: "Buyer" },
  { value: "user", label: "User" },
] as const;
export const decisionRole = (v: string) => DECISION_ROLES.find((d) => d.value === v)?.label ?? v;

export type Rag = "green" | "amber" | "red";
export const RAG: Record<Rag, { label: string; tone: Tone }> = {
  green: { label: "Green", tone: "ok" },
  amber: { label: "Amber", tone: "warn" },
  red: { label: "Red", tone: "bad" },
};

/** NPS group of a 0-10 score. */
export const npsGroup = (score: number): "promoter" | "passive" | "detractor" => (score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor");
export const NPS_TONE: Record<string, Tone> = { promoter: "ok", passive: "warn", detractor: "bad" };

/** Net promoter score (-100..100) of a list of 0-10 scores; null when there are none. */
export function nps(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const p = scores.filter((s) => s >= 9).length;
  const d = scores.filter((s) => s <= 6).length;
  return Math.round((100 * (p - d)) / scores.length);
}

export const weighted = (value: number, probability: number) => Math.round((Number(value) * Number(probability)) / 100);

export function money(v: number | null | undefined, currency: string | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "EUR", maximumFractionDigits: digits }).format(Number(v));
  } catch {
    return `${currency ?? ""} ${Math.round(Number(v)).toLocaleString("en-GB")}`.trim();
  }
}

/** Sum amounts per currency ("€1,000 · £500"); no FX conversion. */
export function moneyByCurrency(rows: { value: number; currency: string }[]): string {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? 0) + Number(r.value));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => money(v, c)).join(" · ") || "—";
}

export const daysAgo = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
export const ago = (iso: string | null | undefined) => {
  const d = daysAgo(iso);
  return d == null ? "Never" : d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
};

// ---------- row types (views) ----------
export type ClientRow = {
  id: string; code: string; name: string; default_currency: string; active: boolean; hq_market: string | null; sector: string | null;
  credit_limit: number | null; payment_terms_days: number | null; crm_setup_status: string; crm_setup_note: string | null;
  default_markup_percent: number; gsc_commission_percent: number; year_end_rebate_percent: number; savings_target_percent: number;
  min_quotes_required: number; e_tender_threshold: number | null;
};
export type AccountRow = {
  id: string; client_id: string; client_name: string; client_code: string; market: string; market_name: string | null; region: string;
  account_lead: string | null; account_lead_name: string | null; account_lead_email: string | null; tier_id: string | null; tier_code: string | null;
  tier_name: string | null; status: string; notes: string | null; last_activity_at: string | null; open_opportunities: number;
};
export type ContactRow = {
  id: string; client_id: string; client_name: string; account_id: string | null; full_name: string; job_title: string | null; email: string | null;
  phone: string | null; market: string | null; market_name: string | null; decision_role: string; consent: boolean; consent_at: string | null; active: boolean;
};
export type OpportunityRow = {
  id: string; opp_code: string; client_id: string; client_name: string; account_id: string | null; title: string; description: string | null;
  stage: Stage; value: number; currency: string; probability: number; weighted_value: number; expected_close: string | null; owner: string | null;
  owner_name: string | null; lost_reason_name: string | null; lost_note: string | null; won_at: string | null; lost_at: string | null;
  campaign_id: string | null; campaign_code: string | null; campaign_name: string | null; market: string | null; market_name: string | null;
  win_pending: boolean; created_at: string;
};
export type InteractionRow = {
  id: string; client_id: string; client_name: string; account_id: string | null; opportunity_id: string | null; opp_code: string | null;
  opportunity_title: string | null; contact_name: string | null; type_code: string; type_name: string; subject: string; summary: string | null;
  occurred_at: string; owner_name: string | null; market: string | null;
};
export type PlanRow = {
  id: string; client_id: string; client_name: string; account_id: string | null; account_market: string | null; title: string; period_start: string;
  period_end: string; objectives: string | null; growth_target: number | null; currency: string; status: string; owner_name: string | null;
  actions_total: number; actions_done: number; actions_overdue: number;
};
export type PlanActionRow = { id: string; plan_id: string; client_id: string; plan_title: string; action: string; owner_name: string | null; due_date: string | null; status: string };
export type ContractRow = {
  id: string; contract_code: string; client_id: string; client_name: string; parent_id: string | null; parent_code: string | null; contract_type: string;
  title: string; start_date: string | null; end_date: string | null; renewal_date: string | null; next_renewal: string | null; days_to_renewal: number | null;
  notice_days: number | null; auto_renew: boolean; value: number | null; currency: string; payment_terms_days: number | null; markup_percent: number | null;
  min_margin_percent: number | null; gsc_commission_percent: number | null; rebate_percent: number | null; sustainability_commitments: string | null;
  status: string; signed_at: string | null; signed_by_name: string | null; renewal_count: number; approval_pending: boolean; notes: string | null;
};
export type FeedbackRow = {
  id: string; client_id: string; client_name: string; account_id: string | null; contact_name: string | null; market: string | null; score: number;
  comment: string | null; source: "internal" | "client_portal"; submitted_by_name: string | null; followed_up_at: string | null; follow_up_note: string | null;
  created_at: string; nps_group: string;
};
export type HealthRow = {
  client_id: string; code: string; name: string; currency: string; active: boolean; crm_setup_status: string; spend_ytd: number; billed_ytd: number;
  overdue_bills: number; open_issues: number; satisfaction: number | null; feedback_count: number; nps: number | null; next_renewal: string | null;
  last_activity_at: string | null; accounts: number; days_since_activity: number | null; days_to_renewal: number | null; points: number;
  reasons: string[]; rag: Rag;
};
export type LibOption = { id: string; code: string | null; name: string; data: Record<string, unknown> };
export type Person = { id: string; name: string; email: string };
export type MarketOption = { code: string; name: string; region_code: string };
