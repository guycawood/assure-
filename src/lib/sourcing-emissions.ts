// Sourcing+ weight and CO2e logic, ported from the Base44 prototype (specWeight.js, specBom.js, materialBlend.js,
// emissionsCalc.js) as pure TypeScript: no I/O, every intermediate value returned so the UI can show the derivation.
// Material figures cover raw-material production only: this is not a product carbon footprint.

export type SizeUnit = "mm" | "cm" | "in";
export type MeasurementBasis = "grammage" | "thickness_density";

/** Substrate as stored in the Watchtower library (library_records.data for library_key 'substrates'). */
export interface Substrate {
  id: string;
  code?: string | null;
  name?: string;
  substrate_type?: string;
  measurement_basis?: MeasurementBasis;
  grammage_gsm?: number | null;
  thickness_mm?: number | null;
  density_kg_per_m3?: number | null;
  recycled_content_percent?: number | null;
  virgin_factor_code?: string | null;
  recycled_factor_code?: string | null;
  material_factor_code?: string | null;
}

/** Material emission factor (library 'material_emission_factors'). */
export interface MaterialFactor {
  code: string;
  name?: string;
  factor_kgco2e_per_kg: number;
  boundary?: string;
  factor_set?: string;
  source?: string;
}

export interface Step { label: string; value: number | string; unit?: string; detail?: string; result?: boolean }
export interface WeightResult { grams: number | null; basis: string | null; steps: Step[]; missing: string[]; excluded?: boolean }

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const TO_M: Record<SizeUnit, number> = { mm: 0.001, cm: 0.01, in: 0.0254 };

export function toMeters(value: unknown, unit: SizeUnit | null | undefined): number | null {
  const f = unit ? TO_M[unit] : undefined;
  const n = num(value);
  if (!f || !n) return null;
  return n * f;
}

export function areaM2(length: unknown, width: unknown, unit: SizeUnit | null | undefined): number | null {
  const l = toMeters(length, unit);
  const w = toMeters(width, unit);
  return l == null || w == null ? null : l * w;
}

/** Sheets for paper/board: total pages / 2, one sheet when empty or under 2 pages. */
export function paperSheets(totalPages: unknown): number {
  const tp = num(totalPages);
  return !tp || tp < 2 ? 1 : Math.ceil(tp / 2);
}

export interface SpecLike {
  spec_type: "2d" | "3d" | "custom_goods_services" | "design" | "promo_merch";
  size_unit?: SizeUnit | null;
  spec_data?: Record<string, unknown> | null;
}
export interface VersionLike { finished_length?: number | null; finished_width?: number | null; quantity?: number | null; unit_weight_grams?: number | null }

