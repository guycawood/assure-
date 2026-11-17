// Builds the Impact Grade (PEF) Watchtower libraries from the Anthesis "PEF Logic" workbook.
//
//   node scripts/impact-grade/build-seed.mjs "<path to PEF Logic.xlsx>"
//
// Writes:
//   supabase/seed/m99_impact_grade.sql   governed library records (mapping tables, factors, methodology, issues)
//   tests/fixtures/pef_golden.json       the workbook's worked rows: inputs and Excel results, for the engine test
//
// Only the ecoinvent activities the mapping tables reference are kept (licensed data: the full set is loaded per
// environment through the Watchtower import). Supplier/factory names and order extracts are not copied.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openWorkbook, colIndex } from "./xlsx.mjs";

const src = process.argv[2];
if (!src) { console.error("Usage: node scripts/impact-grade/build-seed.mjs <PEF Logic.xlsx>"); process.exit(1); }
const root = join(import.meta.dirname, "..", "..");
const wb = openWorkbook(src);

const s = (v) => (v === undefined || v === null ? "" : String(v).trim());
const n = (v) => (typeof v === "number" ? v : v === undefined || v === "" || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const na = (v) => { const t = s(v); return t === "" || t.toUpperCase() === "N/A" || t.toUpperCase() === "NA" || t === "-" ? null : t; };
const yn = (v) => v === true || v === 1 || s(v) === "1" || s(v).toUpperCase() === "TRUE" || s(v).toUpperCase() === "Y" || s(v).toUpperCase() === "YES";
const colLetter = (i) => { let out = ""; while (i > 0) { const m = (i - 1) % 26; out = String.fromCharCode(65 + m) + out; i = Math.floor((i - 1) / 26); } return out; };
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));

/** library_key -> [{code, name, data}] */
const libs = {};
function add(key, code, name, data) {
  const list = (libs[key] ??= []);
  const used = (libs[`__codes_${key}`] ??= new Map());
  let c = s(code) || `${key}-${list.length + 1}`;
  if (used.has(c)) { const k = used.get(c) + 1; used.set(c, k); c = `${c} (${k})`; } else used.set(c, 1);
  list.push({ code: c, name: s(name) || c, data: clean(data) });
}

