// Builds the Shopper IQ design effectiveness libraries from "ShopperIQ Design Effectiveness Model v1_1.xlsx".
//
//   node scripts/shopper-iq/build-seed.mjs "<path to the workbook>"
//
// Writes supabase/seed/m33_shopper_iq_design.sql (criteria, parameters, bands, asset types, open items, the worked
// example) and tests/fixtures/design_golden.json (the Scorecard example: answers and the results Excel gives).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openWorkbook } from "../impact-grade/xlsx.mjs";

const src = process.argv[2];
if (!src) { console.error("Usage: node scripts/shopper-iq/build-seed.mjs <workbook.xlsx>"); process.exit(1); }
const root = join(import.meta.dirname, "..", "..");
const wb = openWorkbook(src);
const s = (v) => (v === undefined || v === null ? "" : String(v).trim());
const n = (v) => (typeof v === "number" ? v : Number.isFinite(Number(v)) && s(v) !== "" ? Number(v) : null);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
const libs = {};
const add = (key, code, name, data) => (libs[key] ??= []).push({ code: s(code), name: s(name) || s(code), data: clean(data) });

// ---------------------------------------------------------------- Criteria (27 design + 11 sustainability)
const cr = wb.sheet("Criteria");
for (let r = 5; r <= 42; r++) {
  const id = s(cr.get(`A${r}`));
  if (!/^[DS]\d\d$/.test(id)) continue;
  add("siq_de_criteria", id, cr.get(`D${r}`), {
    seq: r - 4, block: s(cr.get(`B${r}`)).toLowerCase(), pillar: s(cr.get(`C${r}`)).toLowerCase(),
    what_assessed: s(cr.get(`E${r}`)), high_score: s(cr.get(`F${r}`)), weight: n(cr.get(`G${r}`)), weight_basis: s(cr.get(`H${r}`)),
    applies_key_visual: s(cr.get(`I${r}`)) === "Y", applies_posm: s(cr.get(`J${r}`)) === "Y", applies_gwp: s(cr.get(`K${r}`)) === "Y",
    source: s(cr.get(`L${r}`)), legacy_reference: s(cr.get(`M${r}`)), note: s(cr.get(`N${r}`)),
    calibrated: false, // README: "Weights are not calibrated" (open item DE-02)
    // S11 is scored from the Impact Grade (0-100 ÷ 100), not from an answer.
    input: id === "S11" ? "impact_grade" : "answer",
  });
}

// ---------------------------------------------------------------- Parameters, answer scale, bands, asset types
const p = wb.sheet("Parameters");
add("siq_de_parameters", "sustainability_weight", "Sustainability sub-score weight (w)", { seq: 1, value: n(p.get("B4")), note: s(p.get("C4")) });
add("siq_de_parameters", "min_coverage", "Minimum answered share of applicable weight", { seq: 2, value: n(p.get("B36")), note: s(p.get("C36")) });
add("siq_de_parameters", "visual_element_threshold", "Visual elements threshold (criterion D03)", { seq: 3, value: 4, note: "OpenItems #9: Golden Rules and Emotive V2 used 5; POS Guidelines used 4." });
for (let r = 8; r <= 12; r++) {
  const ans = s(p.get(`A${r}`)); const v = p.get(`B${r}`);
  add("siq_de_answers", ans, ans, { seq: r - 7, value: typeof v === "number" ? v : null, counts: typeof v === "number", rule: s(p.get(`C${r}`)) });
}
for (let r = 16; r <= 19; r++) add("siq_de_bands", s(p.get(`A${r}`)).toLowerCase().replace(/\s+/g, "_"), p.get(`A${r}`), { seq: r - 15, min_score: n(p.get(`B${r}`)), confirmed: false });
[["key_visual", "Key Visual"], ["posm", "POSM"], ["gwp", "GWP & Premiums"]].forEach(([code, name], i) => add("siq_de_asset_types", code, name, { seq: i + 1, applies_field: `applies_${code}` }));

