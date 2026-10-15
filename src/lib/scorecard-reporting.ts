// Balanced scorecard (reporting): types, labels, formatting and URL filter handling. No I/O.
// The numbers come from the SQL functions scorecard_report / client_portal_scorecard (migration 20261027000001).
// Not to be confused with src/lib/scorecard.ts, which is the SRM supplier scorecard.
import type { Tone } from "@/lib/srt";

export type Perspective = "plan" | "design" | "buy" | "manage";
export type KpiUnit = "percent" | "days" | "eur" | "score10" | "score100";
export type KpiStatus = "on_target" | "off_target" | "no_data" | "no_target" | "not_measured";
export type Route = "adopt" | "adapt" | "create" | "push" | "unrouted";

export type Kpi = {
  code: string; name: string; perspective: Perspective; unit: KpiUnit; direction: "higher" | "lower";
  definition: string | null; formula: string | null; measurement: string | null; source: string | null;
  measured: boolean; current: number | null; target: number | null; target_source: "client_market" | "client" | "market" | "default" | null;
  status: KpiStatus; n: number | null;
};
export type Breakdown = {
  by_route: { route: Route; value: number | null }[];
  by_month: { month: string; value: number | null }[];
  by_route_month: { route: Route; month: string; value: number | null }[];
  by_market: { market: string; name: string; value: number | null; target: number | null }[];
  by_spec_type: { spec_type: string; route: Route; value: number | null }[];
  by_business_unit: { business_unit: string; route: Route; value: number | null }[];
};
export type InfluenceMetrics = {
  lines: number; spend_eur: number; savings_pct: number | null; median_lead_days: number | null; median_spend_eur: number | null;
  perfect_pct: number | null; supplier_rating: number | null;
};
export type InfluenceFactor = {
  key: "urgent" | "governance" | "complexity"; label: string;
  groups: { key: string; label: string; metrics: InfluenceMetrics; by_route: { route: Route; metrics: InfluenceMetrics }[] }[];
};
export type CountryRow = {
  market: string; name: string; lines: number; kpi_delivery: number | null;
  savings: number | null; savings_target: number | null; rate_card: number | null; rate_card_target: number | null;
  otif: number | null; otif_target: number | null; quality: number | null; quality_target: number | null;
};
export type KpiDefinition = { code: string; name: string; definition: string | null; measurement: string | null; formula: string | null; default_target: number | null };
export type Callout = { rule: string; tone: "bad" | "warn" | "info" | "ok"; text: string };
export type Options = { business_units: string[]; brands: string[]; markets: { code: string; name: string }[]; months: { first: string | null; last: string | null } };

export type ScorecardReport = {
  filters: Record<string, unknown>;
  clients: number;
  totals: { lines: number; spend_eur: number; savings_eur: number; currency: "EUR"; by_route: { route: Route; label: string; spend_eur: number; savings_eur: number; lines: number }[] };
  kpis: Kpi[];
  breakdowns: Record<string, Breakdown>;
  influence: { factors: InfluenceFactor[]; total: InfluenceMetrics };
  country: { rows: CountryRow[]; definitions: KpiDefinition[] };
  callouts: Callout[];
  options?: Options;
};

export const PERSPECTIVES: { key: Perspective; label: string; icon: string; blurb: string }[] = [
  { key: "plan", label: "Plan better", icon: "event_note", blurb: "How work is planned: order size, urgency and lead time." },
  { key: "design", label: "Design better", icon: "draw", blurb: "What is designed: effectiveness, reuse of standard specs and sustainability." },
  { key: "buy", label: "Buy better", icon: "shopping_cart", blurb: "How it is bought: savings, quality, delivery and rate-card use." },
  { key: "manage", label: "Manage better", icon: "handyman", blurb: "How the relationship runs: client view, briefs, POs and innovation." },
];

export const VIEWS = [
  { key: "summary", label: "Summary", icon: "dashboard" },
  ...PERSPECTIVES.map((p) => ({ key: p.key, label: p.label, icon: p.icon })),
  { key: "influence", label: "Influence factors", icon: "hub" },
  { key: "kpis", label: "KPIs by country", icon: "public" },
] as const;
export type ViewKey = (typeof VIEWS)[number]["key"];

export const ROUTES: { key: Route; label: string; color: string }[] = [
  { key: "adopt", label: "Adopt", color: "#010062" },
  { key: "adapt", label: "Adapt", color: "#4896F7" },
  { key: "create", label: "Create", color: "#E07B39" },
  { key: "push", label: "Push", color: "#8E6CCB" },
];
export const routeLabel = (r: string) => ROUTES.find((x) => x.key === r)?.label ?? (r === "unrouted" ? "Not triaged" : r);
export const routeColor = (r: string) => ROUTES.find((x) => x.key === r)?.color ?? "#9CA3AF";

