import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { computeImpactGrade, indexImpactGrade, type IgComponent, type IgInput, type IgResult, type IgTier } from "@/lib/impact-grade";
import { applyOverrides, type Overrides } from "@/lib/impact-grade-fields";
import { computePef, type PefInput, type PefResult } from "@/lib/pef";
import { getPefIndex } from "@/lib/pef-data";
import { getMethodology, getInputsBySupplier } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { supplierSustainabilityScore, type SupplierGradeScore } from "@/lib/impact-grade-supplier";
import { getCarbonIntensity } from "@/lib/impact-grade-data";
import type { RecordView } from "@/components/impact-grade/grade-record";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * An Impact Grade record is worked out from what the platform already knows about the spec (components, weights,
 * supplier, SRM scorecard, markets) plus anything a person has entered or corrected on the record (overrides, each with
 * its evidence tier). Nothing is ever hidden: every sub-score says why, and every input says where it came from.
 */
export type GradePayload = {
  score: number | null; letter: string | null; coverage: number; confidence: number; range_low: number | null; range_high: number | null;
  pef_mpt: number | null; supplier_score: number | null;
  inputs: Record<string, unknown>; tiers: Record<string, IgTier>; sub_scores: IgResult["subScores"]; warnings: string[];
  pef_result?: unknown; pef_inputs?: unknown; pef_climate?: number | null; changed?: string[];
};