// ---------------------------------------------------------------- Impact categories (normalisation + weighting)
const eco = wb.sheet("ecoinvent");
const catCols = [];
for (let c = colIndex("H"); c <= colIndex("W"); c++) {
  const col = colLetter(c);
  catCols.push({ col, code: s(eco.get(`${col}1`)).replace(/'/g, ""), category: s(eco.get(`${col}3`)), indicator: s(eco.get(`${col}4`)), unit: s(eco.get(`${col}5`)) });
}
const norm = wb.sheet("PEF Normalization").rows(2, ["A", "B", "C", "D", "E"], "B");
catCols.forEach((c, i) => {
  const nr = norm.find((r) => s(r.B).replace(/'/g, "") === c.code);
  add("pef_impact_categories", c.code, nr ? s(nr.C) : c.category, {
    sort: i + 1, ecoinvent_category: c.category, indicator: c.indicator, unit: c.unit, method: "EF v3.1",
    normalisation_factor: n(nr?.D), weighting_factor: n(nr?.E),
  });
});

// ---------------------------------------------------------------- Mapping tables
const referenced = new Set(); // "activity|reference product" pairs used by any mapping
// Excel's XLOOKUP matches text case-insensitively, so the engine and this selection do too.
const ref = (a, r) => { if (na(a) && na(r)) referenced.add(`${s(a)}|${s(r)}`.toLowerCase()); };

for (const r of wb.sheet("1-1").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"], "B")) {
  ref(r.G, r.H);
  add("pef_virgin_materials", r.B, r.C, {
    seq: r._row, substrate_name: s(r.C), substrate_type: s(r.D), includes_forming: yn(r.E), source: s(r.F),
    ecoinvent_activity: na(r.G), ecoinvent_reference_product: na(r.H), custom_factor: na(r.I), includes_processing: yn(r.J),
    reference_amount: n(r.K), reference_unit: na(r.L), manufacturing_process: na(r.M), raw_material: na(r.N),
  });
}
for (const r of wb.sheet("1-2").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"], "B")) {
  ref(r.I, r.J);
  add("pef_recycled_materials", r.B, r.C, {
    seq: r._row, substrate_name: s(r.C), substrate_type: s(r.D), includes_forming: yn(r.E), can_include_recycled: yn(r.F),
    default_recycled_percent: n(r.G) === null ? null : n(r.G) * 100, source: na(r.H),
    ecoinvent_activity: na(r.I), ecoinvent_reference_product: na(r.J), custom_factor: na(r.K),
    reference_amount: n(r.L), reference_unit: na(r.M), manufacturing_process: na(r.N), raw_material: na(r.O),
  });
}
for (const r of wb.sheet("1-3").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], "B")) {
  if (s(r.A) !== "Coating") continue;
  ref(r.D, r.E);
  add("pef_coatings", r.B, r.B, {
    seq: r._row, coating_label: s(r.B), source: s(r.C), ecoinvent_activity: na(r.D), ecoinvent_reference_product: na(r.E),
    custom_factor: na(r.F), reference_amount: n(r.G), reference_unit: s(r.H).toLowerCase() || null,
    conversion_to_weight: n(r.I), weight_unit: na(r.J),
  });
}
for (const r of wb.sheet("1-4").rows(2, ["A", "B", "C", "D", "E", "F", "G"], "B")) {
  ref(r.D, r.E);
  add("pef_custom_factors", `${s(r.B)} #${r._row - 1}`, r.B, {
    seq: r._row, custom_factor: s(r.B), ecoinvent_activity: na(r.D), ecoinvent_reference_product: na(r.E),
    amount_per_kg: n(r.F), unit: na(r.G),
  });
}
for (const r of wb.sheet("2-1 (1)").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"], "B")) {
  add("pef_process_energy", r.B, r.B, {
    seq: r._row, manufacturing_type: s(r.C), manufacturing_process: s(r.D), data_source: s(r.E),
    electricity_kwh: n(r.F) ?? 0, natural_gas_mj: n(r.G) ?? 0, other_heat_mj: n(r.H) ?? 0, steam_kg: n(r.I) ?? 0,
    reference_amount: n(r.J), reference_unit: na(r.K),
  });
}
{
  const sh = wb.sheet("2-1 (2)");
  for (let r = 3; r <= 15; r++) {
    const act = s(sh.get(`A${r}`)); const label = s(sh.get(`B${r}`));
    if (!act || !label || !act.includes("|")) continue;
    const kind = act.startsWith("Printing") ? "printing" : act.startsWith("Branding") ? "branding" : null;
    if (!kind) continue;
    add("pef_process_labels", `${kind}|${label}`, label, { seq: r, kind, sourcing_hub_label: label, activity: act });
  }
}
for (const r of wb.sheet("2-2").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], "B")) {
  ref(r.G, r.H);
  add("pef_energy_activities", `${s(r.B)}|${s(r.D)}`, `${s(r.C)} · ${s(r.B)}`, {
    seq: r._row, carrier: s(r.B), country: s(r.C), country_code: s(r.D), ecoinvent_geography: s(r.E),
    market_group: yn(r.F), ecoinvent_activity: na(r.G), ecoinvent_reference_product: na(r.H),
    reference_amount: n(r.I), reference_unit: na(r.J),
  });
}
for (const r of wb.sheet("2-3").rows(2, ["A", "B", "C", "D"], "A")) {
  add("pef_process_efficiency", r.A, r.A, { seq: r._row, efficiency_key: na(r.B), efficiency: n(r.C), notes: na(r.D) });
}
for (const r of wb.sheet("3").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"], "B")) {
  ref(r.I, r.J);
  add("pef_transport_activities", `${s(r.D)}|${s(r.E)}|${s(r.F)}|${s(r.G)}`, `${s(r.C)} · ${s(r.B)}`, {
    seq: r._row, country: s(r.C), country_code: s(r.D), mode: s(r.E), road_weight: s(r.F) || "N/A", plane_range: s(r.G) || "N/A",
    ecoinvent_geography: s(r.H), ecoinvent_activity: na(r.I), ecoinvent_reference_product: na(r.J),
    reference_amount: n(r.K), reference_unit: na(r.L),
  });
}
for (const r of wb.sheet("4").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], "D")) {
  ref(r.G, r.H);
  add("pef_use_electricity", r.D, r.C, {
    seq: r._row, country: s(r.C), country_code: s(r.D), ecoinvent_geography: s(r.E), market_group: yn(r.F),
    ecoinvent_activity: na(r.G), ecoinvent_reference_product: na(r.H), reference_amount: n(r.I), reference_unit: na(r.J),
  });
}
for (const r of wb.sheet("5-1").rows(2, ["A", "B", "C", "D", "E", "F"], "B")) {
  add("pef_eol_materials", r.B, r.B, {
    seq: r._row, substrate_name: s(r.B), substrate_type: s(r.C), eol_category: s(r.D), eol_classification: s(r.E),
    technically_recyclable: s(r.F).toUpperCase() === "Y",
  });
}
for (const r of wb.sheet("5-2").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H"], "C")) {
  add("pef_eol_fate", `${s(r.C)}|${s(r.E)}`, `${s(r.D)} · ${s(r.C)}`, {
    seq: r._row, eol_category: s(r.B), eol_classification: s(r.C), country: s(r.D), country_code: s(r.E),
    recycling_rate: n(r.F) ?? 0, incineration_rate: n(r.G) ?? 0, landfill_rate: n(r.H) ?? 0,
  });
}
for (const r of wb.sheet("5-3").rows(2, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], "B")) {
  ref(r.F, r.G);
  add("pef_eol_treatment", r.B, r.B, {
    seq: r._row, substrate_name: s(r.C), substrate_type: s(r.D), destination: s(r.E),
    ecoinvent_activity: na(r.F), ecoinvent_reference_product: na(r.G), defra_factor: na(r.H),
    reference_amount: n(r.I), reference_unit: na(r.J),
  });
}