export const STATUS: Record<KpiStatus, { label: string; tone: Tone }> = {
  on_target: { label: "On target", tone: "ok" },
  off_target: { label: "Off target", tone: "bad" },
  no_data: { label: "No data yet", tone: "neutral" },
  no_target: { label: "No target set", tone: "info" },
  not_measured: { label: "Not yet measured", tone: "neutral" },
};

const num = (v: number, d = 1) => v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: 0 });

export function fmtEur(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return `€${num(n / 1e6, 2)}m`;
  if (Math.abs(n) >= 1e4) return `€${num(n / 1e3, 0)}k`;
  if (Math.abs(n) >= 1e3) return `€${num(n / 1e3, 1)}k`;
  return `€${num(n, 0)}`;
}

/** A KPI value in its unit. */
export function fmtKpi(unit: KpiUnit | string, v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  switch (unit) {
    case "percent": return `${num(n)}%`;
    case "days": return `${num(n, 0)} days`;
    case "eur": return fmtEur(n);
    case "score10": return `${num(n)}/10`;
    case "score100": return num(n, 0);
    default: return num(n);
  }
}
/** Short form for chart labels. */
export function fmtShort(unit: KpiUnit | string, v: number | null | undefined): string {
  if (v == null) return "—";
  if (unit === "days") return `${num(Number(v), 0)}d`;
  if (unit === "score10") return num(Number(v));
  return fmtKpi(unit, v);
}

export const TARGET_SOURCE: Record<string, string> = {
  client_market: "client target for this market", client: "client target", market: "market target", default: "standard target",
};

export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, (mo ?? 1) - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Filters in the URL: ?view=&kpi=&routes=adopt,create&bu=&market=&brand=&from=&to=&client=
// ---------------------------------------------------------------------------
export type ScorecardParams = {
  view?: string; kpi?: string; metric?: string; routes?: string; bu?: string; market?: string; brand?: string; from?: string; to?: string; client?: string;
};
export const PARAM_KEYS: (keyof ScorecardParams)[] = ["view", "kpi", "metric", "routes", "bu", "market", "brand", "from", "to", "client"];

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = (s?: string) => !!s && /^\d{4}-\d{2}$/.test(s);

/** Turn URL params into the jsonb filters the SQL functions take. Months (YYYY-MM) are accepted for from/to. */
export function toFilters(p: ScorecardParams): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const routes = (p.routes ?? "").split(",").map((r) => r.trim()).filter((r) => ["adopt", "adapt", "create", "push", "unrouted"].includes(r));
  if (routes.length) f.routes = routes;
  if (p.bu) f.business_unit = p.bu;
  if (p.market) f.market = p.market;
  if (p.brand) f.brand = p.brand;
  if (isDate(p.from)) f.from = p.from; else if (isMonth(p.from)) f.from = `${p.from}-01`;
  if (isDate(p.to)) f.to = p.to;
  else if (isMonth(p.to)) {
    const [y, m] = p.to!.split("-").map(Number);
    f.to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  return f;
}

export function viewOf(p: ScorecardParams): ViewKey {
  return (VIEWS.find((v) => v.key === p.view)?.key ?? "summary") as ViewKey;
}

/** Link to the same page with some params changed (null removes one). `keep` are fixed params (tab, preview). */
export function hrefWith(base: string, current: ScorecardParams, patch: Partial<Record<keyof ScorecardParams, string | null>>, keep: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
  for (const k of PARAM_KEYS) {
    const v = k in patch ? patch[k] : current[k];
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Toggle one route in the routes param. All four selected (or none) means no filter. */
export function toggleRoute(current: string | undefined, route: Route): string | null {
  const set = new Set((current ?? "").split(",").filter(Boolean));
  if (set.has(route)) set.delete(route); else set.add(route);
  const all = ROUTES.every((r) => set.has(r.key));
  return set.size === 0 || all ? null : ROUTES.map((r) => r.key).filter((r) => set.has(r)).join(",");
}

export function kpisOf(r: ScorecardReport | null, perspective: Perspective): Kpi[] {
  return (r?.kpis ?? []).filter((k) => k.perspective === perspective);
}

/** Tone of a value against a target for a KPI's direction (tables). */
export function vsTarget(value: number | null | undefined, target: number | null | undefined, direction: "higher" | "lower" = "higher"): "ok" | "bad" | undefined {
  if (value == null || target == null) return undefined;
  return (direction === "lower" ? value <= target : value >= target) ? "ok" : "bad";
}

export const INFLUENCE_METRICS: { key: keyof InfluenceMetrics; label: string; unit: KpiUnit }[] = [
  { key: "savings_pct", label: "Savings %", unit: "percent" },
  { key: "median_lead_days", label: "Median lead time", unit: "days" },
  { key: "median_spend_eur", label: "Median spend per spec", unit: "eur" },
  { key: "perfect_pct", label: "Perfect job %", unit: "percent" },
  { key: "supplier_rating", label: "Supplier rating", unit: "score100" },
];
