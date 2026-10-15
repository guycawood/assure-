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

// ---------- stage 2: stakeholders, Performance Tracker, surveys, forms, lists, emails, import ----------
export const DEPARTMENTS = [{ value: "marketing", label: "Marketing" }, { value: "procurement", label: "Procurement" }, { value: "other", label: "Other" }];
export const LEVELS = [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }];
export const RAGS = [{ value: "green", label: "Green" }, { value: "amber", label: "Amber" }, { value: "red", label: "Red" }];
export const FREQUENCIES = [
  { value: "weekly", label: "Weekly" }, { value: "fortnightly", label: "Fortnightly" }, { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" }, { value: "half_yearly", label: "Half-yearly" }, { value: "yearly", label: "Yearly" },
];
export const LEGAL_BASES = [
  { value: "legitimate_interest_existing", label: "Legitimate interest: existing customer" },
  { value: "legitimate_interest_prospect", label: "Legitimate interest: prospect" },
  { value: "consent", label: "Consent" }, { value: "contract", label: "Contract" }, { value: "none", label: "None (do not contact)" },
];
export const QUADRANT: Record<string, { label: string; tone: Tone }> = {
  INFORM: { label: "Inform", tone: "neutral" }, ESTABLISH: { label: "Establish", tone: "info" },
  MAINTAIN: { label: "Maintain", tone: "warn" }, GROW: { label: "Grow", tone: "ok" },
};
export const labelOf = (opts: { value: string; label: string }[], v: string | null | undefined) => opts.find((o) => o.value === v)?.label ?? v ?? "—";

export type StakeholderRow = {
  id: string; client_id: string; client_name: string; account_id: string | null; account_market: string | null; full_name: string; job_title: string | null;
  email: string | null; phone: string | null; market: string | null; market_name: string | null; decision_role: string; consent: boolean; active: boolean;
  owner: string | null; owner_name: string | null; owner_role_id: string | null; owner_role: string | null; owner_role_name: string | null;
  department: string | null; relationship_rag: string | null; last_contacted_on: string | null; contact_frequency: string | null;
  influence_level: string | null; decision_level: string | null; services_offered: string[]; services_declined: string[];
  services_offered_names: string[]; services_declined_names: string[]; induction_required: boolean; receive_survey: boolean; legal_basis: string;
  email_opt_out: boolean; left_at: string | null; last_reviewed_at: string | null; hubspot_id: string | null; quadrant: string | null; quadrant_name: string | null;
  quadrant_confirmed: boolean; needs_review: boolean; missing_fields: string[]; send_block: string | null; latest_survey_wave_id: string | null;
  latest_response_id: string | null; latest_nps: number | null;
};
export type PerformanceRow = {
  id: string; opp_code: string; client_id: string; client_name: string; contact_id: string | null; contact_name: string | null; title: string; stage: Stage;
  total_budget: number; currency: string; probability: number; weighted_budget: number; service_id: string | null; service_name: string | null;
  next_step_id: string | null; next_step_name: string | null; next_steps: string | null; cs_lead: string | null; cs_lead_name: string | null; sme: string | null;
  sme_name: string | null; owner_name: string | null; market: string | null; expected_close: string | null; created_at: string; updated_at: string;
  needs_updating: boolean; days_since_update: number;
};
export type SurveyWaveRow = {
  id: string; name: string; template_id: string; template_name: string; period_label: string | null; status: string; closes_on: string | null;
  recipient_count: number; excluded_count: number; created_by_name: string | null; created_at: string; sent_at: string | null; recipients: number; sent: number;
  opened: number; responded: number; approval_pending: boolean;
};
export type SurveyRecipientRow = {
  id: string; wave_id: string; contact_id: string; client_id: string; contact_name: string; contact_email: string | null; client_name: string; owner_name: string | null;
  token: string; status: string; excluded_reason: string | null; sent_at: string | null; opened_at: string | null; responded_at: string | null; response_id: string | null;
};
export type SurveyResultRow = {
  kind: "survey" | "feedback"; id: string; client_id: string; client_name: string; contact_id: string | null; contact_name: string | null; market: string | null;
  market_name: string | null; wave_id: string | null; wave_name: string | null; nps: number; overall: number | null; section_scores: Record<string, number>;
  scores: Record<string, number>; comments: Record<string, string>; start_doing: string | null; continue_doing: string | null; stop_doing: string | null;
  services_aware: string[]; services_interested: string[]; valuable_tools: string[]; testimonial_opt_in: boolean; created_at: string;
  nps_category: "promoter" | "passive" | "detractor"; feeling: "positive" | "neutral" | "negative";
};
export type SurveySection = { key: string; label: string; questions: { code: string; text: string }[] };
export type FormField = { key: string; label: string; type: "text" | "email" | "phone" | "textarea" | "select" | "checkbox"; required?: boolean; options?: string[] };
export type FormRow = {
  id: string; name: string; description: string | null; token: string; fields: FormField[]; consent_text: string | null; client_id: string | null; client_name: string | null;
  active: boolean; created_at: string; submissions: number; last_submission_at: string | null;
};
export type ListRow = {
  id: string; name: string; description: string | null; kind: "static" | "dynamic"; audience: "external" | "internal"; filters: Record<string, string | boolean>;
  created_by_name: string | null; client_name: string | null; static_members: number; emails: number; created_at: string;
};
export type AudienceRow = { contact_id: string | null; profile_id: string | null; email: string | null; full_name: string; client_name: string; owner: string | null; block: string | null };
export type EmailRow = {
  id: string; name: string; list_id: string; list_name: string; audience: string; template_id: string | null; subject: string; body: string; link: string | null;
  status: string; recipient_count: number; excluded_count: number; created_by_name: string | null; created_at: string; sent_at: string | null; delivered: number;
  opened: number; clicked: number; unsubscribed: number; simulated: boolean; approval_pending: boolean;
};
export type EmailRecipientRow = {
  id: string; email_id: string; contact_id: string | null; profile_id: string | null; email: string | null; full_name: string | null; status: string;
  excluded_reason: string | null; sent_at: string | null; unsubscribed_at: string | null; client_name: string | null; first_opened_at: string | null; opens: number; clicks: number;
};
export type ImportLogRow = {
  id: string; kind: string; file_name: string | null; row_count: number; created_count: number; updated_count: number; skipped_count: number;
  duplicates: { row: number; reason: string; match: string }[]; warnings: { row: number; message: string }[]; on_duplicate: string; created_by_name: string | null; created_at: string;
};
export type ImportReport = {
  kind: string; rows: number; create: number; update: number; skip: number; duplicates: { row: number; reason: string; match: string }[];
  errors: { row: number; message: string }[]; warnings: { row: number; message: string }[]; applied: boolean; log_id: string | null;
};

/** Average of the numbers, rounded to one decimal; null when empty. */
export const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
/** Count rows by a key (for dashboard cuts). */
export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r) ?? "Not set"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
// ---------- client reviews, cadence and actions ----------
export const REVIEW_TYPE: Record<string, string> = { qbr: "QBR", half_year: "Half-year review", annual: "Annual review", ad_hoc: "Ad hoc review" };
export const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "Planned", tone: "info" }, held: { label: "Held", tone: "warn" }, closed: { label: "Closed", tone: "ok" }, cancelled: { label: "Cancelled", tone: "neutral" },
};
export const CRM_ACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" }, in_progress: { label: "In progress", tone: "warn" }, done: { label: "Done", tone: "ok" }, cancelled: { label: "Cancelled", tone: "neutral" },
};
export const ACTION_SOURCE: Record<string, string> = { review: "Review", survey: "Survey follow-up", plan: "Account plan", ad_hoc: "Ad hoc" };

