// Impact Grade engine: the "Impact Grade.xlsx" ImpactGrade sheet as pure TypeScript. No I/O, no imports.
//
//   Impact Grade (0-100) = Σ weight × sub-score ÷ Σ weight, over the sub-scores that have data
//   weights: standard, or Promo for promo/merch specs (a Promo weight of n/a drops the sub-score)
//   sub-scores (0-100): durability, reusability, repairability, recyclability, resource use, substances of concern,
//                       recycled content, and the PEF score scaled against the 95th percentile of our PEF results
//   coverage = weight with data ÷ applicable weight; below the minimum the grade is provisional
//   letter A-E from the grade letters (pef_grade_bands)
//
// The PEF score itself comes from src/lib/pef.ts (the Anthesis model); this engine only scales it.

export type IgRecord = { code: string | null; name: string; data: Record<string, unknown> };
export type IgLibraries = Record<string, IgRecord[] | undefined>;

export type IgComponent = { name: string; weightKg: number; recycledPercent?: number | null };
export type IgInput = {
  /** Spec type: 2d, 3d, promo_merch, custom_goods_services, design. */
  specType: string;
  components: IgComponent[];
  activationPeriod?: string | null;
  reusable?: boolean | null;
  modular?: boolean | null;
  easySeparation?: boolean | null;
  /** Finishing, decoration, coating or lamination applied ("None" or empty for none). */
  finishing?: string[] | null;
  optimalSize?: boolean | null;
  accreditation?: string | null;
  inks?: string | null;
  varnish?: string | null;
  /** "No", "Yes, Solar", "Yes, Power Grid", "Yes, Batteries". */
  electronics?: string | null;
  /** Only for textiles: OEKO-TEX certified. Leave null when there is no textile. */
  oekoTex?: boolean | null;
  /** PEF score (mPt) from the PEF model, for the same functional unit. */
  pefMpt?: number | null;
  /** Supplier Score (0-100) from the SRM scorecard (src/lib/impact-grade-supplier.ts). */
  supplierScore?: number | null;
  /** Evidence tier behind each sub-score, by sub-score code. Missing ones count as Assumed. */
  tiers?: Record<string, IgTier>;
};

/** Evidence tiers, weakest to strongest (System X). */
export const IG_TIERS = ["assumed", "estimated", "declared", "measured", "verified"] as const;
export type IgTier = (typeof IG_TIERS)[number];
export const TIER_LABEL: Record<IgTier, string> = { assumed: "Assumed", estimated: "Estimated", declared: "Declared", measured: "Measured", verified: "Verified" };

export type IgSubScore = {
  code: string; name: string; category: string; weight: number | null; score: number | null;
  /** How the score was reached (or what is missing). */
  why: string; status: string;
};
export type IgResult = {
  score: number | null; letter: { letter: string; label: string; confirmed: boolean } | null;
  coverage: number; confirmed: boolean; promo: boolean; subScores: IgSubScore[]; missing: string[];
  pef: { mpt: number | null; reference: number; score: number | null };
  /** 0-100: how much to trust the grade. Rises as inputs move from Assumed to Verified and as gaps are filled. */
  confidence: number;
  /** Indicative range the grade could land in, narrowing as confidence rises. */
  range: { low: number; high: number } | null;
  /** The tier each weighted sub-score was counted at. */
  tiers: Record<string, IgTier>;
};

