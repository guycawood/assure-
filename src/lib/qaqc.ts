// QA/QC threshold management, OTIF and speed to market: pure types and helpers (no I/O), shared by Order Management,
// the vendor portal, CRM and the Client Portal.
import type { Tone } from "@/lib/srt";

export type QaqcCheck = { code: string; label: string; ok: boolean; hard: boolean; detail: string };
export type QaqcRequirement = { group: string; codes: string[]; names: string; needs: string[] | null };
export type QaqcEvidence = {
  id: string; type: string; file_id: string | null; file_name: string | null; content_type: string | null; issued_on: string | null; expires_on: string | null;
  inspection_date: string | null; body_code: string | null; body_name: string | null; certificate_number: string | null; sample_size: number | null;
  defects_critical: number | null; defects_major: number | null; defects_minor: number | null; result: string | null; uploaded_by_vendor: boolean;
  submission_no: number; created_at: string;
};
export type QaqcCheckpoint = {
  id: string; checkpoint: string; label: string; status: string; due_date: string | null; verifier: string; signoff_required: boolean; min_photos: number;
  approved_body_required: boolean; failed: boolean; submission_count: number; submitted_at: string | null; verified_at: string | null;
  rejection_reason: string | null; review_note: string | null; checks: QaqcCheck[]; submission: { result?: string; notes?: string | null };
  ncr_id: string | null; aql: { code: string; name: string; major: string | null; minor: string | null; critical: string | null } | null;
  required: QaqcRequirement[]; evidence: QaqcEvidence[];
};
export type QaqcRule = { code: string; name: string; effect: string; level: number | null; bump: number | null; explanation: string };
export type QaqcPlan = {
  id: string; plan_ref: string; po_id: string | null; po_number: string | null; po_status: string | null; job_number: string; job_title: string;
  spec_title: string | null; spec_type: string | null; quantity: number | null; required_level: number; computed_level: number; level_name: string | null;
  level_description: string | null; verifier: string | null; status: string; passed_at: string | null; level_reason: string | null;
  reasons: string[]; rules: QaqcRule[] | null; checkpoints: QaqcCheckpoint[];
};

export const PLAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" }, in_progress: { label: "In progress", tone: "info" },
  passed: { label: "Passed", tone: "ok" }, failed: { label: "Failed", tone: "bad" }, waived: { label: "Waived (approved)", tone: "warn" },
};
export const CHECKPOINT_STATUS: Record<string, { label: string; tone: Tone }> = {
  required: { label: "Required", tone: "neutral" }, submitted: { label: "Submitted", tone: "info" },
  auto_verified: { label: "Auto-verified", tone: "ok" }, needs_review: { label: "Needs review", tone: "warn" },
  verified: { label: "Verified", tone: "ok" }, rejected: { label: "Rejected", tone: "bad" }, withdrawn: { label: "Not needed", tone: "neutral" },
};
export const VERIFIER_LABEL: Record<string, string> = {
  auto: "Checked automatically at upload", quality: "Verified by an adm Indicia quality role", third_party: "Third-party report, verified by a quality role",
};
export const NEED_LABEL: Record<string, string> = {
  issued_on: "issue date", expires_on: "expiry date", inspection_date: "inspection date", body: "lab or inspection body", certificate_number: "certificate number",
  aql: "AQL sample size and defects", result: "result",
};

export const planStatus = (s: string) => PLAN_STATUS[s] ?? { label: s, tone: "neutral" as Tone };
export const checkpointStatus = (s: string) => CHECKPOINT_STATUS[s] ?? { label: s, tone: "neutral" as Tone };
export const levelLabel = (n: number | null | undefined) => (n ? `L${n}` : "–");

/** Whether a checkpoint can take a (re)submission. */
export const canSubmit = (c: Pick<QaqcCheckpoint, "status">) => ["required", "rejected", "needs_review", "submitted"].includes(c.status);

