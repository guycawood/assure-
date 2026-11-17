"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { gradeSpec, loadGradeShared, type GradeShared } from "@/lib/impact-grade-spec";
import { OVERRIDE_FIELDS, type Overrides } from "@/lib/impact-grade-fields";
import { IG_TIERS, type IgTier } from "@/lib/impact-grade";

export type GradeActionResult = { ok?: boolean; message?: string; error?: string };

type Client = Awaited<ReturnType<typeof createClient>>;

async function saveSpec(supabase: Client, specId: string, overrides: Overrides | undefined, action: "calculate" | "edit", reason: string | null, changed?: string[], shared?: GradeShared) {
  const g = await gradeSpec(supabase, specId, overrides, shared);
  if (!g) return { error: "Spec not found" };
  const { data: spec } = await supabase.from("job_specs").select("job_id, brief_id").eq("id", specId).maybeSingle();
  const s = spec as { job_id: string; brief_id: string | null } | null;
  const { error } = await supabase.rpc("impact_grade_save", {
    p_kind: "spec", p_subject: specId, p_job: s?.job_id ?? null, p_brief: s?.brief_id ?? null, p_supplier: g.supplierId, p_stage: g.stage,
    p: { ...g.payload, changed }, p_action: action, p_reason: reason,
  });
  if (error) return { error: error.message };
  return { g };
}

function refresh(specId: string, jobId?: string | null) {
  revalidatePath("/impact-grade", "layout");
  revalidatePath(`/sourcing/specs/${specId}`);
  if (jobId) revalidatePath(`/sourcing/jobs/${jobId}`);
}

/** Calculate (or recalculate) one spec's grade from its data, its supplier's SRM scorecard and the inputs already recorded. */
export async function calculateSpecGrade(_: GradeActionResult, fd: FormData): Promise<GradeActionResult> {
  await requireInternal();
  const specId = String(fd.get("spec_id"));
  const supabase = await createClient();
  const r = await saveSpec(supabase, specId, undefined, "calculate", null);
  if ("error" in r) return { error: r.error };
  refresh(specId);
  const sc = r.g.result.score;
  return { ok: true, message: sc === null ? "Not enough data for a grade yet: see what is missing below." : `Impact Grade ${r.g.result.letter?.letter} (${Math.round(sc)}), ${r.g.result.confidence}% confident.` };
}

/** Calculate every spec that has no record yet, or all of them (the roll-up page). */
export async function calculateAllGrades(_: GradeActionResult, fd: FormData): Promise<GradeActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const onlyMissing = String(fd.get("scope")) !== "all";
  const jobId = String(fd.get("job_id") ?? "").trim(); // set on a job's own page: only that job's specs
  const specQuery = supabase.from("job_specs").select("id").limit(1000);
  const { data: specs } = await (jobId ? specQuery.eq("job_id", jobId) : specQuery);
  const ids = ((specs ?? []) as { id: string }[]).map((x) => x.id);
  let have = new Set<string>();
  if (onlyMissing && ids.length) {
    const { data: recs } = await supabase.from("impact_grade_records").select("subject_id").eq("subject_kind", "spec");
    have = new Set(((recs ?? []) as { subject_id: string }[]).map((x) => x.subject_id));
  }
  let done = 0; let failed = 0;
  const todo = ids.filter((id) => !have.has(id));
  const shared = await loadGradeShared(supabase);
  for (let i = 0; i < todo.length; i += 8) {
    const res = await Promise.all(todo.slice(i, i + 8).map((id) => saveSpec(supabase, id, undefined, "calculate", null, undefined, shared)));
    for (const r of res) { if ("error" in r) failed++; else done++; }
  }
  revalidatePath("/impact-grade", "layout");
  revalidatePath("/sourcing/jobs", "layout");
  return { ok: failed === 0, message: `${done} spec${done === 1 ? "" : "s"} calculated${failed ? `, ${failed} failed` : ""}.` };
}

/** A person enters or corrects inputs on a record. Each carries its evidence tier; a reason is required. */
export async function saveGradeInputs(_: GradeActionResult, fd: FormData): Promise<GradeActionResult> {
  await requireInternal();
  const specId = String(fd.get("spec_id"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Say why you are changing these inputs." };
  const supabase = await createClient();
  const { data: rec } = await supabase.from("impact_grade_records").select("inputs").eq("subject_kind", "spec").eq("subject_id", specId).maybeSingle();
  const overrides: Overrides = { ...((rec as { inputs?: { overrides?: Overrides } } | null)?.inputs?.overrides ?? {}) };
  const changed: string[] = [];
  for (const f of OVERRIDE_FIELDS) {
    const raw = fd.get(`v_${f.key}`);
    if (raw === null) continue;
    const v = String(raw);
    const tierRaw = String(fd.get(`t_${f.key}`) ?? "declared") as IgTier;
    const tier = IG_TIERS.includes(tierRaw) ? tierRaw : "declared";
    const prev = overrides[f.key];
    if (v === "") { if (prev) { delete overrides[f.key]; changed.push(f.key); } continue; }
    const value = f.kind === "number" ? Number(v) : f.kind === "bool" ? v === "yes" : v;
    if (f.kind === "number" && !Number.isFinite(value as number)) return { error: `${f.label}: enter a number.` };
    if (!prev || prev.value !== value || prev.tier !== tier) { overrides[f.key] = { value, tier }; changed.push(f.key); }
  }
  if (!changed.length) return { error: "Nothing changed." };
  const r = await saveSpec(supabase, specId, overrides, "edit", reason, changed);
  if ("error" in r) return { error: r.error };
  refresh(specId);
  return { ok: true, message: `Saved. The grade is now ${r.g.result.score === null ? "not calculable" : `${r.g.result.letter?.letter} (${Math.round(r.g.result.score)})`} at ${r.g.result.confidence}% confidence. It needs a review by someone else.` };
}

/** Review decision on a record (a different person from whoever last changed it). */
export async function reviewGrade(_: GradeActionResult, fd: FormData): Promise<GradeActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const status = String(fd.get("status"));
  const { error } = await supabase.rpc("impact_grade_review", { p_id: String(fd.get("id")), p_status: status, p_note: String(fd.get("note") ?? "") || null });
  if (error) return { error: error.message };
  revalidatePath("/impact-grade", "layout");
  return { ok: true, message: status === "reviewed" ? "Marked as reviewed." : status === "disputed" ? "Flagged as disputed." : "Review cleared." };
}

