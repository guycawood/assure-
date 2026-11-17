// PEF score engine: the Anthesis PEF (Product Environmental Footprint) model, ported from the "PEF Logic" workbook
// as pure TypeScript. No I/O and no imports, so it runs in the app, in previews and in tests unchanged.
//
// Every number comes from the governed Watchtower libraries (mapping tables, ecoinvent factors, normalisation and
// weighting, parameters). Each step resolves to ecoinvent activities and amounts; every activity carries all 16
// EF 3.1 impact categories, so the result is a full vector per life-cycle stage and a weighted single score (the PEF
// score). The PEF score is an input to the Impact Grade, which is calculated separately (formula to be defined).
// Every activity used is returned so the UI can show the derivation.
//
// Fidelity notes (kept deliberately so results match the workbook; each is logged as an open issue):
//   - text lookups are case-insensitive, like Excel's XLOOKUP;
//   - coatings take their geography from PO Ship To (parameter coating_geography), materials from PO Ship From;
//   - printing and branding use renewable electricity whenever the factory is renewable, whatever the supplier role;
//   - the plane distance band is classified from tonne-km ÷ (tonnes ÷ 1000), i.e. km × 1000;
//   - coating mass in end of life follows the coating_end_of_life parameter (the workbook's two sheets disagree).

export const PEF_CATEGORIES = ["AE", "GWP", "CTUe", "Adpf", "Epf", "Epm", "Ept", "Ctuh-c", "Ctuh-nc", "IR", "LU", "ADPe", "ODP", "PM", "POCP", "WU"] as const;
export type PefCategory = (typeof PEF_CATEGORIES)[number];
export type Impacts = Record<PefCategory, number>;

export const PEF_STAGES = ["material", "manufacturing", "distribution", "use", "end_of_life"] as const;
export type PefStage = (typeof PEF_STAGES)[number];
export const STAGE_LABEL: Record<PefStage, string> = {
  material: "Material acquisition", manufacturing: "Manufacturing", distribution: "Distribution", use: "Use", end_of_life: "End of life",
};

/** A library record as stored in library_records (only what the engine reads). */
export type PefRecord = { code: string | null; name: string; data: Record<string, unknown> };
/** Active records by library key (pef_virgin_materials, pef_ecoinvent, ...). */
export type PefLibraryRows = Record<string, PefRecord[] | undefined>;

export type PefComponentInput = {
  /** Sourcing Hub substrate name, as in the virgin materials library. */
  name: string;
  /** Net material weight in kg (per the functional unit the caller chose). */
  weightKg: number;
  /** User-provided recycled content %, or null to use the mapped default. */
  recycledPercent?: number | null;
  coating?: string | null;
  coatingKg?: number | null;
  coatingM2?: number | null;
  /** Gate 5: both finished length and width are at least the minimum size. Derived from lengthCm/widthCm when given. */
  atLeastMinSize?: boolean;
  lengthCm?: number | null;
  widthCm?: number | null;
};

export type PefInput = {
  /** PO Ship From, ISO alpha-2 (UK is read as GB). Used as the manufacturing country. */
  shipFrom: string;
  /** PO Ship To, ISO alpha-2. Country of use and end of life. */
  shipTo: string;
  factoryRenewable: boolean;
  /** Manufacturer, Printer, Trader, Retailer ... */
  supplierType: string;
  components: PefComponentInput[];
  printing?: { type: string; areaM2: number } | null;
  branding?: { type: string; areaM2: number } | null;
  /** Omit any field to derive it from the countries library. */
  transport?: { roadOriginKm?: number | null; roadDestinationKm?: number | null; seaKm?: number | null; airKm?: number | null; truckClass?: string | null; mode?: string | null } | null;
  /** Total usage hours; when null, taken from usagePeriod. */
  usageHours?: number | null;
  usagePeriod?: string | null;
  electronics?: { source: string; kwhPerHour: number } | null;
  lighting?: { source: string; kwhPerHour: number } | null;
  /** Gate 3: the product's materials separate easily. */
  easySeparation?: boolean;
};

