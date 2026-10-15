import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { JourneyRow, QaqcPlan } from "@/lib/qaqc";

type Client = Awaited<ReturnType<typeof createClient>>;

// QA/QC, journey and OTIF reads for internal pages (RLS / security-definer functions decide what comes back).

/** Full plans (checkpoints, evidence, rules) for a PO or a job. */
export async function getPlans(s: Client, filter: { po?: string; job?: string }): Promise<QaqcPlan[]> {
  let q = s.from("qaqc_plans").select("id").order("plan_ref");
  if (filter.po) q = q.eq("po_id", filter.po);
  if (filter.job) q = q.eq("job_id", filter.job);
  const { data } = await q;
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const plans = await Promise.all(ids.map(async (id) => (await s.rpc("qaqc_plan_detail", { p_plan: id })).data as QaqcPlan | null));
  return plans.filter((p): p is QaqcPlan => !!p);
}

/** Which checkpoints the signed-in user may verify (quality role, not the uploader). */
export async function reviewableIds(s: Client, plans: QaqcPlan[]): Promise<Set<string>> {
  const cps = plans.flatMap((p) => p.checkpoints).filter((c) => ["needs_review", "auto_verified", "submitted"].includes(c.status));
  const res = await Promise.all(cps.map(async (c) => [c.id, (await s.rpc("qaqc_can_review", { p_checkpoint: c.id })).data === true] as const));
  return new Set(res.filter(([, ok]) => ok).map(([id]) => id));
}

export async function getJourney(s: Client, jobId: string): Promise<JourneyRow[]> {
  const { data } = await s.from("v_job_journey").select("job_id, seq, milestone_code, milestone_label, at, actor_name, source, ref").eq("job_id", jobId).order("seq");
  return (data ?? []) as JourneyRow[];
}

export type JobSpeed = {
  job_id: string; job_number: string; title: string; client_name: string; region: string; market: string | null; category: string | null; status: string;
  started_at: string | null; delivered_at: string | null; brief_to_delivery_days: number | null; brief_to_approval_days: number | null;
  approval_to_po_days: number | null; po_to_pod_days: number | null; pod_to_installed_days: number | null; po_to_qaqc_days: number | null;
};
export async function getSpeed(s: Client, filter: { job?: string } = {}): Promise<JobSpeed[]> {
  let q = s.from("v_job_speed").select("*").order("delivered_at", { ascending: false, nullsFirst: false }).limit(500);
  if (filter.job) q = q.eq("job_id", filter.job);
  const { data } = await q;
  return (data ?? []) as JobSpeed[];
}

export type OtifRow = { dimension: string; key: string; label: string; deliveries: number; on_time: number; in_full: number; otif: number;
  otif_percent: number | null; on_time_percent: number | null; in_full_percent: number | null; avg_days_late: number | null };
export async function getOtifSummary(s: Client, dimension: string): Promise<OtifRow[]> {
  const { data } = await s.from("v_otif_summary").select("*").eq("dimension", dimension).order("label").limit(500);
  return (data ?? []) as OtifRow[];
}

export type PlanRow = {
  id: string; plan_ref: string; po_id: string | null; po_number: string | null; job_id: string; job_number: string; spec_title: string | null; supplier_name: string | null;
  client_name: string | null; required_level: number; computed_level: number; status: string; checkpoints: number; checkpoints_done: number;
  checkpoints_to_review: number; checkpoints_overdue: number; next_due: string | null; market: string | null;
};
export async function getPlanRows(s: Client): Promise<PlanRow[]> {
  const { data } = await s.from("v_qaqc_plans").select("id, plan_ref, po_id, po_number, job_id, job_number, spec_title, supplier_name, client_name, required_level, computed_level, status, checkpoints, checkpoints_done, checkpoints_to_review, checkpoints_overdue, next_due, market")
    .order("plan_ref", { ascending: false }).limit(500);
  return (data ?? []) as PlanRow[];
}

export type SupplierQuality = { supplier_id: string; supplier_name: string; plans: number; plans_passed: number; plans_failed: number; avg_level: number | null;
  first_time_pass_rate: number | null; checkpoints_rejected: number; ncrs_raised: number; ncrs_open: number };
export async function getSupplierQuality(s: Client): Promise<SupplierQuality[]> {
  const { data } = await s.from("v_supplier_quality_kpis").select("*").order("supplier_name");
  return (data ?? []) as SupplierQuality[];
}
