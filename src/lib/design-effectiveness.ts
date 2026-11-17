// Shopper IQ design effectiveness: the "ShopperIQ Design Effectiveness Model v1" scorecard as pure TypeScript.
// No I/O and no imports. The database function siq_de_score (migration 20261105000003) applies the same rules when a
// scorecard is saved; this copy drives the live preview and is tested against the workbook and the database.
//
//   points        = weight × answer value (Yes 1, Partial 0.5, No 0); N/A and Unknown leave the denominator
//   design        = Σ design points ÷ Σ counted design weight   (split into Attract, Engage and Sell points)
//   sustainability= Σ sustainability points ÷ Σ counted sustainability weight; S11 = Impact Grade (0-100) ÷ 100
//   overall       = (1 − w) × design + w × sustainability   (design alone when nothing sustainability is counted)
//   band          = highest band whose lower bound the overall reaches
//   valid         = answered share of applicable weight ≥ the minimum, for design and for sustainability

export type DeAssetType = "key_visual" | "posm" | "gwp";
export const DE_ASSET_TYPES: { code: DeAssetType; name: string }[] = [
  { code: "key_visual", name: "Key Visual" }, { code: "posm", name: "POSM" }, { code: "gwp", name: "GWP & Premiums" },
];
export const DE_ANSWERS = ["Yes", "Partial", "No", "N/A", "Unknown"] as const;
export type DeAnswer = (typeof DE_ANSWERS)[number];

export type DeCriterion = {
  code: string; name: string; block: "design" | "sustainability"; pillar: string; weight: number;
  appliesTo: Record<DeAssetType, boolean>; input: "answer" | "impact_grade";
  whatAssessed?: string; highScore?: string; note?: string;
};
export type DeSettings = {
  sustainabilityWeight: number; minCoverage: number;
  answerValues: Record<string, number | null>;
  bands: { code: string; name: string; minScore: number; confirmed: boolean }[];
};
export type DeInput = { assetType: DeAssetType; impactGrade: number | null; answers: Record<string, { answer?: string; note?: string } | undefined> };

export type DeLine = { code: string; applies: boolean; value: number | null; applicableWeight: number; countedWeight: number; points: number };
export type DeResult = {
  lines: DeLine[];
  attract: number | null; engage: number | null; sell: number | null;
  pillarAttainment: Record<string, number | null>;
  design: number | null; sustainability: number | null; overall: number | null;
  band: { code: string; name: string; confirmed: boolean } | null;
  coverageDesign: number; coverageSustainability: number; valid: boolean;
  weights: { designCounted: number; designApplicable: number; sustCounted: number; sustApplicable: number };
};

type Rec = { code: string | null; name: string; data: Record<string, unknown> };

/** Criteria and settings from the active Shopper IQ library records. */
export function deFromLibraries(libs: Record<string, Rec[] | undefined>): { criteria: DeCriterion[]; settings: DeSettings } {
  const seq = (r: Rec) => Number(r.data.seq ?? 0);
  const criteria = [...(libs.siq_de_criteria ?? [])].sort((a, b) => seq(a) - seq(b)).map((r): DeCriterion => ({
    code: String(r.code), name: r.name, block: r.data.block === "sustainability" ? "sustainability" : "design", pillar: String(r.data.pillar ?? ""),
    weight: Number(r.data.weight ?? 0), input: r.data.input === "impact_grade" ? "impact_grade" : "answer",
    appliesTo: { key_visual: r.data.applies_key_visual === true, posm: r.data.applies_posm === true, gwp: r.data.applies_gwp === true },
    whatAssessed: r.data.what_assessed as string | undefined, highScore: r.data.high_score as string | undefined, note: r.data.note as string | undefined,
  }));
  const param = (code: string, fallback: number) => {
    const v = Number((libs.siq_de_parameters ?? []).find((r) => r.code === code)?.data.value);
    return Number.isFinite(v) ? v : fallback;
  };
  const answerValues: Record<string, number | null> = {};
  for (const r of libs.siq_de_answers ?? []) answerValues[String(r.code)] = r.data.counts === true && typeof r.data.value === "number" ? r.data.value : null;
  const bands = [...(libs.siq_de_bands ?? [])].map((r) => ({ code: String(r.code), name: r.name, minScore: Number(r.data.min_score ?? 0), confirmed: r.data.confirmed === true }));
  return { criteria, settings: { sustainabilityWeight: param("sustainability_weight", 0.25), minCoverage: param("min_coverage", 0.8), answerValues, bands } };
}

