"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type RefResult = { ok: boolean; message: string };

/**
 * Propose the PEF reference recalculated from our PEF results (95th percentile) as a new version of the parameter.
 * Maker-checker: it applies once a second person approves it in the library.
 */
export async function proposePefReference(): Promise<RefResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data: sug, error: e1 } = await supabase.rpc("ig_pef_reference_suggestion");
  if (e1) return { ok: false, message: e1.message };
  const s = sug as { reference_mpt: number | null; results: number; percentile: number; basis: string };
  if (s.reference_mpt === null || !s.results) return { ok: false, message: "No PEF results to calculate from yet." };
  const { data: rec } = await supabase.from("library_records").select("id, name, data, effective_from").eq("library_key", "ig_parameters").eq("code", "pef_reference_mpt").eq("status", "active").maybeSingle();
  if (!rec) return { ok: false, message: "The PEF reference parameter is missing." };
  const r = rec as { id: string; name: string; data: Record<string, unknown>; effective_from: string };
  const value = Math.round(Number(s.reference_mpt) * 1e6) / 1e6;
  if (Number(r.data.value) === value) return { ok: true, message: "The reference already matches our results." };
  const today = new Date().toISOString().slice(0, 10);
  const from = today > r.effective_from ? today : new Date(Date.parse(r.effective_from) + 86400000).toISOString().slice(0, 10);
  const { error } = await supabase.rpc("library_supersede", {
    p_id: r.id, p_name: r.name, p_effective_from: from,
    p_data: { ...r.data, value, note: `${s.percentile}th percentile of ${s.results} PEF scores (${s.basis.replace(/_/g, " ")}), proposed ${today}.` },
    p_note: `Recalculated from our PEF results: ${s.percentile}th percentile of ${s.results} scores.`,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/impact-grade", "layout");
  return { ok: true, message: `Proposed ${value} mPt. It applies once a second person approves it in Impact Grade parameters.` };
}