// ---------------------------------------------------------------- Countries: code/name, road feeder km, default mode, sea km
{
  const sh = wb.sheet("Countries");
  const seaCols = []; for (let c = colIndex("E"); c <= colIndex("CC"); c++) { const name = s(sh.get(`${colLetter(c)}3`)); if (name) seaCols.push({ col: colLetter(c), name }); }
  const modeCols = []; for (let c = colIndex("D"); c <= colIndex("CA"); c++) { const name = s(sh.get(`${colLetter(c)}82`)); if (name) modeCols.push({ col: colLetter(c), name }); }
  const modeRows = new Map(); for (let r = 83; r <= 158; r++) { const name = s(sh.get(`C${r}`)); if (name && !modeRows.has(name)) modeRows.set(name, r); }
  const roadKm = new Map(); for (let r = 162; r <= 237; r++) { const name = s(sh.get(`C${r}`)); if (name && !roadKm.has(name)) roadKm.set(name, n(sh.get(`F${r}`))); }
  for (let r = 5; r <= 80; r++) {
    const code = s(sh.get(`A${r}`)); const name = s(sh.get(`C${r}`));
    if (!code || !name) continue;
    const sea = {}; for (const c of seaCols) { const v = n(sh.get(`${c.col}${r}`)); if (v !== null) sea[c.name] = v; }
    const mode = {}; const mr = modeRows.get(name); if (mr) for (const c of modeCols) { const v = s(sh.get(`${c.col}${mr}`)); if (v) mode[c.name] = v; }
    add("pef_countries", code, name, { seq: r, country_code: code, region: s(sh.get(`B${r}`)), busiest_port: s(sh.get(`D${r}`)), road_feeder_km: roadKm.get(name) ?? null, sea_km: sea, mode_to: mode });
  }
}