/** Per-unit weight for a single-material spec (deriveUnitWeight). */
export function deriveUnitWeight({ spec, version, substrate }: { spec: SpecLike; version?: VersionLike | null; substrate?: Substrate | null }): WeightResult {
  const st = spec.spec_type;
  const data = spec.spec_data ?? {};
  if (st === "promo_merch" || st === "custom_goods_services") {
    const val = num(data.supplier_confirmed_unit_weight_grams);
    if (val > 0) return { grams: val, basis: "supplier_confirmed", steps: [{ label: "Supplier-confirmed unit weight", value: val, unit: "g", result: true }], missing: [] };
    return { grams: null, basis: "supplier_confirmed", steps: [], missing: ["supplier-confirmed unit weight"] };
  }
  if (st === "design") return { grams: null, basis: null, steps: [], missing: [], excluded: true };
  if (!substrate) return { grams: null, basis: "calculated_from_material", steps: [], missing: ["substrate"] };
  const unit = (spec.size_unit ?? (data.size_unit as SizeUnit | undefined)) || null;
  if (!unit) return { grams: null, basis: "calculated_from_material", steps: [], missing: ["size unit"] };

  let area: number | null;
  let areaLabel: string;
  if (st === "2d") {
    area = areaM2(version?.finished_length ?? data.flat_size_length, version?.finished_width ?? data.flat_size_width, unit);
    areaLabel = "Flat area";
    if (area == null) return { grams: null, basis: "calculated_from_material", steps: [], missing: ["finished length and width"] };
  } else {
    area = areaM2(data.flat_blank_length ?? version?.finished_length, data.flat_blank_width ?? version?.finished_width, unit);
    areaLabel = "Flat blank area";
    if (area == null) return { grams: null, basis: "calculated_from_material", steps: [], missing: ["flat blank length and width"] };
  }
  const steps: Step[] = [{ label: areaLabel, value: round(area, 6), unit: "m²" }];

  if (substrate.measurement_basis === "grammage") {
    const override = num(data.substrate_grammage_gsm_override);
    const gsm = override > 0 ? override : num(substrate.grammage_gsm);
    if (!gsm) return { grams: null, basis: "calculated_from_material", steps, missing: ["substrate grammage (gsm)"] };
    const sheets = paperSheets(data.total_pages);
    const grams = Math.round(area * gsm * sheets);
    steps.push({ label: "Grammage", value: gsm, unit: "gsm" + (override > 0 ? " (override)" : "") });
    steps.push({ label: "Sheets (pages ÷ 2)", value: sheets });
    steps.push({ label: "Unit weight", value: grams, unit: "g", result: true });
    return { grams, basis: "calculated_from_material", steps, missing: [] };
  }
  if (substrate.measurement_basis === "thickness_density") {
    const override = num(data.substrate_thickness_mm_override);
    const thickness = override > 0 ? override : num(substrate.thickness_mm);
    const density = num(substrate.density_kg_per_m3);
    if (!thickness) return { grams: null, basis: "calculated_from_material", steps, missing: ["substrate thickness (mm)"] };
    if (!density) return { grams: null, basis: "calculated_from_material", steps, missing: ["substrate density (kg/m³)"] };
    const grams = Math.round(area * (thickness / 1000) * density * 1000);
    steps.push({ label: "Thickness", value: thickness, unit: "mm" + (override > 0 ? " (override)" : "") });
    steps.push({ label: "Density", value: density, unit: "kg/m³" });
    steps.push({ label: "Unit weight", value: grams, unit: "g", result: true });
    return { grams, basis: "calculated_from_material", steps, missing: [] };
  }
  return { grams: null, basis: "calculated_from_material", steps, missing: ["substrate measurement basis"] };
}

export interface ComponentLike {
  id?: string;
  component_name?: string;
  substrate_id?: string | null;
  is_packaging?: boolean;
  quantity_per_unit?: number | null;
  area_length_cm?: number | null;
  area_width_cm?: number | null;
  direct_weight_grams?: number | null;
  thickness_mm_override?: number | null;
  grammage_gsm_override?: number | null;
}

/** One BOM component's weight per finished unit (deriveComponentWeight). */
export function deriveComponentWeight(c: ComponentLike, substrate: Substrate | null | undefined): WeightResult {
  const q = num(c.quantity_per_unit) > 0 ? num(c.quantity_per_unit) : 1;
  const direct = num(c.direct_weight_grams);
  if (direct > 0) {
    const total = Math.round(direct * q);
    return {
      grams: total, basis: "supplier_confirmed", missing: [],
      steps: [{ label: "Direct weight", value: direct, unit: "g" }, { label: "× per unit", value: q }, { label: "Component weight", value: total, unit: "g", result: true }],
    };
  }
  if (!substrate) return { grams: null, basis: "calculated_from_material", steps: [], missing: ["substrate"] };
  const len = num(c.area_length_cm);
  const wid = num(c.area_width_cm);
  if (!len || !wid) return { grams: null, basis: "calculated_from_material", steps: [], missing: ["area length and width (cm)"] };
  const area = len * 0.01 * (wid * 0.01);
  const steps: Step[] = [{ label: "Area", value: round(area, 6), unit: "m²" }];
  if (substrate.measurement_basis === "grammage") {
    const ov = num(c.grammage_gsm_override);
    const gsm = ov > 0 ? ov : num(substrate.grammage_gsm);
    if (!gsm) return { grams: null, basis: "calculated_from_material", steps, missing: ["grammage"] };
    const grams = Math.round(area * gsm * q);
    steps.push({ label: "Grammage", value: gsm, unit: "gsm" + (ov > 0 ? " (override)" : "") }, { label: "× per unit", value: q }, { label: "Component weight", value: grams, unit: "g", result: true });
    return { grams, basis: "calculated_from_material", steps, missing: [] };
  }
  if (substrate.measurement_basis === "thickness_density") {
    const ov = num(c.thickness_mm_override);
    const thickness = ov > 0 ? ov : num(substrate.thickness_mm);
    const density = num(substrate.density_kg_per_m3);
    if (!thickness) return { grams: null, basis: "calculated_from_material", steps, missing: ["thickness"] };
    if (!density) return { grams: null, basis: "calculated_from_material", steps, missing: ["density"] };
    const grams = Math.round(area * (thickness / 1000) * density * 1000 * q);
    steps.push({ label: "Thickness", value: thickness, unit: "mm" + (ov > 0 ? " (override)" : "") }, { label: "Density", value: density, unit: "kg/m³" },
      { label: "× per unit", value: q }, { label: "Component weight", value: grams, unit: "g", result: true });
    return { grams, basis: "calculated_from_material", steps, missing: [] };
  }
  return { grams: null, basis: "calculated_from_material", steps, missing: ["substrate measurement basis"] };
}