export type PefLine = {
  stage: PefStage;
  step: string;
  component?: string;
  activity: string;
  referenceProduct: string;
  geography: string | null;
  /** Amount of the activity's reference product (kg, kWh, MJ, t·km, m2 ...). */
  amount: number;
  unit?: string;
  impacts: Impacts;
};

export type PefComponentResult = {
  name: string;
  weightKg: number;
  virginKg: number;
  recycledKg: number;
  recycledPercent: number;
  efficiency: number;
  gates: { technicallyRecyclable: boolean; noImpediments: boolean; minSize: boolean; eligible: boolean };
  eolClassification: string | null;
};

export type PefResult = {
  lines: PefLine[];
  stages: Record<PefStage, Impacts>;
  /** Named sub-steps (GWP view of the workbook columns) for checking and display. */
  steps: Record<string, Impacts>;
  total: Impacts;
  /** Normalised and weighted, per category (Pt). */
  weighted: Impacts;
  singleScorePt: number;
  singleScoreMpt: number;
  components: PefComponentResult[];
  product: { mono: boolean; canSeparate: boolean; renewableManufacturer: boolean; transport: { mode: string; roadOriginKm: number; roadDestinationKm: number; seaKm: number; airKm: number; truckClass: string; tonnes: number }; usageHours: number };
  /** Lookups that found nothing (a zero here is a gap, not a verified zero impact). */
  warnings: string[];
};

// ------------------------------------------------------------------------------------------------ vectors

export const zeroImpacts = (): Impacts => Object.fromEntries(PEF_CATEGORIES.map((c) => [c, 0])) as Impacts;
const scaled = (v: Impacts, k: number): Impacts => Object.fromEntries(PEF_CATEGORIES.map((c) => [c, v[c] * k])) as Impacts;
function addInto(target: Impacts, v: Impacts, k = 1) { for (const c of PEF_CATEGORIES) target[c] += v[c] * k; }
const sum = (...vs: Impacts[]) => { const t = zeroImpacts(); for (const v of vs) addInto(t, v); return t; };

// ------------------------------------------------------------------------------------------------ index

const key = (...parts: unknown[]) => parts.map((p) => String(p ?? "").trim().toLowerCase()).join("|");
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** A mapping value that means "nothing" (N/A, -, 0, 1 as the workbook treats them for custom factors). */
const none = (v: unknown, extra: string[] = []) => { const t = str(v).toUpperCase(); return t === "" || t === "N/A" || t === "NA" || extra.includes(t); };

type Factor = { amount: number; impacts: Impacts; geography: string; activity: string; referenceProduct: string; unit: string };
type Rec = Record<string, unknown>;

export type PefIndex = ReturnType<typeof indexLibraries>;

