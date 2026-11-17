import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { computeImpactGrade, indexImpactGrade, type IgComponent, type IgInput, type IgTier } from "@/lib/impact-grade";
import { applyOverrides } from "@/lib/impact-grade-fields";
import { computePef, type PefInput, type PefResult } from "@/lib/pef";
import { getPefIndex } from "@/lib/pef-data";
import { getMethodology, getInputsBySupplier } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { supplierSustainabilityScore } from "@/lib/impact-grade-supplier";
import type { GradePayload } from "@/lib/impact-grade-spec";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * A rate card's Impact Grade, worked out by the same engine as a spec's: from the card's material and size (one finished
 * unit), its supplier's SRM scorecard and the PEF model. Every input is at an evidence tier below Declared until a supplier
 * or reviewer improves it, so the confidence stays honest. Nothing is saved here.
 */
export type RateCardGradeRow = {
  id: string; code: string | null; name: string; data: Record<string, unknown>;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const key = (v: unknown) => String(v ?? "").trim().toLowerCase();

function countryCode(countries: { code: string; name: string }[], market: string | null | undefined): string | null {
  const m = key(market);
  if (!m) return null;
  const hit = countries.find((c) => key(c.code) === m || key(c.name) === m) ?? countries.find((c) => m.includes(key(c.name)) || (key(c.name).length > 3 && key(c.name).includes(m)));
  return hit?.code ?? null;
}

export async function gradeRateCard(supabase: Client, cardId: string): Promise<{ payload: GradePayload; supplierName: string | null } | null> {
  const { data: card } = await supabase.from("library_records").select("id, code, name, data").eq("id", cardId).eq("library_key", "rate_cards").maybeSingle();
  if (!card) return null;
  const c = card as RateCardGradeRow;
  const d = c.data;
  const warnings: string[] = [];

  const [{ data: subRows }, { data: supRows }, { index, libs }] = await Promise.all([
    d.substrate_code ? supabase.from("library_records").select("name, data").eq("library_key", "substrates").eq("code", String(d.substrate_code)).limit(1) : Promise.resolve({ data: [] }),
    d.supplier_code ? supabase.from("suppliers").select("id, name, market").eq("supplier_code", String(d.supplier_code)).limit(1) : Promise.resolve({ data: [] }),
    getPefIndex(supabase),
  ]);
  const sub = ((subRows ?? []) as { name: string; data: Record<string, unknown> }[])[0];
  const sup = ((supRows ?? []) as { id: string; name: string; market: string | null }[])[0];

  // One finished unit: area times the board's weight per square metre.
  const lengthMm = num(d.finished_length_mm), widthMm = num(d.finished_width_mm), gsm = num(sub?.data?.grammage_gsm);
  const components: IgComponent[] = [];
  if (sub && lengthMm && widthMm && gsm) {
    components.push({ name: sub.name, weightKg: (lengthMm / 1000) * (widthMm / 1000) * gsm / 1000, recycledPercent: num(sub.data.recycled_content_percent) });
  } else if (!sub) warnings.push("No material on the card, so no weight can be worked out");
  else warnings.push(`${sub.name}: the weight cannot be worked out from this card (needs a size and the material's weight per square metre)`);

  let supplierScore: number | null = null;
  let renewable = false;
  if (sup) {
    const [m, inputsBy] = await Promise.all([getMethodology(supabase, { status: "active" }), getInputsBySupplier(supabase)]);
    const inputs = inputsBy.get(sup.id) ?? [];
    renewable = inputs.find((i) => i.key === "renewable")?.value_text === "full";
    const igIx = indexImpactGrade(libs);
    if (m) {
      const s = supplierSustainabilityScore(m, scoreSupplier(m, inputs, true), igIx.supplierCriteria);
      supplierScore = s.score;
      if (!s.parts.length) warnings.push("Supplier Score: the supplier has no sustainability data in SRM");
      else if (s.missing.length) warnings.push(`Supplier Score: SRM has no data for ${s.missing.join(", ")}`);
    }
  } else warnings.push("Supplier Score: no supplier on the card");

  const baseTiers: Record<string, IgTier> = {
    RECYCLABILITY: "estimated", RESOURCE_USE: "assumed", SUBSTANCES: "estimated",
    RECYCLED_CONTENT: components.some((x) => x.recycledPercent != null) ? "declared" : "assumed", PEF: "estimated", SUPPLIER: "verified",
  };
  const base: IgInput = { specType: String(d.spec_type ?? "2d"), components, supplierScore };
  const { input, tiers } = applyOverrides(base, baseTiers, {});

  // PEF: delivered inside the supplier's own market, which is an assumption a rate card cannot avoid (it has no destination).
  let pef: PefResult | null = null;
  let pefInput: PefInput | null = null;
  const countries = (libs.pef_countries ?? []).map((r) => ({ code: String(r.code), name: r.name }));
  const ship = countryCode(countries, sup?.market);
  if (components.length && ship) {
    pefInput = {
      shipFrom: ship, shipTo: ship, factoryRenewable: renewable, supplierType: "Manufacturer",
      components: components.map((x) => ({ name: x.name, weightKg: x.weightKg, recycledPercent: x.recycledPercent ?? null, atLeastMinSize: true })),
    };
    pef = computePef(pefInput, index);
    input.pefMpt = pef.singleScoreMpt;
    warnings.push("PEF assumes delivery inside the supplier's own market; a job with a real destination will differ");
    if (pef.warnings.length) warnings.push(...pef.warnings.map((w) => `PEF: ${w}`));
  } else if (components.length) warnings.push(`PEF not calculated: no country found for the supplier's market${sup?.market ? ` (${sup.market})` : ""}`);

  const result = computeImpactGrade({ ...input, tiers }, indexImpactGrade(libs));
  const payload: GradePayload = {
    score: result.score, letter: result.letter?.letter ?? null, coverage: Math.round(result.coverage * 1000) / 10, confidence: result.confidence,
    range_low: result.range?.low ?? null, range_high: result.range?.high ?? null, pef_mpt: result.pef.mpt, supplier_score: supplierScore,
    inputs: { basis: { components, supplier: sup?.name ?? null, size: [lengthMm, widthMm], substrate: sub?.name ?? null } },
    tiers: result.tiers, sub_scores: result.subScores, warnings,
  };
  return { payload, supplierName: sup?.name ?? null };
}