const key = (v: unknown) => String(v ?? "").trim().toLowerCase();
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const none = (v: unknown) => ["", "none", "no", "0", "-", "n/a"].includes(key(v));
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function indexImpactGrade(libs: IgLibraries) {
  const byCode = (k: string) => new Map((libs[k] ?? []).map((r) => [key(r.code), r]));
  const levelScore = new Map((libs.ig_impact_levels ?? []).map((r) => [num(r.data.level), num(r.data.score)]));
  const params = byCode("ig_parameters");
  const p = (code: string, fallback: number) => num(params.get(code)?.data.value) ?? fallback;
  return {
    subscores: [...(libs.ig_subscores ?? [])].sort((a, b) => (num(a.data.seq) ?? 0) - (num(b.data.seq) ?? 0)),
    options: byCode("ig_option_scores"),
    substrates: byCode("ig_substrates"),
    eol: new Map((libs.pef_eol_materials ?? []).map((r) => [key(r.data.substrate_name), r])),
    levelScore: (lvl: number | null) => (lvl === null ? null : levelScore.get(lvl) ?? null),
    letters: (libs.pef_grade_bands ?? []).map((r) => ({ letter: String(r.data.letter ?? r.code), minScore: num(r.data.min_score) ?? 0, label: String(r.data.label ?? ""), confirmed: r.data.confirmed === true })),
    pefReference: p("pef_reference_mpt", 0.6),
    minCoverage: p("min_coverage", 80) / 100,
    promoTypes: String(params.get("promo_spec_types")?.data.text_value ?? "promo_merch").split(",").map(key).filter(Boolean),
    tierConfidence: {
      assumed: p("tier_confidence_assumed", 20), estimated: p("tier_confidence_estimated", 40), declared: p("tier_confidence_declared", 65),
      measured: p("tier_confidence_measured", 85), verified: p("tier_confidence_verified", 95),
    } as Record<IgTier, number>,
    rangeSwing: p("range_max_swing", 25),
    supplierCriteria: String(params.get("supplier_criteria")?.data.text_value ?? "csr_audit,ems_audit,fsc,sedex,diverse,renewable").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
export type IgIndex = ReturnType<typeof indexImpactGrade>;

/** Score of a listed option (inks, varnish, activation period ...) from its impact level. */
function optionScore(ix: IgIndex, kind: string, label: string | null | undefined): { score: number | null; why: string } {
  if (label === null || label === undefined || label === "") return { score: null, why: "not given" };
  const o = ix.options.get(key(`${kind}|${label}`));
  if (!o) return { score: null, why: `"${label}" is not in the ${kind.replace(/_/g, " ")} list` };
  const lvl = num(o.data.level);
  return { score: ix.levelScore(lvl), why: `${label}: impact level ${lvl}` };
}

export function computeImpactGrade(input: IgInput, libsOrIndex: IgLibraries | IgIndex): IgResult {
  const ix = "subscores" in libsOrIndex && Array.isArray((libsOrIndex as IgIndex).subscores) && "pefReference" in libsOrIndex
    ? (libsOrIndex as IgIndex) : indexImpactGrade(libsOrIndex as IgLibraries);
  const promo = ix.promoTypes.includes(key(input.specType));
  const comps = input.components.filter((c) => key(c.name) && (num(c.weightKg) ?? 0) > 0);
  const totalKg = comps.reduce((a, c) => a + (num(c.weightKg) ?? 0), 0);
  const sub = (c: IgComponent) => ix.substrates.get(key(c.name));
  const missing: string[] = [];

  const finishing = (input.finishing ?? []).filter((f) => !none(f));
  const categories = new Set(comps.map((c) => key(sub(c)?.data.category ?? ix.eol.get(key(c.name))?.data.eol_classification ?? c.name)));
  const multi = categories.size > 1;
  const activation = input.activationPeriod ? ix.options.get(key(`activation_period|${input.activationPeriod}`)) : undefined;
  const lifeDays = num(activation?.data.min_days);

  const scores: Record<string, { score: number | null; why: string }> = {
    DURABILITY: optionScore(ix, "activation_period", input.activationPeriod),
    REUSABILITY: input.reusable === null || input.reusable === undefined ? { score: null, why: "not answered" } : { score: input.reusable ? 100 : 0, why: input.reusable ? "designed for reuse" : "not designed for reuse" },
    REPAIRABILITY: input.modular === null || input.modular === undefined ? { score: null, why: "not answered" } : { score: input.modular ? 100 : 0, why: input.modular ? "modular, replaceable parts" : "not modular" },
    RECYCLABILITY: (() => {
      if (!comps.length) return { score: null, why: "no substrates" };
      if (finishing.length) return { score: 0, why: `finishing or decoration (${finishing.join(", ")}) makes it non-recyclable` };
      if (multi && input.easySeparation !== true) return { score: 0, why: "multi-material and does not separate easily" };
      const rec = comps.reduce((a, c) => a + (ix.eol.get(key(c.name))?.data.technically_recyclable === true ? (num(c.weightKg) ?? 0) : 0), 0);
      const unknown = comps.filter((c) => !ix.eol.get(key(c.name)));
      if (unknown.length === comps.length) return { score: null, why: "recyclability of these substrates is not mapped" };
      return { score: totalKg ? (rec / totalKg) * 100 : null, why: `${((rec / (totalKg || 1)) * 100).toFixed(0)}% of the weight is technically recyclable${multi ? " (separates easily)" : " (mono-material)"}` };
    })(),
    RESOURCE_USE: (() => {
      const plastic = comps.some((c) => sub(c)?.data.plastic === true);
      const items = [
        input.optimalSize === null || input.optimalSize === undefined ? null : input.optimalSize ? 100 : 0,
        comps.length ? (plastic ? 0 : 100) : null,
        input.accreditation === null || input.accreditation === undefined ? null : none(input.accreditation) ? 0 : 100,
      ];
      const a = avg(items);
      return { score: a, why: a === null ? "not answered" : `optimal size ${items[0] === null ? "?" : items[0] ? "yes" : "no"} · ${plastic ? "contains plastic" : "plastic free"} · ${none(input.accreditation) || !input.accreditation ? "no certification" : input.accreditation}` };
    })(),
    SUBSTANCES: (() => {
      const harmful = comps.filter((c) => sub(c)?.data.harmful === true).map((c) => c.name);
      const ink = optionScore(ix, "ink", input.inks);
      const varnish = optionScore(ix, "varnish", input.varnish);
      let elec: number | null = null;
      if (input.electronics !== null && input.electronics !== undefined) {
        if (none(input.electronics)) elec = 100;
        else if (lifeDays !== null && lifeDays < 90) elec = 0;
        else if (/solar|batter|dc/i.test(input.electronics)) elec = 50;
        else elec = 0;
      }
      const items = [comps.length ? (harmful.length ? 0 : 100) : null, ink.score, varnish.score, elec, input.oekoTex === null || input.oekoTex === undefined ? null : input.oekoTex ? 100 : 0];
      const a = avg(items);
      return { score: a, why: a === null ? "not answered" : [harmful.length ? `harmful: ${harmful.join(", ")}` : "no harmful substrates", input.inks ? ink.why : null, input.varnish ? varnish.why : null, elec !== null ? `electronics ${elec}` : null].filter(Boolean).join(" · ") };
    })(),
    RECYCLED_CONTENT: (() => {
      const known = comps.filter((c) => num(c.recycledPercent) !== null);
      if (!known.length) return { score: null, why: "recycled content not given" };
      const kg = known.reduce((a, c) => a + (num(c.weightKg) ?? 0), 0);
      const pct = known.reduce((a, c) => a + (num(c.weightKg) ?? 0) * (num(c.recycledPercent) ?? 0), 0) / (kg || 1);
      return { score: Math.min(100, Math.max(0, pct)), why: `${pct.toFixed(0)}% post-consumer recycled content by weight` };
    })(),
    SUPPLIER: (() => {
      const s = num(input.supplierScore);
      return s === null ? { score: null, why: "no supplier chosen yet, or the supplier has no sustainability data in SRM" }
        : { score: Math.max(0, Math.min(100, s)), why: "from the supplier's SRM scorecard (CSR, EMS, FSC, Sedex, diverse, renewable energy)" };
    })(),
    PEF: (() => {
      const mpt = num(input.pefMpt);
      if (mpt === null) return { score: null, why: "PEF score not calculated" };
      const s = Math.max(0, Math.min(100, 100 * (1 - mpt / ix.pefReference)));
      return { score: s, why: `PEF ${mpt.toPrecision(3)} mPt against the reference ${ix.pefReference.toPrecision(3)} mPt (95th percentile)` };
    })(),
  };

  const subScores: IgSubScore[] = ix.subscores.map((r) => {
    const code = String(r.code);
    const w = promo ? (r.data.weight_promo === undefined ? null : num(r.data.weight_promo)) : num(r.data.weight_standard);
    const s = scores[code] ?? { score: null, why: "work in progress" };
    return { code, name: r.name, category: String(r.data.category ?? ""), weight: w, score: s.score === null ? null : Math.round(s.score * 10) / 10, why: s.why, status: String(r.data.status ?? "live") };
  });
  let wsum = 0; let wapplicable = 0; let total = 0;
  for (const s of subScores) {
    if (!s.weight) continue;
    wapplicable += s.weight;
    if (s.score === null) { missing.push(`${s.name}: ${s.why}`); continue; }
    wsum += s.weight; total += s.weight * s.score;
  }
  const score = wsum ? Math.round((total / wsum) * 10) / 10 : null;
  const coverage = wapplicable ? wsum / wapplicable : 0;
  const sorted = [...ix.letters].sort((a, b) => b.minScore - a.minScore);
  const band = score === null ? null : sorted.find((b) => score >= b.minScore) ?? sorted[sorted.length - 1] ?? null;
  const pefScore = scores.PEF.score;

  // Confidence: each weighted sub-score earns the confidence of its evidence tier; a sub-score with no data earns 0.
  const tiers: Record<string, IgTier> = {};
  let conf = 0;
  for (const s of subScores) {
    const t = input.tiers?.[s.code] && IG_TIERS.includes(input.tiers[s.code]) ? input.tiers[s.code] : "assumed";
    tiers[s.code] = t;
    if (s.weight && s.score !== null) conf += s.weight * ix.tierConfidence[t];
  }
  const confidence = wapplicable ? Math.round(conf / wapplicable) : 0;
  const swing = ix.rangeSwing * (1 - confidence / 100);
  const range = score === null ? null : { low: Math.round(Math.max(0, score - swing) * 10) / 10, high: Math.round(Math.min(100, score + swing) * 10) / 10 };
  return {
    score, letter: band ? { letter: band.letter, label: band.label, confirmed: band.confirmed } : null,
    coverage, confirmed: coverage >= ix.minCoverage, promo, subScores, missing,
    pef: { mpt: num(input.pefMpt), reference: ix.pefReference, score: pefScore === null ? null : Math.round(pefScore * 10) / 10 },
    confidence, range, tiers,
  };
}

/** 95th percentile (linear interpolation, as Excel PERCENTILE.INC) of PEF scores, for the governed reference. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (p / 100) * (v.length - 1);
  const lo = Math.floor(i);
  return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
}