// ---------------------------------------------------------------- Usage periods (activation period -> hours)
for (const r of wb.sheet("Time Usage").rows(3, ["A", "B", "C"], "B")) {
  add("pef_usage_periods", r.B, r.B, { seq: r._row, hours: n(r.C), usage_score: n(r.A) });
}

// ---------------------------------------------------------------- Methodology (Assumptions sheet: the documented formulas)
{
  const sh = wb.sheet("Assumptions");
  let stage = "General"; let i = 0;
  const stageCode = { General: "GEN", "Material Acquisition & Preprocessing": "MAT", Manufacturing: "MFG", Usage: "USE", Distribution: "DIST", "End of Life": "EOL" };
  for (let r = 1; r <= 85; r++) {
    const a = s(sh.get(`A${r}`)); const b = s(sh.get(`B${r}`)); const c = s(sh.get(`C${r}`)); const d = s(sh.get(`D${r}`));
    if (a.startsWith("Logic for ")) { stage = a.replace("Logic for ", ""); i = 0; continue; }
    if (a.startsWith("General Model")) { stage = "General"; i = 0; continue; }
    if (!a || a === "Topic" || !c) continue;
    i++;
    add("pef_methodology", `${stageCode[stage] ?? "GEN"}-${String(i).padStart(2, "0")}`, a, { seq: r, stage, source_field: b, rule: c, assumption: d });
  }
}

// ---------------------------------------------------------------- Open issues (Anthesis consistency review)
for (const r of wb.sheet("Review").rows(5, ["A", "B", "C", "D", "E", "F", "G"], "A")) {
  add("pef_open_issues", r.A, s(r.D) || s(r.C), {
    seq: r._row, issue_id: s(r.A), severity: s(r.B).toLowerCase(), location: s(r.C), issue: s(r.D), evidence: s(r.E),
    recommendation: s(r.F), current_treatment: s(r.G), status: "open",
  });
}
// Found while porting the workbook into System Guy (not in the Anthesis review).
add("pef_open_issues", "PORT-01", "Coating factors use PO Ship To, materials use PO Ship From", {
  seq: 1000, issue_id: "PORT-01", severity: "medium", location: "PEF Logic AP / BU / CZ (coating impact)",
  issue: "Coating impact picks the ecoinvent geography from PO Ship To, while virgin and recycled material use PO Ship From.",
  evidence: "The coating formulas set the country from column C (ship to); the material formulas use column B (ship from). The methodology says geography follows PO Ship From.",
  recommendation: "Confirm with Anthesis which geography coatings should use and align the formula.",
  current_treatment: "System Guy reproduces the workbook (ship to) so results match; flip the 'coating_geography' parameter once confirmed.", status: "open",
});
add("pef_open_issues", "PORT-02", "PEF score inside the Impact Grade: functional unit", {
  seq: 1001, issue_id: "PORT-02", severity: "high", location: "PEF Logic GF / GG → Impact Grade sub-score",
  issue: "This model produces the PEF score (weighted single score, Pt / mPt). The Impact Grade (Impact Grade.xlsx) uses it as half the grade, scaled against the 95th percentile of our PEF scores.",
  evidence: "Per-order and per-unit PEF results differ by orders of magnitude (SCOPE-01): the PEF scores compared against the reference must share one functional unit, or the percentile mixes order lines with single products.",
  recommendation: "Settle the functional unit (per product or per order line) before PEF results are stored for specs and the reference is recalculated.",
  current_treatment: "Reference seeded from the 6 worked examples (order lines). Letters A 80+, B 60+, C 40+, D 20+, E below are provisional.", status: "open",
});

