import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Criterion, FullMethodology, Input, Methodology, Pillar } from "@/lib/scorecard";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Loads a methodology with its pillars and criteria: by status ("active" / "draft") or by id. */
export async function getMethodology(supabase: Client, which: { status: "active" | "draft" } | { id: string }): Promise<FullMethodology | null> {
  const q = supabase.from("scorecard_methodologies").select("*");
  const { data } = await ("id" in which ? q.eq("id", which.id) : q.eq("status", which.status)).maybeSingle();
  if (!data) return null;
  const m = data as Methodology;
  const [{ data: pillars }, { data: criteria }] = await Promise.all([
    supabase.from("scorecard_pillars").select("key, label, weight, description, sort").eq("methodology_id", m.id).order("sort"),
    supabase.from("scorecard_criteria").select("pillar_key, key, label, weight, kind, unit, bands, fallback_criterion, source, description, open_point, sort").eq("methodology_id", m.id).order("sort"),
  ]);
  return {
    ...m,
    preferred_threshold: Number(m.preferred_threshold),
    pillars: ((pillars ?? []) as Pillar[]).map((p) => ({ ...p, weight: Number(p.weight) })),
    criteria: ((criteria ?? []) as Criterion[]).map((c) => ({ ...c, weight: Number(c.weight) })),
  };
}

/** All scorecard inputs, grouped by supplier. */
export async function getInputsBySupplier(supabase: Client): Promise<Map<string, Input[]>> {
  const { data } = await supabase.from("scorecard_inputs").select("supplier_id, key, value_num, value_text");
  const out = new Map<string, Input[]>();
  for (const r of (data ?? []) as (Input & { supplier_id: string })[]) {
    const list = out.get(r.supplier_id) ?? [];
    list.push({ key: r.key, value_num: r.value_num === null ? null : Number(r.value_num), value_text: r.value_text });
    out.set(r.supplier_id, list);
  }
  return out;
}