/** Build lookup maps once per library snapshot. First record by workbook order (seq) wins, like XLOOKUP. */
export function indexLibraries(libs: PefLibraryRows) {
  const sorted = (k: string) => [...(libs[k] ?? [])].sort((a, b) => (num(a.data.seq) ?? 0) - (num(b.data.seq) ?? 0));
  const firstBy = (k: string, f: (r: PefRecord) => string) => {
    const m = new Map<string, PefRecord>();
    for (const r of sorted(k)) { const kk = f(r); if (!m.has(kk)) m.set(kk, r); }
    return m;
  };
  const factors = new Map<string, Factor>();
  const factorsAnyGeo = new Map<string, Factor>();
  for (const r of sorted("pef_ecoinvent")) {
    const d = r.data;
    const imp = zeroImpacts();
    const raw = (d.impacts ?? d) as Record<string, unknown>; // flat category fields (AE, GWP, ...)
    for (const c of PEF_CATEGORIES) imp[c] = num(raw[c]) ?? 0;
    const f: Factor = { amount: num(d.reference_amount) ?? 1, impacts: imp, geography: str(d.geography), activity: str(d.activity), referenceProduct: str(d.reference_product), unit: str(d.unit) };
    const k3 = key(d.activity, d.reference_product, d.geography);
    if (!factors.has(k3)) factors.set(k3, f);
    const k2 = key(d.activity, d.reference_product);
    if (!factorsAnyGeo.has(k2)) factorsAnyGeo.set(k2, f);
  }
  const customs = new Map<string, Rec[]>();
  for (const r of sorted("pef_custom_factors")) { const k = key(r.data.custom_factor); customs.set(k, [...(customs.get(k) ?? []), r.data]); }
  const params = firstBy("pef_parameters", (r) => key(r.code));
  const param = (code: string) => params.get(key(code))?.data;
  const categories = sorted("pef_impact_categories").map((r) => ({ code: str(r.code) as PefCategory, name: r.name, normalisation: num(r.data.normalisation_factor), weighting: num(r.data.weighting_factor) }));
  /** Letters for the Impact Grade score (0-100); not used by the PEF calculation itself. */
  const bands = sorted("pef_grade_bands").map((r) => ({ letter: str(r.data.letter) || str(r.code), minScore: num(r.data.min_score) ?? 0, label: str(r.data.label), confirmed: r.data.confirmed === true }));
  const countries = sorted("pef_countries");
  return {
    factors, factorsAnyGeo, customs, categories, bands,
    virginBySubstrate: firstBy("pef_virgin_materials", (r) => key(r.data.substrate_name)),
    virginByActivity: firstBy("pef_virgin_materials", (r) => key(r.code)),
    recycledBySubstrate: firstBy("pef_recycled_materials", (r) => key(r.data.substrate_name)),
    recycledByActivity: firstBy("pef_recycled_materials", (r) => key(r.code)),
    coatings: sorted("pef_coatings"),
    processEnergy: firstBy("pef_process_energy", (r) => key(r.code)),
    processLabels: firstBy("pef_process_labels", (r) => key(r.data.kind, r.data.sourcing_hub_label)),
    energy: firstBy("pef_energy_activities", (r) => key(r.data.carrier, r.data.country_code)),
    efficiency: firstBy("pef_process_efficiency", (r) => key(r.code)),
    transport: firstBy("pef_transport_activities", (r) => key(r.data.country, r.data.mode, r.data.road_weight, r.data.plane_range)),
    transportCountryCode: firstBy("pef_transport_activities", (r) => key(r.data.country)),
    useElectricity: firstBy("pef_use_electricity", (r) => key(r.data.country_code)),
    eolMaterials: firstBy("pef_eol_materials", (r) => key(r.data.substrate_name)),
    eolFate: firstBy("pef_eol_fate", (r) => key(r.data.eol_classification, r.data.country_code)),
    eolTreatment: firstBy("pef_eol_treatment", (r) => key(r.data.substrate_name, r.data.destination)),
    countryByCode: (() => { const m = new Map<string, PefRecord>(); for (const r of countries) if (!m.has(key(r.code))) m.set(key(r.code), r); return m; })(),
    countryByName: (() => { const m = new Map<string, PefRecord>(); for (const r of countries) if (!m.has(key(r.name))) m.set(key(r.name), r); return m; })(),
    usagePeriods: firstBy("pef_usage_periods", (r) => key(r.code)),
    num: (code: string, fallback: number) => num(param(code)?.value) ?? fallback,
    text: (code: string, fallback: string) => str(param(code)?.text_value) || fallback,
  };
}

// ------------------------------------------------------------------------------------------------ engine