export interface BomRow { component: ComponentLike; substrate: Substrate | null; grams: number | null; steps: Step[]; missing: string[] }

/** Product (non-packaging) and packaging weight per unit (rollupBom). */
export function rollupBom(components: ComponentLike[], substratesById: Record<string, Substrate>) {
  const rows: BomRow[] = components.map((c) => {
    const substrate = c.substrate_id ? substratesById[c.substrate_id] ?? null : null;
    const r = deriveComponentWeight(c, substrate);
    return { component: c, substrate, grams: r.grams, steps: r.steps, missing: r.missing };
  });
  let productGrams = 0;
  let packagingGrams = 0;
  let anyMissing = false;
  for (const r of rows) {
    if (r.grams == null) { anyMissing = true; continue; }
    if (r.component.is_packaging) packagingGrams += r.grams;
    else productGrams += r.grams;
  }
  return { productGrams: Math.round(productGrams), packagingGrams: Math.round(packagingGrams), rows, anyMissing };
}

const HS_BY_SUBSTRATE_TYPE: Record<string, string | null> = {
  paper: "48", board: "48", corrugated: "48", vinyl: "39", fluted_polypropylene: "39", pvc_foam: "39", acrylic: "39",
  metal: "73", wood: "44", textile: "63", other: null,
};

/** Coarse HS chapter from the dominant non-packaging material: a starting point, never authoritative. */
export function suggestHsCode(components: ComponentLike[], substratesById: Record<string, Substrate>): string | null {
  const weights: Record<string, number> = {};
  for (const c of components) {
    if (c.is_packaging || !c.substrate_id) continue;
    const sub = substratesById[c.substrate_id];
    if (!sub?.substrate_type) continue;
    const r = deriveComponentWeight(c, sub);
    if (r.grams == null) continue;
    weights[sub.substrate_type] = (weights[sub.substrate_type] ?? 0) + r.grams;
  }
  const dominant = Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0];
  const chapter = dominant ? HS_BY_SUBSTRATE_TYPE[dominant] : null;
  return chapter ? `${chapter}00.00` : null;
}

