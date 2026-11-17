// Conscious ordering (Sustainability): roll-ups, over-ordering flags and spend-based estimates.
// Pure logic, no I/O. The line-level reconciliation (ordered, delivered, installed, in stock, unaccounted) is done in
// SQL by conscious_ordering_lines(); this file only adds up those lines and applies the governed rules.

export type LineStatus = "untracked" | "in_progress" | "reconciled";

/** One order line (a spec on a purchase order), as returned by conscious_ordering_lines(). */
export interface OrderLine {
  po_id: string; po_number: string; po_date: string; job_id: string; job_number: string; client_id: string; client_name: string;
  brand: string; region: string; market: string; spec_id: string; spec_title: string; spec_type: string; currency: string;
  unit_cost: number | null; unit_cost_eur: number | null;
  ordered: number; delivered: number; install_planned: number; installed: number; open_installs: number;
  in_stock: number; aged_stock: number; last_count: string | null;
  status: LineStatus; surplus: number; unaccounted: number; wasted: number;
  co2e_kg_per_unit: number | null; co2e_basis: "spec" | "spend" | null;
}

/** Governed thresholds (Watchtower library conscious_ordering_rules). */
export interface Rules { target: number; minOrders: number; stockAgeMonths: number; allowance: number; defaultRate: number }
export const DEFAULT_RULES: Rules = { target: 85, minOrders: 3, stockAgeMonths: 12, allowance: 5, defaultRate: 15 };
const RULE_CODES: Record<string, keyof Rules> = {
  "COR-TARGET": "target", "COR-MIN-ORDERS": "minOrders", "COR-STOCK-AGE": "stockAgeMonths", "COR-ALLOWANCE": "allowance", "COR-DEFAULT-RATE": "defaultRate",
};
export function rulesFrom(records: { code: string | null; data: Record<string, unknown> }[]): Rules {
  const r = { ...DEFAULT_RULES };
  for (const x of records) {
    const k = x.code ? RULE_CODES[x.code] : undefined;
    const v = Number(x.data?.value);
    if (k && Number.isFinite(v)) r[k] = v;
  }
  return r;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pctOf = (part: number, whole: number) => (whole > 0 ? (100 * part) / whole : null);

export const SPEC_GROUP: Record<string, string> = {
  "2d": "Print", "3d": "Retail display", promo_merch: "Promo & merch", design: "Design", custom_goods_services: "Goods & services",
};
export const specGroup = (t: string) => SPEC_GROUP[t] ?? t;

/** Measured surplus rate (% of ordered units presumed wasted) per product type, from reconciled lines only. */
export function wasteRates(lines: OrderLine[], rules: Rules): { byType: Map<string, number>; overall: number; measured: boolean } {
  const acc = new Map<string, { ordered: number; wasted: number; lines: number }>();
  let ordered = 0, wasted = 0, count = 0;
  for (const l of lines) {
    if (l.status !== "reconciled") continue;
    const a = acc.get(l.spec_type) ?? { ordered: 0, wasted: 0, lines: 0 };
    a.ordered += n(l.ordered); a.wasted += n(l.wasted); a.lines += 1;
    acc.set(l.spec_type, a);
    ordered += n(l.ordered); wasted += n(l.wasted); count += 1;
  }
  const measured = count >= rules.minOrders && ordered > 0;
  const overall = measured ? (100 * wasted) / ordered : rules.defaultRate;
  const byType = new Map<string, number>();
  // A product type needs enough reconciled lines of its own; otherwise it borrows the overall rate.
  for (const [t, a] of acc) if (a.lines >= rules.minOrders && a.ordered > 0) byType.set(t, (100 * a.wasted) / a.ordered);
  return { byType, overall, measured };
}

export interface Totals {
  lines: number; ordered: number; delivered: number; spendEur: number;
  /** Lines with evidence (reconciled or in progress) and the units on them. */
  trackedLines: number; trackedUnits: number; coverage: number | null;
  reconciledLines: number; reconciledOrdered: number; installed: number; inStock: number; agedStock: number; unaccounted: number; wasted: number;
  utilisation: number | null; wastedEur: number; wastedKg: number;
  /** Untracked orders: surplus estimated from spend at the measured (or default) rate. */
  untrackedLines: number; untrackedUnits: number; untrackedSpendEur: number; estWastedEur: number; estWastedKg: number;
}

function blank(): Totals {
  return { lines: 0, ordered: 0, delivered: 0, spendEur: 0, trackedLines: 0, trackedUnits: 0, coverage: null, reconciledLines: 0, reconciledOrdered: 0,
    installed: 0, inStock: 0, agedStock: 0, unaccounted: 0, wasted: 0, utilisation: null, wastedEur: 0, wastedKg: 0,
    untrackedLines: 0, untrackedUnits: 0, untrackedSpendEur: 0, estWastedEur: 0, estWastedKg: 0 };
}

function add(t: Totals, l: OrderLine, rates: ReturnType<typeof wasteRates>) {
  const eur = n(l.unit_cost_eur), kg = n(l.co2e_kg_per_unit);
  t.lines += 1; t.ordered += n(l.ordered); t.delivered += n(l.delivered); t.spendEur += n(l.ordered) * eur;
  if (l.status === "untracked") {
    const rate = (rates.byType.get(l.spec_type) ?? rates.overall) / 100;
    t.untrackedLines += 1; t.untrackedUnits += n(l.ordered); t.untrackedSpendEur += n(l.ordered) * eur;
    t.estWastedEur += n(l.ordered) * eur * rate; t.estWastedKg += n(l.ordered) * kg * rate;
    return;
  }
  t.trackedLines += 1; t.trackedUnits += n(l.ordered);
  if (l.status !== "reconciled") return;
  t.reconciledLines += 1; t.reconciledOrdered += n(l.ordered); t.installed += n(l.installed);
  t.inStock += n(l.in_stock) - n(l.aged_stock); t.agedStock += n(l.aged_stock); t.unaccounted += n(l.unaccounted); t.wasted += n(l.wasted);
  t.wastedEur += n(l.wasted) * eur; t.wastedKg += n(l.wasted) * kg;
}

function finish(t: Totals): Totals {
  t.coverage = pctOf(t.trackedUnits, t.ordered);
  t.utilisation = pctOf(t.installed, t.reconciledOrdered);
  return t;
}

export function totals(lines: OrderLine[], rules: Rules): Totals {
  const rates = wasteRates(lines, rules);
  const t = blank();
  for (const l of lines) add(t, l, rates);
  return finish(t);
}

export type Verdict = "over_ordering" | "watch" | "on_target" | "not_enough" | "untracked";
export interface Group extends Totals {
  key: string; brand: string; market: string; region: string; verdict: Verdict;
  /** Share of the usual order this brand and market should order next time (installed share plus the allowance), 0-100. */
  suggestedShare: number | null; advice: string;
}

/**
 * Brand x market roll-up with a verdict:
 *   over_ordering = enough reconciled orders and utilisation under the target;
 *   watch         = under the target but not enough orders yet to call it a pattern;
 *   on_target     = enough reconciled orders, at or above the target;
 *   not_enough    = some evidence, at or above target, too few orders to judge;
 *   untracked     = no evidence at all (figures are spend-based estimates).
 */
export function groups(lines: OrderLine[], rules: Rules, by: "brand_market" | "brand" | "market" = "brand_market"): Group[] {
  const rates = wasteRates(lines, rules);
  const m = new Map<string, Group>();
  for (const l of lines) {
    const brand = by === "market" ? "All brands" : l.brand;
    const market = by === "brand" ? "All markets" : l.market;
    const key = `${brand}|${market}`;
    let g = m.get(key);
    if (!g) { g = { ...blank(), key, brand, market, region: by === "brand" ? "" : l.region, verdict: "untracked", suggestedShare: null, advice: "" }; m.set(key, g); }
    add(g, l, rates);
  }
  const out = [...m.values()].map((g) => {
    finish(g);
    const u = g.utilisation;
    const enough = g.reconciledLines >= rules.minOrders;
    g.verdict = u == null ? "untracked" : u < rules.target ? (enough ? "over_ordering" : "watch") : enough ? "on_target" : "not_enough";
    g.suggestedShare = u == null ? null : Math.min(100, Math.round(u + rules.allowance));
    g.advice = adviceFor(g, rules);
    return g;
  });
  const rank: Record<Verdict, number> = { over_ordering: 0, watch: 1, on_target: 2, not_enough: 3, untracked: 4 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.wastedEur + b.estWastedEur - (a.wastedEur + a.estWastedEur));
}

function adviceFor(g: Group, rules: Rules): string {
  const who = `${g.brand} in ${g.market}`;
  const orders = `${g.reconciledLines} reconciled order${g.reconciledLines === 1 ? "" : "s"}`;
  const u = g.utilisation == null ? "" : `${Math.round(g.utilisation)}%`;
  switch (g.verdict) {
    case "over_ordering":
      return `${who} installed ${u} of what it ordered across ${orders}. Order about ${100 - (g.suggestedShare ?? 100)}% less next time (${g.suggestedShare}% of the usual quantity, which keeps a ${rules.allowance}% allowance).`;
    case "watch":
      return `${who} installed ${u} on ${orders}. Under the ${rules.target}% target, but ${rules.minOrders} orders are needed to call it a pattern.`;
    case "on_target":
      return `${who} installed ${u} across ${orders}. On target.`;
    case "not_enough":
      return `${who} installed ${u} on ${orders}. Too few orders to judge yet.`;
    default:
      return `${who} has no install or stock evidence. Figures are estimated from spend until execution is tracked or stock is counted.`;
  }
}

export const VERDICT_META: Record<Verdict, { label: string; tone: "bad" | "warn" | "ok" | "neutral" | "info" }> = {
  over_ordering: { label: "Over-ordering", tone: "bad" },
  watch: { label: "Watch", tone: "warn" },
  on_target: { label: "On target", tone: "ok" },
  not_enough: { label: "Too few orders", tone: "neutral" },
  untracked: { label: "Not tracked", tone: "info" },
};
export const STATUS_META: Record<LineStatus, { label: string; tone: "ok" | "warn" | "info" }> = {
  reconciled: { label: "Reconciled", tone: "ok" },
  in_progress: { label: "In progress", tone: "warn" },
  untracked: { label: "Not tracked", tone: "info" },
};

export const int = (v: number) => Math.round(v).toLocaleString("en-GB");
export const eur = (v: number) => `€${Math.round(v).toLocaleString("en-GB")}`;
export const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v.toFixed(d)}%`);
/** kgCO2e, switching to tonnes above 1,000 kg. */
export const co2 = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} tCO2e` : `${Math.round(kg).toLocaleString("en-GB")} kgCO2e`);
