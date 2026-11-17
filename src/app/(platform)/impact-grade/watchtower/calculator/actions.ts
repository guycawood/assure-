"use server";

import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPefIndex } from "@/lib/pef-data";
import { computePef, PEF_CATEGORIES, PEF_STAGES, type Impacts, type PefInput, type PefResult, type PefStage } from "@/lib/pef";

export type CalcResult =
  | { ok: true; result: PefResult; stageScoresMpt: Record<PefStage, number>; categories: { code: string; name: string; unit: string }[] }
  | { ok: false; message: string };

/** Run the PEF model against the current libraries. Read-only: nothing is stored. */
export async function runPef(input: PefInput): Promise<CalcResult> {
  await requireInternal();
  if (!input.shipFrom || !input.shipTo) return { ok: false, message: "Choose where it ships from and to." };
  if (!input.components.some((c) => c.name.trim() && c.weightKg > 0)) return { ok: false, message: "Add at least one substrate with a weight." };
  const supabase = await createClient();
  const { libs, index } = await getPefIndex(supabase);
  const result = computePef(input, index);
  const score = (v: Impacts) => index.categories.reduce((a, c) => (c.normalisation && c.weighting !== null && PEF_CATEGORIES.includes(c.code) ? a + (v[c.code] / c.normalisation) * c.weighting : a), 0) * 1000;
  const stageScoresMpt = Object.fromEntries(PEF_STAGES.map((s) => [s, score(result.stages[s])])) as Record<PefStage, number>;
  const categories = [...(libs.pef_impact_categories ?? [])].sort((a, b) => Number(a.data.sort) - Number(b.data.sort))
    .map((c) => ({ code: String(c.code), name: c.name, unit: String(c.data.unit ?? "") }));
  return { ok: true, result, stageScoresMpt, categories };
}
