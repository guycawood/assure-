import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { deFromLibraries, type DeCriterion, type DeSettings } from "@/lib/design-effectiveness";

type Client = Awaited<ReturnType<typeof createClient>>;
export type DeRecord = { code: string | null; name: string; data: Record<string, unknown> };

/** The design effectiveness model from the active Shopper IQ libraries (small: no paging needed). */
export async function getDesignModel(supabase: Client): Promise<{ libs: Record<string, DeRecord[]>; criteria: DeCriterion[]; settings: DeSettings }> {
  const keys = ["siq_de_criteria", "siq_de_parameters", "siq_de_answers", "siq_de_bands", "siq_de_asset_types", "siq_de_open_items", "siq_de_examples"];
  const { data } = await supabase.from("library_records").select("library_key, code, name, data").in("library_key", keys).eq("status", "active").limit(5000);
  const libs: Record<string, DeRecord[]> = {};
  for (const r of (data ?? []) as (DeRecord & { library_key: string })[]) (libs[r.library_key] ??= []).push({ code: r.code, name: r.name, data: r.data });
  return { libs, ...deFromLibraries(libs) };
}