export type ReviewPack = {
  generated_at: string;
  health?: { rag: Rag; reasons: string[]; currency: string; spend_ytd: number; billed_ytd: number; overdue_bills: number; satisfaction: number | null; nps: number | null; next_renewal: string | null };
  pipeline?: { open: number; by_currency: Record<string, { value: number; weighted: number }> };
  won_last_12_months?: number;
  survey?: { responses: number; nps: number | null; overall: number | null };
  section_scores?: Record<string, number>;
  delivery?: { delivered: number; on_time: number; otif_percent: number | null };
  quality?: { audited: number; passed: number; pass_percent: number | null };
  jobs?: { closed: number; in_progress: number };
  open_actions?: { title: string; due_date: string | null; status: string; source: string }[];
};
export type ReviewRow = {
  id: string; client_id: string; client_name: string; account_id: string | null; account_market: string | null; review_type: string; title: string; scheduled_on: string;
  status: string; agenda: string[]; internal_attendees: string[]; contact_attendees: string[]; internal_attendee_names: string[] | null; contact_attendee_names: string[] | null;
  client_visible: boolean; pack: ReviewPack | null; pack_generated_at: string | null; outcomes: string | null; notes: string | null; cancelled_reason: string | null;
  held_at: string | null; closed_at: string | null; created_by_name: string | null; client_confirmed: number; actions: number; past_due: boolean;
};
export type CadenceRow = {
  client_id: string; client_name: string; active: boolean; cadence_days: number | null; tiers: string | null; last_review_on: string | null; next_planned_on: string | null;
  first_account_on: string | null; account_leads: string | null; review_due_on: string | null; review_overdue: boolean;
};
export type CrmActionRow = {
  id: string; client_id: string; client_name: string; source: string; title: string; detail: string | null; owner: string | null; owner_name: string | null;
  due_date: string | null; status: string; client_visible: boolean; review_id: string | null; review_title: string | null; plan_id: string | null; plan_title: string | null;
  created_at: string; done_at: string | null; overdue: boolean;
};