// ---------------------------------------------------------------- Open items
const oi = wb.sheet("OpenItems");
for (let r = 4; r <= 15; r++) {
  if (n(oi.get(`A${r}`)) === null) continue;
  add("siq_de_open_items", `DE-${String(oi.get(`A${r}`)).padStart(2, "0")}`, oi.get(`B${r}`), {
    seq: n(oi.get(`A${r}`)), why: s(oi.get(`C${r}`)), proposed_default: s(oi.get(`D${r}`)), owner: s(oi.get(`E${r}`)), status: s(oi.get(`F${r}`)).toLowerCase(),
  });
}
add("siq_de_open_items", "DE-13", "Impact Grade scale aligned to 0-100 (S11)", {
  seq: 13, why: "S11 reads the Impact Grade as 0-100; System Guy specs held 0-10 and the System X deck shows letters A-E.",
  proposed_default: "Impact Grade is a 0-100 score shown as A-E; S11 = score ÷ 100, from the linked spec when there is one, otherwise entered by hand (marked assumed).",
  owner: "TBC", status: "decided",
});

// ---------------------------------------------------------------- Worked example (Scorecard sheet)
const sc = wb.sheet("Scorecard");
const answers = {};
for (let r = 26; r <= 63; r++) {
  const id = s(sc.get(`A${r}`)); const a = s(sc.get(`G${r}`));
  if (/^[DS]\d\d$/.test(id) && a) answers[id] = { answer: a, note: s(sc.get(`L${r}`)) || undefined };
}
const typeCode = { "Key Visual": "key_visual", POSM: "posm", "GWP & Premiums": "gwp" }[s(sc.get("G3"))];
const example = {
  label: `Worked example: ${s(sc.get("G4"))}`,
  input: { assetType: typeCode, impactGrade: n(sc.get("G5")), answers },
  expected: {
    attract: n(sc.get("G9")), engage: n(sc.get("G10")), sell: n(sc.get("G11")), design: n(sc.get("G12")), sustainability: n(sc.get("G13")),
    overall: n(sc.get("G18")), band: s(sc.get("G19")), coverageDesign: n(sc.get("G20")), coverageSustainability: n(sc.get("G21")), valid: s(sc.get("G22")) === "OK",
  },
};
add("siq_de_examples", "DEX-01", s(sc.get("G4")), { seq: 1, description: "Illustrative POSM example from the workbook (D01-D15 from the RetailGrade POS Guidelines).", ...example });

// ---------------------------------------------------------------- Write
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
let sql = `-- Shopper IQ design effectiveness libraries. GENERATED by scripts/shopper-iq/build-seed.mjs from
-- "ShopperIQ Design Effectiveness Model v1_1.xlsx" (draft 30 Oct 2026; weights not calibrated). Change them in the
-- Shopper IQ Watchtower (versioned, audited) or regenerate.\n\n`;
for (const [key, list] of Object.entries(libs)) {
  sql += `-- ${key}: ${list.length} records\ninsert into public.library_records (library_key, code, name, data, status, effective_from, notes) values\n`;
  sql += list.map((x) => `(${sqlStr(key)},${sqlStr(x.code)},${sqlStr(x.name)},${sqlStr(JSON.stringify(x.data))}::jsonb,'active','2026-01-01',null)`).join(",\n") + ";\n\n";
}
writeFileSync(join(root, "supabase", "seed", "m33_shopper_iq_design.sql"), sql, "utf8");
const fx = join(root, "tests", "fixtures", "design_golden.json");
mkdirSync(dirname(fx), { recursive: true });
writeFileSync(fx, JSON.stringify(example, null, 2) + "\n", "utf8");
console.log(Object.entries(libs).map(([k, v]) => `${k.padEnd(20)} ${v.length}`).join("\n"));
console.log(example.expected);