/** Mirrors qaqc_aql_accept() in SQL: ISO 2859-1 single sampling, normal inspection (for previews in forms). */
export function aqlAccept(sample: number | null | undefined, aql: number | null | undefined): number | null {
  if (sample == null || aql == null) return null;
  if (aql <= 0) return 0;
  const ns = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250];
  const aqls = [0.65, 1.0, 1.5, 2.5, 4.0, 6.5];
  let i = 0, a = 0;
  ns.forEach((n, k) => { if (n <= sample) i = k + 1; });
  aqls.forEach((x, k) => { if (x <= aql) a = k + 1; });
  if (!i || !a) return 0;
  const k = i - 1 + (a - 4);
  return k <= 3 ? 0 : k <= 5 ? 1 : k === 6 ? 2 : k === 7 ? 3 : k === 8 ? 5 : k === 9 ? 7 : k === 10 ? 10 : k === 11 ? 14 : 21;
}

// ---------------------------------------------------------------------------
// Journey and speed to market
// ---------------------------------------------------------------------------
export type JourneyRow = { job_id: string; seq: number; milestone_code: string; milestone_label: string; at: string; actor_name: string | null; source: string; ref: string | null };

export const MILESTONES: { seq: number; code: string; label: string }[] = [
  [1, "brief_submitted", "Brief submitted"], [2, "brief_approved", "Brief approved"], [3, "concept_approved", "Concept approved (internal)"],
  [4, "concept_client_approved", "Concept approved (client)"], [5, "job_created", "Job created"], [6, "spec_locked", "Specs approved"], [7, "triage_done", "Triage done"],
  [8, "rfq_sent", "RFQ sent"], [9, "quotes_in", "Quotes in (bidding closed)"], [10, "awarded", "Awarded"], [11, "estimate_sent", "Estimate sent"],
  [12, "estimate_approved", "Estimate approved (client)"], [13, "client_po", "Client PO received"], [14, "po_approved", "PO approved"], [15, "po_issued", "PO issued"],
  [16, "po_accepted", "PO accepted by vendor"], [17, "production_started", "Production started"], [18, "qaqc_passed", "QA/QC passed"], [19, "shipped", "Shipped"],
  [20, "pod", "POD"], [21, "pod_verified", "POD verified"], [22, "delivered", "Delivered"], [23, "installed", "Installed"], [24, "audited", "Audited"],
  [25, "invoiced", "Invoiced"], [26, "paid", "Paid"], [27, "job_closed", "Job closed"],
].map(([seq, code, label]) => ({ seq: seq as number, code: code as string, label: label as string }));

/** Days between two timestamps, one decimal (null when either is missing). */
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 864e5) * 10) / 10;
}
export const fmtDays = (d: number | null | undefined) => (d == null ? "–" : `${d.toLocaleString("en-GB", { maximumFractionDigits: 1 })} d`);
export const fmtPct = (v: number | string | null | undefined) => (v == null || v === "" ? "–" : `${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`);

/** Tone for a value against a target (higher is better unless lowerIsBetter). */
export function targetTone(value: number | null | undefined, target: number | null | undefined, lowerIsBetter = false): "ok" | "warn" | "bad" | undefined {
  if (value == null || target == null) return undefined;
  const v = Number(value), t = Number(target);
  if (lowerIsBetter) return v <= t ? "ok" : v <= t * 1.25 ? "warn" : "bad";
  return v >= t ? "ok" : v >= t - 15 ? "warn" : "bad";
}

/** Delivery KPIs as returned by crm_client_delivery_kpis / client_portal_delivery_kpis. */
export type DeliveryKpis = {
  since: string;
  otif: { measured: number; on_time: number; in_full: number; otif: number; otif_percent: number | null; on_time_percent: number | null; in_full_percent: number | null; target: number; tolerance_days: number } | null;
  otif_by_month: { month: string; measured: number; otif_percent: number | null }[];
  qaqc: { plans: number; passed: number; failed: number; waived: number; open: number; pass_percent: number | null; first_time_pass_percent: number | null; target: number;
          by_level: { level: number; plans: number; passed: number; failed: number; pass_percent: number | null }[] } | null;
  speed: { jobs: number; median_brief_to_delivery_days: number | null; target_days: number;
           stages: { brief_to_approval: number | null; approval_to_po: number | null; po_to_pod: number | null; pod_to_installed: number | null } } | null;
  ncrs?: { raised: number; open: number; critical: number; from_qaqc: number } | null;
  qa_min_level?: number | null;
};
