import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { ModuleKey } from "@/modules/registry";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Standard health row every module Watchtower exposes (view watchtower_health_<module>). */
export type HealthRow = { module: string; metric: string; label: string; value: number; target: number; status: "ok" | "warn" | "bad" };

// Which view (and which of its metrics) feeds each module. Sourcing's view covers RFQ+ and Order Management+ too.
const SOURCES: Partial<Record<ModuleKey, { view: string; metrics?: string[] }>> = {
  sourcing: { view: "watchtower_health_sourcing", metrics: ["triage_no_rfq_share", "savings_vs_target"] },
  rfq: { view: "watchtower_health_sourcing", metrics: ["rfqs_below_min_quotes", "high_value_awaiting_approval"] },
  orders: { view: "watchtower_health_sourcing", metrics: ["pos_awaiting_doa"] },
  logistics: { view: "watchtower_health_logistics" },
  execution: { view: "watchtower_health_execution" },
  finance: { view: "watchtower_health_finance" },
};

export async function getHealth(supabase: Client, module: ModuleKey): Promise<HealthRow[]> {
  const src = SOURCES[module];
  if (!src) return [];
  const { data, error } = await supabase.from(src.view).select("module, metric, label, value, target, status");
  if (error || !data) return [];
  const rows = (data as HealthRow[]).map((r) => ({ ...r, value: Number(r.value), target: Number(r.target) }));
  return src.metrics ? rows.filter((r) => src.metrics!.includes(r.metric)) : rows;
}

export const hasHealth = (module: ModuleKey) => Boolean(SOURCES[module]);
