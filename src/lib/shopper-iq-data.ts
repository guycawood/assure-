// Shopper IQ reads (server side, RLS applies).
import type { createClient } from "@/lib/supabase/server";
import { whatWorked, type AssetRow, type EffectivenessRow } from "@/lib/shopper-iq";

type Client = Awaited<ReturnType<typeof createClient>>;

export async function getEffectiveness(supabase: Client): Promise<EffectivenessRow[]> {
  const { data } = await supabase.from("siq_effectiveness_v").select("*").order("period_start", { ascending: false }).limit(5000);
  return ((data as EffectivenessRow[]) ?? []).map((r) => ({
    ...r,
    spend: Number(r.spend) || 0,
    execution_score: r.execution_score == null ? null : Number(r.execution_score),
    uplift_pct: r.uplift_pct == null ? null : Number(r.uplift_pct),
  }));
}

export async function getAssets(supabase: Client): Promise<AssetRow[]> {
  const { data } = await supabase.from("siq_assets_v").select("*").order("created_at", { ascending: false }).limit(2000);
  return (data as AssetRow[]) ?? [];
}

/** The "what worked" insight for a brief (or ideation context). */
export async function getWhatWorked(supabase: Client, opts: { client?: string | null; brand?: string | null; market?: string | null }) {
  return whatWorked(await getEffectiveness(supabase), opts);
}
