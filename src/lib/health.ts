import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { ModuleKey } from "@/modules/registry";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Standard health row every module Watchtower exposes (view watchtower_health_<module>). */
export type HealthRow = { module: string; metric: string; label: string; value: number; target: number; status: "ok" | "warn" | "bad" };

type Source = { view: string; metrics?: string[] };
// Which views (and which of their metrics) feed each module. Sourcing's view covers RFQs and Order Management too;
// Order Management also reads QA/QC, OTIF and speed to market from watchtower_health_qaqc.
const SOURCES: Partial<Record<ModuleKey, Source[]>> = {
  sourcing: [{ view: "watchtower_health_sourcing", metrics: ["triage_no_rfq_share", "savings_vs_target"] },
    { view: "watchtower_health_tech_sheets", metrics: ["tech_tbc_overdue"] }],
  rfq: [{ view: "watchtower_health_sourcing", metrics: ["rfqs_below_min_quotes", "high_value_awaiting_approval"] }],
  // Technical & packaging data sheets: orders held at the pre-shipment gate and the declared-vs-measured mismatch rate.
  orders: [{ view: "watchtower_health_sourcing", metrics: ["pos_awaiting_doa"] }, { view: "watchtower_health_qaqc" },
    { view: "watchtower_health_tech_sheets", metrics: ["tech_orders_blocked", "tech_mismatch_rate"] }],
  logistics: [{ view: "watchtower_health_logistics" }],
  execution: [{ view: "watchtower_health_execution" }],
  finance: [{ view: "watchtower_health_finance" }],
  crm: [{ view: "watchtower_health_crm" }],
};

export async function getHealth(supabase: Client, module: ModuleKey): Promise<HealthRow[]> {
  const srcs = SOURCES[module];
  if (!srcs) return [];
  const parts = await Promise.all(srcs.map(async (src) => {
    const { data, error } = await supabase.from(src.view).select("module, metric, label, value, target, status");
    if (error || !data) return [];
    const rows = (data as HealthRow[]).map((r) => ({ ...r, value: Number(r.value), target: Number(r.target) }));
    return src.metrics ? rows.filter((r) => src.metrics!.includes(r.metric)) : rows;
  }));
  return parts.flat();
}

export const hasHealth = (module: ModuleKey) => Boolean(SOURCES[module]);