add("pef_open_issues", "PORT-03", "Printing and branding use renewable electricity for any supplier role", {
  seq: 1002, issue_id: "PORT-03", severity: "medium", location: "PEF Logic DM / DR (DI, DN unused)",
  issue: "Printing and branding switch to renewable electricity whenever the factory is renewable, whatever the supplier type.",
  evidence: "Columns DI and DN work out 'renewable manufacturer or printer' but DM and DR test only column F (factory renewable). The methodology excludes traders and retailers.",
  recommendation: "Use the DI / DN result in the printing and branding formulas.",
  current_treatment: "System Guy reproduces the workbook so results match.", status: "open",
});
add("pef_open_issues", "PORT-04", "Flight range is classified from km × 1000", {
  seq: 1003, issue_id: "PORT-04", severity: "medium", location: "PEF Logic EG (planeDist)",
  issue: "The plane distance used to pick short, medium or long haul is tonne-km ÷ (tonnes ÷ 1000), which is the air distance × 1000.",
  evidence: "Any air leg is therefore classed as '> 4000km'. None of the worked examples has an air leg, so no current result is affected.",
  recommendation: "Classify the range from the air distance in km.",
  current_treatment: "System Guy reproduces the workbook so results match.", status: "open",
});

add("pef_open_issues", "PORT-05", "Coating end of life is in the CO2e total but not in the single score", {
  seq: 1004, issue_id: "PORT-05", severity: "high", location: "PEF Logic EU / EV vs Impact Calc (EOL rows)",
  issue: "PEF Logic adds incineration and landfill of the coating mass to the end-of-life CO2e; Impact Calc, which feeds the 16 categories and the single score, leaves it out.",
  evidence: "Worked example 4 (Duplex Board with 0.25 kg Gloss Lamination): PEF Logic total 2.871 kg CO2e, Impact Calc climate change 2.520 kg CO2e. The other worked examples have no coating weight and agree.",
  recommendation: "Decide whether coatings go to end of life and make both sheets do the same.",
  current_treatment: "Parameter coating_end_of_life = include (as PEF Logic). Set it to exclude to reproduce the workbook's single score exactly.", status: "open",
});

// ---------------------------------------------------------------- Parameters (the constants the maths uses)
const params = [
  ["same_country_road_km", "Road distance when origin and destination are the same country", 300, null, "km", "Distribution"],
  ["truck_class", "Truck class for road legs", null, ">32 metric ton", "", "Distribution"],
  ["air_short_max_km", "Plane: upper bound of the shortest range", 800, null, "km", "Distribution"],
  ["air_medium_max_km", "Plane: upper bound of the 800-1500 km range", 1500, null, "km", "Distribution"],
  ["air_long_max_km", "Plane: upper bound of the 1500-4000 km range", 4000, null, "km", "Distribution"],
  ["material_geography_fallback", "Geography fallback after the ship-from country (material, coating, energy)", null, "GLO,RER,RoW", "", "All stages"],
  ["eol_geography_fallback", "Geography fallback after the ship-to country (end of life)", null, "GLO,RER,Europe without Switzerland,RoW", "", "End of life"],
  ["coating_geography", "Country used for coating factors: ship_to (as in the workbook) or ship_from", null, "ship_to", "", "Material acquisition"],
  ["min_recyclable_size_cm", "Gate 5: both length and width at least", 5, null, "cm", "End of life"],
  ["coating_end_of_life","Coating mass in end of life: include (PEF Logic CO2e) or exclude (Impact Calc single score)", null, "include", "", "End of life"],
  ["spot_print_coverage_percent", "Coating coverage for SPOT print processes", 10, null, "%", "Material acquisition"],
];
params.forEach(([code, name, value, text, unit, stage], i) => add("pef_parameters", code, name, { seq: i + 1, value, text_value: text, unit, stage }));

// ---------------------------------------------------------------- Grade letters (provisional: see PORT-02)
// Impact Grade is a 0-100 score (parameters score_full_mpt / score_zero_mpt) shown as a letter A-E (System X deck).
[["A", 80, "Leading"], ["B", 60, "Good"], ["C", 40, "Average"], ["D", 20, "Below average"], ["E", 0, "Poor"]].forEach(([letter, min, label], i) =>
  add("pef_grade_bands", letter, `Grade ${letter}`, { seq: i + 1, letter, min_score: min, label, confirmed: false }));