export type SpecGrade = {
  payload: GradePayload; result: IgResult; supplier: SupplierGradeScore | null; supplierId: string | null; supplierName: string | null;
  stage: "ideation" | "spec" | "sourcing"; pef: PefResult | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const key = (v: unknown) => String(v ?? "").trim().toLowerCase();

function payloadFrom(result: IgResult, extra: { inputs: Record<string, unknown>; supplierScore: number | null; warnings: string[]; pef?: PefResult | null; pefInputs?: PefInput | null }): GradePayload {
  return {
    score: result.score, letter: result.letter?.letter ?? null, coverage: Math.round(result.coverage * 1000) / 10, confidence: result.confidence,
    range_low: result.range?.low ?? null, range_high: result.range?.high ?? null, pef_mpt: result.pef.mpt, supplier_score: extra.supplierScore,
    inputs: extra.inputs, tiers: result.tiers, sub_scores: result.subScores, warnings: extra.warnings,
    ...(extra.pef ? { pef_result: { stages: extra.pef.stages, singleScoreMpt: extra.pef.singleScoreMpt, singleScorePt: extra.pef.singleScorePt, warnings: extra.pef.warnings }, pef_inputs: extra.pefInputs, pef_climate: extra.pef.total.GWP ?? null } : {}),
  };
}

/** Country code (ISO alpha-2) from a market name or code, using the governed countries library. */
function countryCode(countries: { code: string; name: string }[], market: string | null | undefined): string | null {
  const m = key(market);
  if (!m) return null;
  const hit = countries.find((c) => key(c.code) === m || key(c.name) === m) ?? countries.find((c) => m.includes(key(c.name)) || (key(c.name).length > 3 && key(c.name).includes(m)));
  return hit?.code ?? null;
}

/** The recorded inputs (a person's edits) of an existing record, if there is one. */
export async function getRecord(supabase: Client, kind: "spec" | "concept", subjectId: string) {
  const { data } = await supabase.from("impact_grade_records").select("*").eq("subject_kind", kind).eq("subject_id", subjectId).maybeSingle();
  return data as GradeRecord | null;
}

export type GradeRecord = {
  id: string; subject_kind: "spec" | "concept"; subject_id: string; job_id: string | null; brief_id: string | null; supplier_id: string | null; stage: string;
  score: number | null; letter: string | null; coverage: number | null; confidence: number | null; range_low: number | null; range_high: number | null;
  pef_mpt: number | null; supplier_score: number | null; inputs: { overrides?: Overrides; basis?: Record<string, unknown> } & Record<string, unknown>;
  tiers: Record<string, IgTier>; sub_scores: IgResult["subScores"]; warnings: string[];
  review_status: "unreviewed" | "reviewed" | "disputed"; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null;
  updated_by: string | null; updated_at: string;
};

/** Work out a spec's grade from its data, its supplier's SRM scorecard and any recorded overrides. Nothing is saved. */
/** Scorecard data shared across a batch, so a bulk run loads it once. */
export type GradeShared = { methodology: Awaited<ReturnType<typeof getMethodology>>; inputsBy: Awaited<ReturnType<typeof getInputsBySupplier>> };
export async function loadGradeShared(supabase: Client): Promise<GradeShared> {
  const [methodology, inputsBy] = await Promise.all([getMethodology(supabase, { status: "active" }), getInputsBySupplier(supabase)]);
  return { methodology, inputsBy };
}

export async function gradeSpec(supabase: Client, specId: string, overridesIn?: Overrides, shared?: GradeShared): Promise<SpecGrade | null> {
  const { data: spec } = await supabase.from("job_specs").select("id, job_id, spec_type, substrate_id, unit_weight_grams, weight_basis, market, brief_id, spec_data").eq("id", specId).maybeSingle();
  if (!spec) return null;
  const s = spec as { id: string; job_id: string; spec_type: string; substrate_id: string | null; unit_weight_grams: number | null; weight_basis: string | null; market: string; brief_id: string | null };
  const existing = await getRecord(supabase, "spec", specId);
  const overrides = overridesIn ?? existing?.inputs?.overrides ?? {};

  const [{ data: comps }, { index, libs }, ci] = await Promise.all([
    supabase.from("spec_components").select("component_name, substrate_id, is_packaging, quantity_per_unit, derived_weight_grams, direct_weight_grams").eq("spec_id", specId).order("sort"),
    getPefIndex(supabase),
    getCarbonIntensity(supabase, { specIds: [specId] }),
  ]);
  const rows = (comps ?? []) as { component_name: string; substrate_id: string | null; is_packaging: boolean; quantity_per_unit: number; derived_weight_grams: number | null; direct_weight_grams: number | null }[];
  const ids = [...new Set([s.substrate_id, ...rows.map((r) => r.substrate_id)].filter((x): x is string => !!x))];
  const { data: subs } = ids.length ? await supabase.from("library_records").select("id, name, data").in("id", ids) : { data: [] };
  const subMap = new Map(((subs ?? []) as { id: string; name: string; data: Record<string, unknown> }[]).map((r) => [r.id, r]));

  const warnings: string[] = [];
  const components: IgComponent[] = [];
  const addComp = (name: string, grams: number | null, rec: Record<string, unknown> | undefined) => {
    if (!grams || grams <= 0) { warnings.push(`${name}: no weight on the spec yet`); return; }
    components.push({ name, weightKg: grams / 1000, recycledPercent: num(rec?.recycled_content_percent) });
  };
  for (const r of rows) {
    const sub = r.substrate_id ? subMap.get(r.substrate_id) : undefined;
    addComp(sub?.name ?? r.component_name, (r.direct_weight_grams ?? r.derived_weight_grams ?? 0) * (num(r.quantity_per_unit) ?? 1), sub?.data);
  }
  if (!components.length && s.substrate_id && subMap.get(s.substrate_id)) {
    const sub = subMap.get(s.substrate_id)!;
    addComp(sub.name, num(s.unit_weight_grams), sub.data);
  }

  // Supplier: the supplier on the spec's estimate (approved first), scored from the SRM scorecard.
  const supplierId = ci[0]?.supplier_id ?? existing?.supplier_id ?? null;
  let supplier: SupplierGradeScore | null = null;
  let supplierName: string | null = null;
  let supplierMarket: string | null = null;
  let renewable = false;
  if (supplierId) {
    const [m, inputsBy, { data: sup }] = await Promise.all([
      Promise.resolve(shared ? shared.methodology : null).then((x) => x ?? getMethodology(supabase, { status: "active" })), Promise.resolve(shared?.inputsBy).then((x) => x ?? getInputsBySupplier(supabase)),
      supabase.from("suppliers").select("name, market").eq("id", supplierId).maybeSingle(),
    ]);
    supplierName = (sup as { name: string } | null)?.name ?? null;
    supplierMarket = (sup as { market: string | null } | null)?.market ?? null;
    const inputs = inputsBy.get(supplierId) ?? [];
    renewable = inputs.find((i) => i.key === "renewable")?.value_text === "full";
    const igIx = indexImpactGrade(libs);
    if (m) supplier = supplierSustainabilityScore(m, scoreSupplier(m, inputs, true), igIx.supplierCriteria);
  }

  // Tiers the spec itself supports.
  const weightTier: IgTier = s.weight_basis === "supplier_confirmed" ? "measured" : s.weight_basis === "calculated_from_material" ? "estimated" : s.weight_basis === "estimated" ? "estimated" : "declared";
  const baseTiers: Record<string, IgTier> = {
    RECYCLABILITY: weightTier, RESOURCE_USE: "assumed", SUBSTANCES: weightTier, RECYCLED_CONTENT: components.some((c) => c.recycledPercent != null) ? "declared" : "assumed",
    PEF: weightTier === "measured" ? "declared" : "estimated", SUPPLIER: "verified",
  };
  const base: IgInput = { specType: s.spec_type, components, supplierScore: supplier?.score ?? null };
  const { input, tiers } = applyOverrides(base, baseTiers, overrides);

  // PEF score for the same spec, when both countries and every substrate are known.
  let pef: PefResult | null = null;
  let pefInput: PefInput | null = null;
  const countries = (libs.pef_countries ?? []).map((r) => ({ code: String(r.code), name: r.name }));
  const shipFrom = countryCode(countries, supplierMarket);
  const shipTo = countryCode(countries, s.market);
  if (components.length && shipFrom && shipTo) {
    pefInput = {
      shipFrom, shipTo, factoryRenewable: renewable, supplierType: "Manufacturer",
      components: components.map((c) => ({ name: c.name, weightKg: c.weightKg, recycledPercent: c.recycledPercent ?? null, atLeastMinSize: true })),
      easySeparation: input.easySeparation ?? undefined, usagePeriod: input.activationPeriod ?? null,
    };
    pef = computePef(pefInput, index);
    input.pefMpt = pef.singleScoreMpt;
    if (pef.warnings.length) warnings.push(...pef.warnings.map((w) => `PEF: ${w}`));
  } else if (components.length) {
    warnings.push(`PEF not calculated: ${!supplierId ? "no supplier on the spec's estimate yet" : !shipFrom ? `no country found for the supplier's market${supplierMarket ? ` (${supplierMarket})` : ""}` : `no country found for the spec's market (${s.market})`}`);
  }
  if (!supplierId) warnings.push("Supplier Score: no supplier chosen yet");
  else if (supplier && !supplier.parts.length) warnings.push("Supplier Score: the supplier has no sustainability data in SRM");
  else if (supplier?.missing.length) warnings.push(`Supplier Score: SRM has no data for ${supplier.missing.join(", ")}`);

  const result = computeImpactGrade({ ...input, tiers }, index_ig(libs));
  const stage = supplierId ? "sourcing" : "spec";
  return {
    payload: payloadFrom(result, { inputs: { overrides, basis: { components, shipFrom, shipTo, weightTier } }, supplierScore: supplier?.score ?? null, warnings, pef, pefInputs: pefInput }),
    result, supplier, supplierId, supplierName, stage, pef,
  };
}

const index_ig = (libs: Parameters<typeof indexImpactGrade>[0]) => indexImpactGrade(libs);

/** The grade of an ideation concept: provisional, from the concept's substrate, at the Assumed tier. */
export async function gradeConcept(supabase: Client, concept: {
  suggested_spec_type?: string | null; suggested_substrate_name?: string | null; suggested_length?: number | null; suggested_width?: number | null;
  suggested_unit?: string | null; substrate_specs?: { recycled_content_percent?: number | null; grammage_gsm?: number | null; fsc_certified?: boolean } | null;
}, overridesIn: Overrides = {}, libsIn?: Parameters<typeof indexImpactGrade>[0]): Promise<{ payload: GradePayload; result: IgResult }> {
  const libs = libsIn ?? (await getPefIndex(supabase)).libs;
  const ix = indexImpactGrade(libs);
  const sp = concept.substrate_specs;
  // Weight is only a proportion for a single substrate, so a placeholder is harmless; use the size and gsm when there are any.
  const toCm = concept.suggested_unit === "mm" ? 0.1 : concept.suggested_unit === "in" ? 2.54 : 1;
  const area = concept.suggested_length && concept.suggested_width ? (concept.suggested_length * toCm * concept.suggested_width * toCm) / 10000 : null;
  const kg = area && sp?.grammage_gsm ? (area * sp.grammage_gsm) / 1000 : 0.1;
  const components: IgComponent[] = concept.suggested_substrate_name ? [{ name: concept.suggested_substrate_name, weightKg: kg, recycledPercent: num(sp?.recycled_content_percent) }] : [];
  const baseTiers: Record<string, IgTier> = {
    RECYCLABILITY: "assumed", SUBSTANCES: "assumed", RESOURCE_USE: "assumed", RECYCLED_CONTENT: sp?.recycled_content_percent != null ? "estimated" : "assumed",
  };
  const base: IgInput = { specType: concept.suggested_spec_type ?? "2d", components, accreditation: sp?.fsc_certified ? "FSC" : undefined };
  const { input, tiers } = applyOverrides(base, baseTiers, overridesIn);
  const warnings = ["Concept stage: a provisional grade from the substrate alone. Supplier, PEF and design answers arrive on the spec."];
  if (!components.length) warnings.push("No substrate suggested for this concept");
  const result = computeImpactGrade({ ...input, tiers }, ix);
  return { payload: payloadFrom(result, { inputs: { overrides: overridesIn, basis: { components } }, supplierScore: null, warnings }), result };
}


/** What a concept card shows: the provisional grade and how far to trust it. */
export type ConceptGrade = { score: number | null; letter: string | null; confidence: number; low: number | null; high: number | null; coverage: number; note: string };

/** Attach a provisional Impact Grade to each ideation concept (computed on view, not stored: the spec stores the real one). */
export async function withConceptGrades<T extends { data: object }>(supabase: Client, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const { libs } = await getPefIndex(supabase);
  const out: T[] = [];
  for (const r of rows) {
    const d = r.data as Parameters<typeof gradeConcept>[1] & { suggested_substrate_name?: string | null };
    if (!d.suggested_substrate_name) { out.push(r); continue; }
    const g = await gradeConcept(supabase, d, {}, libs);
    const grade: ConceptGrade = { score: g.result.score, letter: g.result.letter?.letter ?? null, confidence: g.result.confidence, low: g.result.range?.low ?? null, high: g.result.range?.high ?? null, coverage: Math.round(g.result.coverage * 100), note: g.payload.warnings[0] ?? "" };
    out.push({ ...r, data: { ...r.data, impact_grade: grade } });
  }
  return out;
}

/** Option lists for the edit form (activation periods, inks, varnish, accreditation, electronics), from the governed library. */
export async function getGradeOptions(supabase: Client): Promise<Record<string, string[]>> {
  const { libs } = await getPefIndex(supabase);
  const out: Record<string, string[]> = {};
  for (const r of [...(libs.ig_option_scores ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq))) {
    const k = String(r.data.kind ?? "");
    if (k) (out[k] ??= []).push(r.name);
  }
  return out;
}

/** A stored record in the shape the panel shows. */
export function toRecordView(r: GradeRecord, supplierName: string | null): RecordView {
  return {
    id: r.id, score: r.score === null ? null : Number(r.score), letter: r.letter, coverage: r.coverage === null ? null : Number(r.coverage),
    confidence: r.confidence, rangeLow: r.range_low === null ? null : Number(r.range_low), rangeHigh: r.range_high === null ? null : Number(r.range_high),
    stage: r.stage, reviewStatus: r.review_status, reviewNote: r.review_note, updatedAt: r.updated_at, subScores: r.sub_scores ?? [], tiers: r.tiers ?? {},
    warnings: r.warnings ?? [], overrides: r.inputs?.overrides ?? {}, supplierName, supplierScore: r.supplier_score === null ? null : Number(r.supplier_score),
    pefMpt: r.pef_mpt === null ? null : Number(r.pef_mpt),
  };
}