export function scoreDesign(input: DeInput, criteria: DeCriterion[], s: DeSettings): DeResult {
  const lines: DeLine[] = criteria.map((c) => {
    const applies = c.appliesTo[input.assetType] === true;
    let value: number | null = null;
    if (applies) {
      if (c.input === "impact_grade") value = typeof input.impactGrade === "number" && Number.isFinite(input.impactGrade) ? input.impactGrade / 100 : null;
      else {
        const a = input.answers[c.code]?.answer;
        const v = a !== undefined ? s.answerValues[a] : undefined;
        value = typeof v === "number" ? v : null;
      }
    }
    const applicableWeight = applies ? c.weight : 0;
    const countedWeight = value !== null ? c.weight : 0;
    return { code: c.code, applies, value, applicableWeight, countedWeight, points: value !== null ? c.weight * value : 0 };
  });
  const byCode = new Map(criteria.map((c) => [c.code, c]));
  const sumWhere = (f: (c: DeCriterion) => boolean, k: "applicableWeight" | "countedWeight" | "points") =>
    lines.reduce((a, l) => (f(byCode.get(l.code)!) ? a + l[k] : a), 0);
  const isDesign = (c: DeCriterion) => c.block === "design";
  const isSust = (c: DeCriterion) => c.block === "sustainability";
  const designCounted = sumWhere(isDesign, "countedWeight");
  const designApplicable = sumWhere(isDesign, "applicableWeight");
  const sustCounted = sumWhere(isSust, "countedWeight");
  const sustApplicable = sumWhere(isSust, "applicableWeight");
  const pillarPoints = (p: string) => sumWhere((c) => c.pillar === p, "points");
  const design = designCounted === 0 ? null : sumWhere(isDesign, "points") / designCounted;
  const sustainability = sustCounted === 0 ? null : sumWhere(isSust, "points") / sustCounted;
  const overall = design === null ? null : sustainability === null ? design : (1 - s.sustainabilityWeight) * design + s.sustainabilityWeight * sustainability;
  const pillarAttainment: Record<string, number | null> = {};
  for (const p of ["attract", "engage", "sell"]) {
    const counted = sumWhere((c) => c.pillar === p, "countedWeight");
    pillarAttainment[p] = counted === 0 ? null : pillarPoints(p) / counted;
  }
  const sortedBands = [...s.bands].sort((a, b) => b.minScore - a.minScore);
  const b = overall === null ? null : sortedBands.find((x) => overall >= x.minScore) ?? null;
  const coverageDesign = designApplicable === 0 ? 0 : designCounted / designApplicable;
  const coverageSustainability = sustApplicable === 0 ? 0 : sustCounted / sustApplicable;
  return {
    lines,
    attract: designCounted === 0 ? null : pillarPoints("attract") / designCounted,
    engage: designCounted === 0 ? null : pillarPoints("engage") / designCounted,
    sell: designCounted === 0 ? null : pillarPoints("sell") / designCounted,
    pillarAttainment, design, sustainability, overall,
    band: b ? { code: b.code, name: b.name, confirmed: b.confirmed } : null,
    coverageDesign, coverageSustainability,
    // Workbook rule: MIN(coverage design, coverage sustainability) ≥ minimum.
    valid: Math.min(coverageDesign, coverageSustainability) >= s.minCoverage,
    weights: { designCounted, designApplicable, sustCounted, sustApplicable },
  };
}
