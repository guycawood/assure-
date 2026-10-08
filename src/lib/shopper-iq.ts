// Shopper IQ pure helpers: aggregations over effectiveness rows and the "what worked" ranking. No I/O.

export type EffectivenessRow = {
  id: string; campaign_id: string; campaign_name: string; campaign_code: string; client: string | null; brands: string[];
  region: string; market: string; touchpoint_id: string; touchpoint_code: string | null; touchpoint_name: string;
  p2p_stage_id: string | null; p2p_stage_code: string | null; p2p_stage_name: string | null; channel: string | null;
  period_start: string | null; period_end: string | null; spend: number; currency: string; units: number | null;
  execution_score: number | null; uplift_pct: number | null; uplift_source: string; notes: string | null; created_at: string;
};

export type AssetRow = {
  id: string; asset_code: string; title: string; asset_type: string; campaign_id: string | null; campaign_name: string | null;
  client: string | null; brief_id: string | null; region: string | null; market: string | null; brand: string | null;
  touchpoint_id: string | null; touchpoint_name: string | null; p2p_stage_name: string | null; file_name: string | null;
  file_url: string | null; metadata: Record<string, unknown>; metadata_source: string; created_at: string;
};

export const ASSET_TYPES = [
  { value: "executional_image", label: "Executional image" }, { value: "render_3d", label: "3D render" },
  { value: "production_art", label: "Production-ready art" }, { value: "playbook", label: "Playbook / toolkit" },
];
export const UPLIFT_SOURCES: Record<string, string> = {
  not_measured: "Not measured", client_reported: "Client reported", retailer_data: "Retailer data", panel_data: "Panel data",
};
export const METADATA_SOURCE: Record<string, string> = { manual: "Entered by hand", job: "From the campaign / job", ai_extracted: "AI-extracted (check it)" };

export type Group = { key: string; label: string; spend: number; rows: number; avgScore: number | null; avgUplift: number | null; measured: number };

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Spend, average execution score and average measured uplift per group. Uplift only averages rows with a named source. */
export function groupBy(rows: EffectivenessRow[], keyOf: (r: EffectivenessRow) => string | null, labelOf?: (r: EffectivenessRow) => string): Group[] {
  const m = new Map<string, { label: string; spend: number; rows: number; scores: number[]; uplifts: number[] }>();
  for (const r of rows) {
    const k = keyOf(r) ?? "—";
    const g = m.get(k) ?? { label: labelOf ? labelOf(r) : k, spend: 0, rows: 0, scores: [], uplifts: [] };
    g.spend += Number(r.spend) || 0;
    g.rows += 1;
    const s = num(r.execution_score);
    if (s != null) g.scores.push(s);
    const u = num(r.uplift_pct);
    if (u != null && r.uplift_source !== "not_measured") g.uplifts.push(u);
    m.set(k, g);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...m.entries()]
    .map(([key, g]) => ({ key, label: g.label, spend: g.spend, rows: g.rows, avgScore: avg(g.scores), avgUplift: avg(g.uplifts), measured: g.uplifts.length }))
    .sort((a, b) => b.spend - a.spend);
}

export const totalSpend = (rows: EffectivenessRow[]) => rows.reduce((a, r) => a + (Number(r.spend) || 0), 0);
export function avgScore(rows: EffectivenessRow[]) {
  const s = rows.map((r) => num(r.execution_score)).filter((x): x is number => x != null);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

export type WhatWorked = { touchpoint: string; p2pStage: string | null; avgScore: number; avgUplift: number | null; measured: number; spend: number; examples: string[]; scope: "brand" | "client" | "all" };

/**
 * "What worked": touchpoints ranked by execution score (then measured uplift), narrowed to the brand, else the client, else everything.
 * Needs at least two rows in the narrowest scope that has data.
 */
export function whatWorked(rows: EffectivenessRow[], opts: { client?: string | null; brand?: string | null; market?: string | null }, limit = 4): WhatWorked[] {
  const brandRows = opts.brand ? rows.filter((r) => (r.brands ?? []).includes(opts.brand!)) : [];
  const clientRows = opts.client ? rows.filter((r) => r.client === opts.client) : [];
  const [scope, pool]: ["brand" | "client" | "all", EffectivenessRow[]] =
    brandRows.length >= 2 ? ["brand", brandRows] : clientRows.length >= 2 ? ["client", clientRows] : ["all", rows];
  return groupBy(pool, (r) => r.touchpoint_id, (r) => r.touchpoint_name)
    .filter((g) => g.avgScore != null)
    .sort((a, b) => (b.avgScore! - a.avgScore!) || ((b.avgUplift ?? -99) - (a.avgUplift ?? -99)))
    .slice(0, limit)
    .map((g) => {
      const these = pool.filter((r) => r.touchpoint_id === g.key);
      const stages = groupBy(these, (r) => r.p2p_stage_name);
      return {
        touchpoint: g.label, p2pStage: stages[0]?.key === "—" ? null : stages[0]?.key ?? null, avgScore: g.avgScore!, avgUplift: g.avgUplift,
        measured: g.measured, spend: g.spend, scope,
        examples: [...new Set(these.map((r) => `${r.campaign_name} (${r.market})`))].slice(0, 3),
      };
    });
}

export const fmtMoney = (n: number, cur = "EUR") => `${cur} ${Math.round(n).toLocaleString("en-GB")}`;
export const fmtPct = (n: number | null, digits = 1) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`);