/** Gross cargo weight: net plus carton/pallet tare, else packaging uplift %, else unknown (calcGrossWeightKg). */
export function calcGrossWeightKg({ unitWeightGrams, quantity, packaging = {} }: {
  unitWeightGrams: number | null | undefined; quantity: number | null | undefined;
  packaging?: { units_per_outer_carton?: number; outer_carton_empty_weight_g?: number; cartons_per_pallet?: number; pallet_empty_weight_kg?: number; packaging_uplift_percent?: number };
}): { kg: number | null; steps: Step[]; missing: string[] } {
  const uw = num(unitWeightGrams);
  const qty = num(quantity);
  if (!uw || !qty) return { kg: null, steps: [], missing: ["unit weight or quantity"] };
  const netKg = (uw * qty) / 1000;
  const steps: Step[] = [{ label: "Net weight", value: round(netKg, 3), unit: "kg" }];
  const upc = num(packaging.units_per_outer_carton);
  const cartonG = num(packaging.outer_carton_empty_weight_g);
  if (upc && cartonG) {
    const cartons = Math.ceil(qty / upc);
    const cartonKg = (cartons * cartonG) / 1000;
    steps.push({ label: `Outer cartons (÷${upc})`, value: cartons }, { label: "Carton tare", value: round(cartonKg, 3), unit: "kg" });
    let total = netKg + cartonKg;
    const cpp = num(packaging.cartons_per_pallet);
    const palletKg = num(packaging.pallet_empty_weight_kg);
    if (cpp && palletKg) {
      const pallets = Math.ceil(cartons / cpp);
      steps.push({ label: `Pallets (÷${cpp})`, value: pallets }, { label: "Pallet tare", value: round(pallets * palletKg, 3), unit: "kg" });
      total += pallets * palletKg;
    }
    steps.push({ label: "Gross weight", value: round(total, 3), unit: "kg", result: true });
    return { kg: round(total, 3), steps, missing: [] };
  }
  const uplift = num(packaging.packaging_uplift_percent);
  if (uplift) {
    const gross = netKg * (1 + uplift / 100);
    steps.push({ label: "Packaging uplift", value: uplift, unit: "%" }, { label: "Gross weight", value: round(gross, 3), unit: "kg", result: true });
    return { kg: round(gross, 3), steps, missing: [] };
  }
  return { kg: null, steps, missing: ["packaging (carton/pallet figures or uplift %)"] };
}

export interface Blend { mode: "blend" | "virgin_only" | "recycled_only" | "single"; blended: number; recycledPercent: number; virgin?: MaterialFactor; recycled?: MaterialFactor; single?: MaterialFactor; boundary?: string }

/** Blended kgCO2e/kg for a substrate from its virgin / recycled factors by recycled content % (computeMaterialBlend). */
export function computeMaterialBlend(substrate: Substrate | null | undefined, factorsByCode: Record<string, MaterialFactor>): Blend | null {
  if (!substrate) return null;
  const virgin = substrate.virgin_factor_code ? factorsByCode[substrate.virgin_factor_code] : undefined;
  const recycled = substrate.recycled_factor_code ? factorsByCode[substrate.recycled_factor_code] : undefined;
  const single = substrate.material_factor_code ? factorsByCode[substrate.material_factor_code] : undefined;
  const pct = num(substrate.recycled_content_percent);
  if (virgin && recycled && pct > 0) {
    const r = Math.min(Math.max(pct, 0), 100) / 100;
    return {
      mode: "blend", virgin, recycled, recycledPercent: pct,
      blended: virgin.factor_kgco2e_per_kg * (1 - r) + recycled.factor_kgco2e_per_kg * r,
      boundary: virgin.boundary === recycled.boundary ? virgin.boundary : "mixed",
    };
  }
  if (virgin && !recycled) return { mode: "virgin_only", virgin, recycledPercent: pct, blended: virgin.factor_kgco2e_per_kg, boundary: virgin.boundary };
  if (recycled && !virgin) return { mode: "recycled_only", recycled, recycledPercent: pct, blended: recycled.factor_kgco2e_per_kg, boundary: recycled.boundary };
  if (virgin && recycled) return { mode: "virgin_only", virgin, recycledPercent: 0, blended: virgin.factor_kgco2e_per_kg, boundary: virgin.boundary };
  if (single) return { mode: "single", single, recycledPercent: pct, blended: single.factor_kgco2e_per_kg, boundary: single.boundary };
  return null;
}

export function blendFormula(b: Blend | null): string {
  if (!b || b.mode !== "blend" || !b.virgin || !b.recycled) return "";
  return `${b.virgin.factor_kgco2e_per_kg} × ${100 - b.recycledPercent}% + ${b.recycled.factor_kgco2e_per_kg} × ${b.recycledPercent}%`;
}