// ---------------------------------------------------------------- ecoinvent factors (only the referenced activities)
let ecoRows = 0;
for (let r = 6; r <= 26538; r++) {
  const act = s(eco.get(`C${r}`)); const rp = s(eco.get(`E${r}`));
  if (!act || !referenced.has(`${act}|${rp}`.toLowerCase())) continue;
  const geo = s(eco.get(`D${r}`));
  // Impacts are flat fields named by category code, so the Watchtower's CSV import can load the full dataset.
  const impacts = {}; for (const c of catCols) impacts[c.code] = n(eco.get(`${c.col}${r}`)) ?? 0;
  add("pef_ecoinvent", `${act}|${rp}|${geo}`, act, {
    seq: r, activity: act, reference_product: rp, geography: geo, unit: s(eco.get(`F${r}`)), reference_amount: n(eco.get(`G${r}`)) ?? 1,
    dataset: "ecoinvent 3.12 cut-off", uuid: s(eco.get(`B${r}`)), ...impacts,
  });
  ecoRows++;
}
const foundPairs = new Set((libs.pef_ecoinvent ?? []).map((e) => `${e.data.activity}|${e.data.reference_product}`.toLowerCase()));
const missingPairs = [...referenced].filter((p) => !foundPairs.has(p));

// ---------------------------------------------------------------- Golden rows (PEF Logic worked examples)
const pl = wb.sheet("PEF Logic");
const g = (col, r) => pl.get(`${col}${r}`);
const golden = [];
for (let r = 6; r <= 17; r++) {
  if (typeof g("A", r) !== "number") continue;
  const comp = (name, w, rec, coat, coatKg, coatM2, gate5) => (s(g(name, r)) && s(g(name, r)) !== "0" ? {
    name: s(g(name, r)), weightKg: n(g(w, r)) ?? 0, recycledPercent: typeof g(rec, r) === "number" ? g(rec, r) * 100 : g(rec, r) === false ? 0 : null,
    coating: na(g(coat, r)) && s(g(coat, r)) !== "0" ? s(g(coat, r)) : null, coatingKg: n(g(coatKg, r)), coatingM2: n(g(coatM2, r)),
    atLeastMinSize: s(g(gate5, r)) === "Y",
  } : null);
  golden.push({
    label: `Worked example ${golden.length + 1} (PEF Logic row ${r})`,
    input: {
      shipFrom: s(g("B", r)), shipTo: s(g("C", r)), factoryRenewable: s(g("F", r)) === "Yes", supplierType: s(g("G", r)),
      components: [
        comp("P", "Q", "AD", "AJ", "AL", "AM", "AS"),
        comp("AU", "AV", "BI", "BO", "BQ", "BR", "BX"),
        comp("BZ", "CA", "CN", "CT", "CV", "CW", "DC"),
      ].filter(Boolean),
      printing: na(g("DJ", r)) && s(g("DJ", r)) !== "None" ? { type: s(g("DJ", r)), areaM2: n(g("DK", r)) ?? 0 } : null,
      branding: na(g("DO", r)) && s(g("DO", r)) !== "None" ? { type: s(g("DO", r)), areaM2: n(g("DP", r)) ?? 0 } : null,
      transport: { mode: s(g("DV", r)), roadOriginKm: n(g("DX", r)) ?? 0, roadDestinationKm: n(g("DY", r)) ?? 0, seaKm: n(g("EA", r)) ?? 0, airKm: n(g("EB", r)) ?? 0, truckClass: s(g("DZ", r)) },
      usageHours: n(g("EH", r)),
      electronics: { source: s(g("EI", r)), kwhPerHour: n(g("EJ", r)) ?? 0 },
      lighting: { source: s(g("EM", r)), kwhPerHour: n(g("EN", r)) ?? 0 },
      easySeparation: s(g("ES", r)) === "Y",
    },
    expected: {
      materialByComponent: [n(g("AT", r)), n(g("BY", r)), n(g("DD", r))].filter((v) => v !== null),
      material: n(g("DE", r)), forming: n(g("DH", r)), printing: n(g("DM", r)), branding: n(g("DR", r)), manufacturing: n(g("DS", r)),
      distribution: n(g("EG", r)), electronics: n(g("EL", r)), lighting: n(g("EP", r)), use: n(g("EQ", r)),
      incineration: n(g("EU", r)), landfill: n(g("EV", r)), endOfLife: n(g("EW", r)), totalGwp: n(g("EX", r)),
      categories: Object.fromEntries(catCols.map((c, i) => [c.code, n(g(colLetter(colIndex("EY") + i), r))])),
      singleScorePt: n(g("GF", r)), singleScoreMpt: n(g("GG", r)),
      gates: { mono: s(g("ER", r)), easySeparation: s(g("ES", r)) },
    },
  });
}

