// Supplier scorecard engine. Pure functions: the same maths drives the scorecard, the PSL and the draft preview.
// Scale is 0-5 everywhere. Methodology lives in the database (scorecard_* tables) and is edited in the Assure+ Watchtower.

export type Band = { min?: number; above?: number; max?: number; below?: number; score: number };
export type OptionBand = { value: string; label: string; score: number | null };
export type CompositePart = { key: string; label: string; unit?: string; weight: number; bands: Band[] };

export type Methodology = {
  id: string;
  version: number;
  status: "draft" | "active" | "superseded" | "discarded";
  preferred_threshold: number;
  require_coc: boolean;
  missing_data: "redistribute" | "zero";
  notes: string | null;
  created_at: string;
  activated_at: string | null;
};
export type Pillar = { key: string; label: string; weight: number; description: string | null; sort: number };
export type Criterion = {
  pillar_key: string;
  key: string;
  label: string;
  weight: number;
  kind: "number" | "option" | "composite";
  unit: string | null;
  bands: Band[] | OptionBand[] | { parts: CompositePart[] };
  fallback_criterion: string | null;
  source: string | null;
  description: string | null;
  open_point: string | null;
  sort: number;
};
export type Input = { key: string; value_num: number | null; value_text: string | null };
export type FullMethodology = Methodology & { pillars: Pillar[]; criteria: Criterion[] };

export type CriterionResult = { key: string; score: number | null; display: string; note?: string };
export type PillarResult = { key: string; score: number | null; completeness: number };
export type SupplierScore = {
  overall: number | null;
  pillars: PillarResult[];
  criteria: CriterionResult[];
  completeness: number; // share of total weight that had data, 0-1
  preferred: boolean;
  blockedReason: string | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function matchBand(bands: Band[], v: number): number | null {
  for (const b of bands) {
    if (b.min !== undefined && !(v >= b.min)) continue;
    if (b.above !== undefined && !(v > b.above)) continue;
    if (b.max !== undefined && !(v <= b.max)) continue;
    if (b.below !== undefined && !(v < b.below)) continue;
    return b.score;
  }
  return null;
}

/** Human description of a band's condition, e.g. "≥ 96" or "over 98". */
export function bandLabel(b: Band, unit?: string | null): string {
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  const parts: string[] = [];
  if (b.min !== undefined) parts.push(`at least ${b.min}${u}`);
  if (b.above !== undefined) parts.push(`over ${b.above}${u}`);
  if (b.max !== undefined) parts.push(b.max === 0 && b.min === undefined ? `${b.max}${u}` : `up to ${b.max}${u}`);
  if (b.below !== undefined) parts.push(`under ${b.below}${u}`);
  return parts.length ? parts.join(" and ") : "anything else";
}

function scoreCriterion(c: Criterion, inputs: Map<string, Input>, resolved: Map<string, number | null>): CriterionResult {
  if (c.kind === "number") {
    const v = num(inputs.get(c.key)?.value_num);
    if (v === null) return { key: c.key, score: null, display: "No data" };
    return { key: c.key, score: matchBand(c.bands as Band[], v), display: `${v}${c.unit === "%" ? "%" : c.unit ? ` ${c.unit}` : ""}` };
  }
  if (c.kind === "option") {
    const v = inputs.get(c.key)?.value_text;
    if (!v) return { key: c.key, score: null, display: "No data" };
    const opt = (c.bands as OptionBand[]).find((o) => o.value === v);
    if (!opt) return { key: c.key, score: null, display: v, note: "Value not in the methodology" };
    if (opt.score === null && c.fallback_criterion) {
      const fb = resolved.get(c.fallback_criterion) ?? null;
      return { key: c.key, score: fb, display: opt.label, note: `Uses the ${c.fallback_criterion.replace("_", " ")} score` };
    }
    return { key: c.key, score: opt.score, display: opt.label };
  }
  // composite: weighted parts; parts without data are left out and the rest re-weighted.
  const parts = (c.bands as { parts: CompositePart[] }).parts;
  let got = 0, wsum = 0;
  const shown: string[] = [];
  for (const p of parts) {
    const v = num(inputs.get(p.key)?.value_num);
    if (v === null) continue;
    const s = matchBand(p.bands, v);
    if (s === null) continue;
    got += s * p.weight;
    wsum += p.weight;
    shown.push(`${p.label}: ${v}${p.unit === "%" ? "%" : p.unit ? ` ${p.unit}` : ""}`);
  }
  if (!wsum) return { key: c.key, score: null, display: "No data" };
  return { key: c.key, score: got / wsum, display: shown.join(" · ") };
}

export function scoreSupplier(m: FullMethodology, inputList: Input[], supplierActive: boolean): SupplierScore {
  const inputs = new Map(inputList.map((i) => [i.key, i]));
  const ordered = [...m.criteria].sort((a, b) => (a.fallback_criterion ? 1 : 0) - (b.fallback_criterion ? 1 : 0));
  const resolved = new Map<string, number | null>();
  const results = new Map<string, CriterionResult>();
  for (const c of ordered) {
    const r = scoreCriterion(c, inputs, resolved);
    resolved.set(c.key, r.score);
    results.set(c.key, r);
  }

  const pillars: PillarResult[] = m.pillars.map((p) => {
    const cs = m.criteria.filter((c) => c.pillar_key === p.key && c.weight > 0);
    const total = cs.reduce((a, c) => a + c.weight, 0);
    let got = 0, wsum = 0;
    for (const c of cs) {
      const s = results.get(c.key)?.score ?? null;
      if (s === null) continue;
      got += s * c.weight;
      wsum += c.weight;
    }
    const completeness = total ? wsum / total : 0;
    if (!wsum) return { key: p.key, score: m.missing_data === "zero" && total ? 0 : null, completeness };
    return { key: p.key, score: m.missing_data === "zero" ? got / total : got / wsum, completeness };
  });

  let got = 0, wsum = 0, dataWeight = 0, allWeight = 0;
  for (const p of m.pillars) {
    const r = pillars.find((x) => x.key === p.key)!;
    allWeight += p.weight;
    dataWeight += p.weight * r.completeness;
    if (r.score === null) continue;
    got += r.score * p.weight;
    wsum += p.weight;
  }
  const overall = wsum ? got / wsum : null;

  const coc = inputs.get("coc")?.value_text;
  let blockedReason: string | null = null;
  if (!supplierActive) blockedReason = "Supplier not active";
  else if (m.require_coc && coc !== "yes") blockedReason = "No signed Code of Conduct";
  const preferred = blockedReason === null && overall !== null && overall > Number(m.preferred_threshold);

  return {
    overall,
    pillars,
    criteria: m.criteria.map((c) => results.get(c.key)!),
    completeness: allWeight ? dataWeight / allWeight : 0,
    preferred,
    blockedReason,
  };
}

/** Problems that stop a draft being activated (mirrors scorecard_activate in SQL). */
export function weightProblems(m: Pick<FullMethodology, "pillars" | "criteria">): string[] {
  const out: string[] = [];
  const ps = m.pillars.reduce((a, p) => a + Number(p.weight), 0);
  if (Math.abs(ps - 100) > 0.001) out.push(`Pillar weights add up to ${ps}, not 100.`);
  for (const p of m.pillars) {
    const cs = m.criteria.filter((c) => c.pillar_key === p.key).reduce((a, c) => a + Number(c.weight), 0);
    if (Math.abs(cs - 100) > 0.001) out.push(`${p.label} criteria add up to ${cs}, not 100.`);
  }
  return out;
}

export const fmtScore = (s: number | null) => (s === null ? "–" : s.toFixed(2));