export interface Co2eLine { label: string; grams: number | null; factor: number | null; kgco2e: number | null; formula: string; missing: string[]; packaging: boolean }
export interface SpecCo2e { perUnitKg: number | null; totalKg: number | null; quantity: number; unitWeightGrams: number | null; packagingGrams: number; lines: Co2eLine[]; missing: string[]; complete: boolean; excluded: boolean }

/**
 * Material CO2e estimate for a spec: each component's (or the single substrate's) weight × its blended material factor.
 * Partial results are flagged; design specs are excluded (no physical goods).
 */
export function computeSpecCo2e({ spec, versions, components, substratesById, factorsByCode, singleSubstrate }: {
  spec: SpecLike; versions: VersionLike[]; components: ComponentLike[];
  substratesById: Record<string, Substrate>; factorsByCode: Record<string, MaterialFactor>; singleSubstrate?: Substrate | null;
}): SpecCo2e {
  const quantity = versions.reduce((s, v) => s + num(v.quantity), 0);
  if (spec.spec_type === "design") {
    return { perUnitKg: null, totalKg: null, quantity, unitWeightGrams: null, packagingGrams: 0, lines: [], missing: [], complete: true, excluded: true };
  }
  const lines: Co2eLine[] = [];
  let unitWeight: number | null = null;
  let packagingGrams = 0;
  if (components.length > 0) {
    const bom = rollupBom(components, substratesById);
    unitWeight = bom.anyMissing ? null : bom.productGrams;
    packagingGrams = bom.packagingGrams;
    for (const r of bom.rows) {
      const blend = computeMaterialBlend(r.substrate, factorsByCode);
      const missing = [...r.missing];
      if (!blend) missing.push(r.substrate ? `emission factor for ${r.substrate.name ?? "substrate"}` : "substrate (for its emission factor)");
      lines.push({
        label: r.component.component_name ?? "Component", grams: r.grams, factor: blend?.blended ?? null,
        kgco2e: r.grams != null && blend ? (r.grams / 1000) * blend.blended : null,
        formula: blend ? blendFormula(blend) || `${round(blend.blended, 3)} kgCO2e/kg` : "", missing, packaging: !!r.component.is_packaging,
      });
    }
  } else {
    const w = deriveUnitWeight({ spec, version: versions[0], substrate: singleSubstrate });
    unitWeight = w.grams;
    const blend = computeMaterialBlend(singleSubstrate, factorsByCode);
    const missing = [...w.missing];
    if (!blend && singleSubstrate) missing.push(`emission factor for ${singleSubstrate.name ?? "substrate"}`);
    lines.push({
      label: singleSubstrate?.name ?? "Material", grams: w.grams, factor: blend?.blended ?? null,
      kgco2e: w.grams != null && blend ? (w.grams / 1000) * blend.blended : null,
      formula: blend ? blendFormula(blend) || `${round(blend.blended, 3)} kgCO2e/kg` : "", missing, packaging: false,
    });
  }
  const missing = lines.flatMap((l) => l.missing);
  const complete = missing.length === 0 && lines.length > 0;
  const perUnit = lines.reduce((s, l) => s + (l.kgco2e ?? 0), 0);
  const anyValue = lines.some((l) => l.kgco2e != null);
  return {
    perUnitKg: anyValue ? round(perUnit, 5) : null,
    totalKg: anyValue ? round(perUnit * quantity, 3) : null,
    quantity, unitWeightGrams: unitWeight, packagingGrams, lines, missing, complete, excluded: false,
  };
}

/* ---------- Transport emissions (GHG Protocol Scope 3 Cat. 4), used by Logistics+ ---------- */

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** kgCO2e = tonnes × haversine km × distance correction × gCO2e per tonne-km ÷ 1000. */
export function transportKgCo2e({ weightKg, distanceKm, factorGPerTkm, correction = 1 }: { weightKg: number; distanceKm: number; factorGPerTkm: number; correction?: number }): number {
  return ((weightKg / 1000) * distanceKm * correction * factorGPerTkm) / 1000;
}