/** Run the PEF model for one product/order line. */
export function computePef(input: PefInput, libsOrIndex: PefLibraryRows | PefIndex): PefResult {
  const ix = "factors" in libsOrIndex && libsOrIndex.factors instanceof Map ? (libsOrIndex as PefIndex) : indexLibraries(libsOrIndex as PefLibraryRows);
  const warnings = new Set<string>();
  const lines: PefLine[] = [];
  const steps: Record<string, Impacts> = {};
  const stepAdd = (name: string, v: Impacts) => { steps[name] = sum(steps[name] ?? zeroImpacts(), v); };

  const cc = (c: string) => (str(c).toUpperCase() === "UK" ? "GB" : str(c).toUpperCase());
  const from = cc(input.shipFrom);
  const to = cc(input.shipTo);
  const fallback = ix.text("material_geography_fallback", "GLO,RER,RoW").split(",").map((x) => x.trim()).filter(Boolean);
  const eolFallback = ix.text("eol_geography_fallback", "GLO,RER,Europe without Switzerland,RoW").split(",").map((x) => x.trim()).filter(Boolean);
  const coatingCountry = ix.text("coating_geography", "ship_to") === "ship_from" ? from : to;

  /** ecoinvent factor per reference unit for activity|ref, trying geographies in order; anyGeo = then the first row of any geography. */
  function factor(activity: unknown, ref: unknown, geos: string[], anyGeo: boolean, context: string): Factor | null {
    if (none(activity) || none(ref)) { warnings.add(`${context}: no ecoinvent activity mapped`); return null; }
    for (const g of geos) { if (!g) continue; const f = ix.factors.get(key(activity, ref, g)); if (f) return f; }
    if (anyGeo) { const f = ix.factorsAnyGeo.get(key(activity, ref)); if (f) return f; }
    warnings.add(`${context}: ecoinvent factor not found (${str(activity)})`);
    return null;
  }
  /** Add amount × factor as a line; returns the impacts. */
  function addLine(stage: PefStage, step: string, component: string | undefined, f: Factor | null, amount: number, absolute = false): Impacts {
    if (!f || !Number.isFinite(amount) || f.amount === 0) return zeroImpacts();
    const k = amount / f.amount;
    const imp = absolute ? (Object.fromEntries(PEF_CATEGORIES.map((c) => [c, Math.abs(f.impacts[c] / f.amount) * amount])) as Impacts) : scaled(f.impacts, k);
    if (amount !== 0) lines.push({ stage, step, component, activity: f.activity, referenceProduct: f.referenceProduct, geography: f.geography, amount, unit: f.unit, impacts: imp });
    return imp;
  }

  const renewableManufacturer = input.factoryRenewable && str(input.supplierType).toLowerCase() === "manufacturer";

  // ---------------------------------------------------------------- 1. Material acquisition
  type SourceKind = "virgin" | "recycled";
  /** Impact of `kg` of a substrate via its custom factor, raw material or own mapping (one or several activities). */
  function materialImpact(kind: SourceKind, substrate: string, kg: number, custom: string, raw: string, component: string): Impacts {
    const step = kind === "virgin" ? "Virgin material" : "Recycled material";
    const total = zeroImpacts();
    if (!(kg > 0)) return total;
    const hasCustom = !none(custom, kind === "recycled" ? ["-", "0", "1"] : ["1"]);
    const rawValid = !none(raw, kind === "recycled" ? ["-", "0"] : []);
    const table = kind === "virgin" ? { byActivity: ix.virginByActivity, bySubstrate: ix.virginBySubstrate } : { byActivity: ix.recycledByActivity, bySubstrate: ix.recycledBySubstrate };
    const acts: { a: unknown; r: unknown; q: number | null }[] = [];
    if (hasCustom) {
      const rows = ix.customs.get(key(custom)) ?? [];
      if (!rows.length) warnings.add(`${component}: custom factor "${custom}" has no activities`);
      for (const row of rows) acts.push({ a: row.ecoinvent_activity, r: row.ecoinvent_reference_product, q: num(row.amount_per_kg) });
    } else {
      const m = rawValid ? table.byActivity.get(key(raw)) : table.bySubstrate.get(key(substrate));
      if (!m) { warnings.add(`${component}: no ${kind} mapping for "${rawValid ? raw : substrate}"`); return total; }
      acts.push({ a: m.data.ecoinvent_activity, r: m.data.ecoinvent_reference_product, q: num(m.data.reference_amount) });
    }
    for (const x of acts) {
      if (x.q === null) continue;
      const f = factor(x.a, x.r, [from, ...fallback], true, `${component} (${kind})`);
      addInto(total, addLine("material", step, component, f, kg * x.q));
    }
    return total;
  }

  function coatingImpact(c: PefComponentInput): Impacts {
    const text = str(c.coating);
    if (!text || text === "0" || text.toLowerCase() === "none" || text === "-") return zeroImpacts();
    const m = ix.coatings.find((r) => { const lbl = str(r.data.coating_label).toLowerCase(); return lbl !== "" && text.toLowerCase().includes(lbl); });
    if (!m) { warnings.add(`${c.name}: coating "${text}" is not in the coatings library`); return zeroImpacts(); }
    const unit = str(m.data.reference_unit).toLowerCase();
    const amount = unit === "kg" ? num(c.coatingKg) : num(c.coatingM2);
    if (amount === null) { warnings.add(`${c.name}: coating ${unit === "kg" ? "weight (kg)" : "area (m2)"} missing`); return zeroImpacts(); }
    const total = zeroImpacts();
    const custom = str(m.data.custom_factor);
    const geos = [coatingCountry, ...fallback];
    if (!none(custom)) {
      for (const row of ix.customs.get(key(custom)) ?? []) {
        const q = num(row.amount_per_kg); if (q === null) continue;
        addInto(total, addLine("material", "Coating", c.name, factor(row.ecoinvent_activity, row.ecoinvent_reference_product, geos, true, `${c.name} coating`), amount * q));
      }
    } else {
      addInto(total, addLine("material", "Coating", c.name, factor(m.data.ecoinvent_activity, m.data.ecoinvent_reference_product, geos, true, `${c.name} coating`), amount));
    }
    return total;
  }

  const minSize = ix.num("min_recyclable_size_cm", 5);
  const hasPrinting = !!input.printing && !none(input.printing.type, ["NONE", "0", "-"]);
  const hasBranding = !!input.branding && !none(input.branding.type, ["NONE", "0", "-"]);

  const comps = input.components.filter((c) => str(c.name) !== "");
  const compResults: PefComponentResult[] = [];
  const formingWeights: { process: string; kg: number; name: string }[] = [];
  const material = zeroImpacts();
  for (const c of comps) {
    const q = Math.max(0, num(c.weightKg) ?? 0);
    const v = ix.virginBySubstrate.get(key(c.name));
    const rc = ix.recycledBySubstrate.get(key(c.name));
    if (!v) warnings.add(`${c.name}: substrate not in the virgin materials library`);
    const canRec = rc?.data.can_include_recycled === true;
    const recRate = !canRec ? 0 : c.recycledPercent !== null && c.recycledPercent !== undefined ? c.recycledPercent / 100 : (num(rc?.data.default_recycled_percent) ?? 0) / 100;
    const recycled = q * recRate;
    const virgin = q - recycled;
    let eff = 1;
    const process = str(v?.data.manufacturing_process);
    if (renewableManufacturer && process && !none(process)) {
      const e = num(ix.efficiency.get(key(process))?.data.efficiency);
      eff = e !== null && e > 0 ? e : 1;
    }
    const vKg = renewableManufacturer ? virgin / eff : virgin;
    const rKg = renewableManufacturer ? recycled / eff : recycled;
    // Virgin: raw material when a renewable manufacturer forms it (forming energy is then in manufacturing),
    // otherwise the custom factor or the processed substrate mapping.
    const vRaw = renewableManufacturer ? str(v?.data.raw_material) : "";
    const vCustom = renewableManufacturer ? "N/A" : str(v?.data.custom_factor);
    const virginImp = materialImpact("virgin", c.name, vKg, vCustom, vRaw, c.name);
    const rRaw = renewableManufacturer && canRec && recRate !== 0 ? str(rc?.data.raw_material) : "";
    const rCustom = !canRec || recRate === 0 ? "" : renewableManufacturer ? "N/A" : str(rc?.data.custom_factor);
    const recycledImp = materialImpact("recycled", c.name, rKg, rCustom, rRaw, c.name);
    const coatImp = coatingImpact(c);
    const compTotal = sum(virginImp, recycledImp, coatImp);
    addInto(material, compTotal);
    stepAdd(`material:${c.name}`, compTotal);
    if (renewableManufacturer && process && !none(process) && vKg + rKg > 0) formingWeights.push({ process, kg: vKg + rKg, name: c.name });

    const eol = ix.eolMaterials.get(key(c.name));
    const len = num(c.lengthCm); const wid = num(c.widthCm);
    const sizeOk = len !== null && wid !== null ? len >= minSize && wid >= minSize : c.atLeastMinSize === true;
    const coatingNone = none(c.coating, ["NONE", "0", "-"]);
    compResults.push({
      name: c.name, weightKg: q, virginKg: vKg, recycledKg: rKg, recycledPercent: recRate * 100, efficiency: eff,
      gates: { technicallyRecyclable: eol?.data.technically_recyclable === true, noImpediments: coatingNone && !hasPrinting && !hasBranding, minSize: sizeOk, eligible: false },
      eolClassification: eol ? str(eol.data.eol_classification) || null : null,
    });
  }

  // ---------------------------------------------------------------- 2. Manufacturing (process energy)
  function energyFactor(carrier: string, context: string): Factor | null {
    const m = ix.energy.get(key(carrier, from));
    if (!m) { warnings.add(`${context}: no ${carrier} activity for ${from}`); return null; }
    return factor(m.data.ecoinvent_activity, m.data.ecoinvent_reference_product, [str(m.data.ecoinvent_geography), from, "GLO", "RER", "RoW"], false, `${context} ${carrier}`);
  }
  const electricityCarrier = input.factoryRenewable ? "RENEWABLE_ELECTRICITY_kWh" : "ELECTRICITY_kWh";
  function processEnergy(step: string, activity: string, amount: number, context: string): Impacts {
    const p = ix.processEnergy.get(key(activity));
    const total = zeroImpacts();
    if (!p) { warnings.add(`${context}: no energy data for "${activity}"`); return total; }
    const carriers: [string, number][] = [
      [electricityCarrier, num(p.data.electricity_kwh) ?? 0], ["NATURAL_GAS_MJ", num(p.data.natural_gas_mj) ?? 0],
      ["HEAT_OTHER_THAN_NATURAL_GAS_MJ", num(p.data.other_heat_mj) ?? 0], ["STEAM_KG", num(p.data.steam_kg) ?? 0],
    ];
    for (const [carrier, per] of carriers) {
      if (!per) continue;
      addInto(total, addLine("manufacturing", step, context, energyFactor(carrier, context), amount * per));
    }
    return total;
  }
  const forming = zeroImpacts();
  for (const fw of formingWeights) addInto(forming, processEnergy("Forming", fw.process, fw.kg, fw.name));
  function labelled(kind: "printing" | "branding", spec: { type: string; areaM2: number } | null | undefined): Impacts {
    if (!spec || none(spec.type, ["NONE", "0", "-"])) return zeroImpacts();
    const lbl = ix.processLabels.get(key(kind, spec.type));
    if (!lbl) { warnings.add(`${kind === "printing" ? "Printing" : "Branding"} "${spec.type}" is not mapped to an energy activity`); return zeroImpacts(); }
    return processEnergy(kind === "printing" ? "Printing" : "Branding", str(lbl.data.activity), num(spec.areaM2) ?? 0, kind === "printing" ? "Printing" : "Branding");
  }
  const printing = labelled("printing", input.printing);
  const branding = labelled("branding", input.branding);
  stepAdd("forming", forming); stepAdd("printing", printing); stepAdd("branding", branding);
  const manufacturing = sum(forming, printing, branding);

  // ---------------------------------------------------------------- 3. Distribution
  const fromName = str(ix.countryByCode.get(key(from))?.name);
  const toName = str(ix.countryByCode.get(key(to))?.name);
  if (!fromName) warnings.add(`Country ${from} is not in the countries library`);
  if (!toName) warnings.add(`Country ${to} is not in the countries library`);
  const fromC = ix.countryByName.get(key(fromName))?.data ?? {};
  const toC = ix.countryByName.get(key(toName))?.data ?? {};
  const t = input.transport ?? {};
  const same = fromName !== "" && fromName === toName;
  const mode = str(t.mode) || (same ? "Road" : str(((fromC.mode_to ?? {}) as Rec)[toName]) || "Road");
  const roadOriginKm = num(t.roadOriginKm) ?? (same ? ix.num("same_country_road_km", 300) : num(fromC.road_feeder_km) ?? 0);
  const roadDestinationKm = num(t.roadDestinationKm) ?? num(toC.road_feeder_km) ?? 0;
  const seaKm = num(t.seaKm) ?? (mode.toLowerCase() === "sea" ? num(((fromC.sea_km ?? {}) as Rec)[toName]) ?? 0 : 0);
  const airKm = num(t.airKm) ?? 0;
  const truckClass = str(t.truckClass) || ix.text("truck_class", ">32 metric ton");
  const coatingKg = comps.reduce((a, c) => a + (num(c.coatingKg) ?? 0), 0);
  const tonnes = (comps.reduce((a, c) => a + Math.max(0, num(c.weightKg) ?? 0), 0) + coatingKg) / 1000;
  const planeDist = tonnes > 0 ? (airKm * tonnes) / (tonnes / 1000) : 0; // workbook: tonne-km ÷ (tonnes ÷ 1000)
  const planeRange = planeDist === 0 ? "N/A" : planeDist <= ix.num("air_short_max_km", 800) ? "0 - 800 km" : planeDist <= ix.num("air_medium_max_km", 1500) ? "800km - 1500km" : planeDist <= ix.num("air_long_max_km", 4000) ? "1500km - 4000km" : "> 4000km";
  function transportFactor(country: string, m: string, roadClass: string, airRange: string): Factor | null {
    const code = str(ix.transportCountryCode.get(key(country))?.data.country_code);
    const row = ix.transport.get(key(country, m, roadClass, airRange));
    if (!row) { warnings.add(`Transport: no ${m} activity for ${country || "(unknown country)"}${m === "Road" ? ` (${roadClass})` : ""}`); return null; }
    return factor(row.data.ecoinvent_activity, row.data.ecoinvent_reference_product, [str(row.data.ecoinvent_geography), code, "GLO", "RER", "RoW"], false, `Transport ${m}`);
  }
  const distribution = zeroImpacts();
  if (tonnes > 0) {
    if (roadOriginKm) addInto(distribution, addLine("distribution", "Road (origin)", undefined, transportFactor(fromName, "Road", truckClass, "N/A"), roadOriginKm * tonnes));
    if (roadDestinationKm) addInto(distribution, addLine("distribution", "Road (destination)", undefined, transportFactor(toName, "Road", truckClass, "N/A"), roadDestinationKm * tonnes));
    if (seaKm) addInto(distribution, addLine("distribution", "Sea", undefined, transportFactor(fromName, "Sea", "N/A", "N/A"), seaKm * tonnes));
    if (airKm) addInto(distribution, addLine("distribution", "Air", undefined, transportFactor(fromName, "Plane", "N/A", planeRange), airKm * tonnes));
  }
  stepAdd("distribution", distribution);

  // ---------------------------------------------------------------- 4. Use (electricity)
  const hours = num(input.usageHours) ?? num(input.usagePeriod ? ix.usagePeriods.get(key(input.usagePeriod))?.data.hours : null) ?? 0;
  function electricity(step: string, spec: { source: string; kwhPerHour: number } | null | undefined): Impacts {
    const src = str(spec?.source).toLowerCase();
    if (!spec || !(src === "yes, power grid" || src === "yes, batteries")) return zeroImpacts();
    const kwh = (num(spec.kwhPerHour) ?? 0) * hours;
    const m = ix.useElectricity.get(key(to));
    if (!m) { warnings.add(`${step}: no use-phase electricity mapping for ${to}`); return zeroImpacts(); }
    const f = ix.factors.get(key(m.data.ecoinvent_activity, m.data.ecoinvent_reference_product, m.data.ecoinvent_geography));
    if (!f) { warnings.add(`${step}: ecoinvent electricity factor not found for ${to}`); return zeroImpacts(); }
    const mapAmt = num(m.data.reference_amount) || 1;
    return addLine("use", step, undefined, f, kwh / mapAmt);
  }
  const electronics = electricity("Electronics", input.electronics);
  const lighting = electricity("Lighting", input.lighting);
  stepAdd("electronics", electronics); stepAdd("lighting", lighting);
  const usePhase = sum(electronics, lighting);

  // ---------------------------------------------------------------- 5. End of life (cut-off: recycling carries no impact or credit)
  const activeClasses = new Set(comps.filter((c) => (num(c.weightKg) ?? 0) > 0).map((c) => str(ix.eolMaterials.get(key(c.name))?.data.eol_classification)).filter(Boolean));
  const mono = activeClasses.size === 1;
  const canSeparate = mono || input.easySeparation === true;
  // Workbook inconsistency (open issue PORT-05): PEF Logic includes coating mass here, Impact Calc does not.
  const coatingEol = ix.text("coating_end_of_life", "include") !== "exclude";
  function routeRate(material: string, eligible: boolean, dest: "incineration" | "landfill"): number {
    const cls = str(ix.eolMaterials.get(key(material))?.data.eol_classification);
    const f = ix.eolFate.get(key(cls, to));
    const inc = num(f?.data.incineration_rate) ?? 0;
    const land = num(f?.data.landfill_rate) ?? 0;
    const v = dest === "incineration" ? inc : land;
    if (eligible) return v;
    return inc + land === 0 ? 0 : v / (inc + land);
  }
  function treatment(material: string, dest: "Incineration" | "Landfill"): Factor | null {
    const m = ix.eolTreatment.get(key(material, dest));
    if (!m) return null;
    return factor(m.data.ecoinvent_activity, m.data.ecoinvent_reference_product, [to, ...eolFallback], false, `${material} ${dest.toLowerCase()}`);
  }
  const eolStep = (dest: "Incineration" | "Landfill") => {
    const total = zeroImpacts();
    const d = dest === "Incineration" ? "incineration" : "landfill";
    comps.forEach((c, i) => {
      const r = compResults[i];
      const eligible = canSeparate && r.gates.technicallyRecyclable && r.gates.noImpediments && r.gates.minSize;
      r.gates.eligible = eligible;
      const q = Math.max(0, num(c.weightKg) ?? 0);
      if (q > 0) {
        if (!ix.eolTreatment.get(key(c.name, dest))) warnings.add(`${c.name}: no ${d} treatment mapped`);
        addInto(total, addLine("end_of_life", dest, c.name, treatment(c.name, dest), q * routeRate(c.name, eligible, d), true));
      }
      const ck = num(c.coatingKg);
      if (ck && str(c.coating) && coatingEol) addInto(total, addLine("end_of_life", dest, `${c.name} coating`, treatment(str(c.coating), dest), ck * routeRate(str(c.coating), false, d), true));
    });
    return total;
  };
  const incineration = eolStep("Incineration");
  const landfill = eolStep("Landfill");
  stepAdd("incineration", incineration); stepAdd("landfill", landfill);
  const endOfLife = sum(incineration, landfill);

  // ---------------------------------------------------------------- totals, single score, grade
  const stages: Record<PefStage, Impacts> = { material, manufacturing, distribution, use: usePhase, end_of_life: endOfLife };
  const total = sum(...PEF_STAGES.map((s) => stages[s]));
  const weighted = zeroImpacts();
  for (const cat of ix.categories) {
    if (!PEF_CATEGORIES.includes(cat.code)) continue;
    if (!cat.normalisation || cat.weighting === null) { warnings.add(`Impact category ${cat.code}: normalisation or weighting missing`); continue; }
    weighted[cat.code] = (total[cat.code] / cat.normalisation) * cat.weighting;
  }
  const singleScorePt = PEF_CATEGORIES.reduce((a, c) => a + weighted[c], 0);
  const singleScoreMpt = singleScorePt * 1000;
  return {
    lines, stages, steps, total, weighted, singleScorePt, singleScoreMpt,
    components: compResults,
    product: { mono, canSeparate, renewableManufacturer, transport: { mode, roadOriginKm, roadDestinationKm, seaKm, airKm, truckClass, tonnes }, usageHours: hours },
    warnings: [...warnings],
  };
}

/**
 * The letter A-E for an Impact Grade score (0-100): the highest band whose minimum score it reaches.
 * Note: this model produces the PEF score only. The Impact Grade is a separate calculation that uses the PEF score
 * as one input; its formula is still to be defined (open issue PORT-02), so nothing here turns mPt into a grade.
 */
export function letterFor(score: number | null | undefined, bands: { letter: string; minScore: number; label: string; confirmed: boolean }[]) {
  if (score === null || score === undefined || !Number.isFinite(score) || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  const b = sorted.find((x) => score >= x.minScore) ?? sorted[sorted.length - 1];
  return { letter: b.letter, label: b.label, confirmed: b.confirmed };
}
