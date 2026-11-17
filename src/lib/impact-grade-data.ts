import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { IntensityRow } from "@/lib/carbon-intensity";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Impact Grade (0-100) per spec, for badges across the journey. Read straight from job_specs: the older views
 * (v_specs, v_deliveries, v_deployments) predate the column.
 */
export async function getSpecGrades(supabase: Client, specIds: (string | null | undefined)[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(specIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const { data } = await supabase.from("job_specs").select("id, impact_grade").in("id", ids);
  return new Map(((data ?? []) as { id: string; impact_grade: number | null }[]).map((r) => [r.id, r.impact_grade === null ? null : Number(r.impact_grade)]));
}

/** Carbon intensity rows (spec_carbon_intensity), by specs, client, supplier or job. */
export async function getCarbonIntensity(supabase: Client, f: { specIds?: string[]; clientId?: string; supplierId?: string; jobId?: string }): Promise<IntensityRow[]> {
  if (f.specIds && !f.specIds.length) return [];
  const { data, error } = await supabase.rpc("spec_carbon_intensity", {
    p_spec_ids: f.specIds ?? null, p_client: f.clientId ?? null, p_supplier: f.supplierId ?? null, p_job: f.jobId ?? null,
  });
  if (error) return [];
  return ((data ?? []) as IntensityRow[]).map((r) => ({ ...r, co2e_kg: r.co2e_kg === null ? null : Number(r.co2e_kg), weight_kg: r.weight_kg === null ? null : Number(r.weight_kg),
    spend_eur: r.spend_eur === null ? null : Number(r.spend_eur), economic_intensity: r.economic_intensity === null ? null : Number(r.economic_intensity),
    physical_intensity: r.physical_intensity === null ? null : Number(r.physical_intensity) }));
}

/** Aggregate Impact Grade per job: the plain average of its specs' grades (specs without a grade are left out and counted). */
export async function getJobGrades(supabase: Client, jobIds: string[]): Promise<Map<string, { avg: number | null; specs: number; graded: number }>> {
  const out = new Map<string, { avg: number | null; specs: number; graded: number }>();
  if (!jobIds.length) return out;
  const { data } = await supabase.from("job_specs").select("job_id, impact_grade").in("job_id", jobIds).limit(5000);
  const by = new Map<string, (number | null)[]>();
  for (const r of (data ?? []) as { job_id: string; impact_grade: number | null }[]) (by.get(r.job_id) ?? by.set(r.job_id, []).get(r.job_id)!).push(r.impact_grade === null ? null : Number(r.impact_grade));
  for (const [id, vals] of by) {
    const g = vals.filter((v): v is number => v !== null);
    out.set(id, { avg: g.length ? Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 10) / 10 : null, specs: vals.length, graded: g.length });
  }
  return out;
}

export type GradeRollup ={ avg: number | null; specs: number; graded: number };
const NONE: GradeRollup = { avg: null, specs: 0, graded: 0 };
type RollupRow = { supplier_id?: string; client_id?: string; avg_grade: number | null; specs: number; graded: number };
const rollup = (r: RollupRow): GradeRollup => ({ avg: r.avg_grade === null ? null : Number(r.avg_grade), specs: r.specs, graded: r.graded });

/** Average Impact Grade of the specs on a supplier's purchase orders. A vendor can only ask for their own company. */
export async function getSupplierGrade(supabase: Client, supplierId: string): Promise<GradeRollup> {
  const { data } = await supabase.rpc("impact_grade_by_supplier", { p_supplier: supplierId });
  const r = ((data ?? []) as RollupRow[])[0];
  return r ? rollup(r) : NONE;
}

/** Average Impact Grade of the specs on a client's jobs. A client user can only ask for their own client. */
export async function getClientGrade(supabase: Client, clientId: string): Promise<GradeRollup> {
  const { data } = await supabase.rpc("impact_grade_by_client", { p_client: clientId });
  const r = ((data ?? []) as RollupRow[])[0];
  return r ? rollup(r) : NONE;
}

/** For the client portal: one client (staff preview) or every client the signed-in user belongs to, combined (average weighted by graded specs). */
export async function getPortalClientGrade(supabase: Client, clientId: string | null): Promise<GradeRollup> {
  const { data } = await supabase.rpc("impact_grade_by_client", { p_client: clientId });
  const list = (data ?? []) as RollupRow[];
  const graded = list.reduce((a, r) => a + r.graded, 0);
  if (!list.length) return NONE;
  const sum = list.reduce((a, r) => a + (r.avg_grade === null ? 0 : Number(r.avg_grade) * r.graded), 0);
  return { avg: graded ? Math.round((sum / graded) * 10) / 10 : null, specs: list.reduce((a, r) => a + r.specs, 0), graded };
}

/** Every supplier's rolled-up grade, keyed by supplier id (staff only). */
export async function getSupplierGrades(supabase: Client): Promise<Map<string, GradeRollup>> {
  const { data } = await supabase.rpc("impact_grade_by_supplier", { p_supplier: null });
  return new Map(((data ?? []) as RollupRow[]).map((r) => [r.supplier_id as string, rollup(r)]));
}

/** Every client's rolled-up grade, keyed by client id (staff only). */
export async function getClientGrades(supabase: Client): Promise<Map<string, GradeRollup>> {
  const { data } = await supabase.rpc("impact_grade_by_client", { p_client: null });
  return new Map(((data ?? []) as RollupRow[]).map((r) => [r.client_id as string, rollup(r)]));
}