golden.forEach((x, i) => add("pef_worked_examples", `WE-${String(i + 1).padStart(2, "0")}`, x.input.components.map((c) => c.name).join(" + "), {
  seq: i + 1, description: `${x.label}: ${x.input.shipFrom} to ${x.input.shipTo}, ${x.input.supplierType}${x.input.factoryRenewable ? ", renewable factory" : ""}`,
  input: x.input, expected: x.expected,
}));

// ---------------------------------------------------------------- Write files
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
const order = ["pef_impact_categories", "pef_grade_bands", "pef_parameters", "pef_methodology", "pef_open_issues", "pef_virgin_materials", "pef_recycled_materials",
  "pef_coatings", "pef_custom_factors", "pef_process_energy", "pef_process_labels", "pef_energy_activities", "pef_process_efficiency", "pef_transport_activities",
  "pef_use_electricity", "pef_eol_materials", "pef_eol_fate", "pef_eol_treatment", "pef_countries", "pef_usage_periods", "pef_ecoinvent", "pef_worked_examples"];
let sql = `-- Impact Grade (PEF) Watchtower libraries. GENERATED by scripts/impact-grade/build-seed.mjs from the Anthesis
-- "PEF Logic" workbook: do not edit by hand; change the libraries in the Watchtower (versioned, audited) or regenerate.
-- ecoinvent 3.12 cut-off factors: only the activities the mapping tables reference (${ecoRows} rows). Licensed data:
-- load the full dataset per environment through the Watchtower import, never into a public repository.\n\n`;
for (const key of order) {
  const list = libs[key] ?? [];
  sql += `-- ${key}: ${list.length} records\n`;
  for (let i = 0; i < list.length; i += 400) {
    sql += "insert into public.library_records (library_key, code, name, data, status, effective_from, notes) values\n";
    sql += list.slice(i, i + 400).map((x) => `(${sqlStr(key)},${sqlStr(x.code)},${sqlStr(x.name)},${sqlStr(JSON.stringify(x.data))}::jsonb,'active','2026-01-01',null)`).join(",\n");
    sql += ";\n";
  }
  sql += "\n";
}
const seedPath = join(root, "supabase", "seed", "m99_impact_grade.sql");
writeFileSync(seedPath, sql, "utf8");
const fixturePath = join(root, "tests", "fixtures", "pef_golden.json");
mkdirSync(dirname(fixturePath), { recursive: true });
writeFileSync(fixturePath, JSON.stringify(golden, null, 2) + "\n", "utf8");

console.log(order.map((k) => `${k.padEnd(26)} ${(libs[k] ?? []).length}`).join("\n"));
console.log(`\nseed: ${seedPath} (${(sql.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`golden rows: ${golden.length} -> ${fixturePath}`);
if (missingPairs.length) console.log(`\nReferenced activities with no ecoinvent row (${missingPairs.length}):\n  ` + missingPairs.slice(0, 15).join("\n  "));
