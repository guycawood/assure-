// Builds the Impact Grade formula libraries from "Impact Grade.xlsx" (ImpactGrade, Dropdown List, Substrate List).
//
//   node scripts/impact-grade/build-grade-seed.mjs "<path to Impact Grade.xlsx>"
//
// Writes supabase/seed/m99_impact_grade_formula.sql. Impact Grade = Σ weight × sub-score (0-100), standard or Promo
// weights; the Environmental footprint sub-score comes from the PEF score scaled against the 95th percentile of our
// own PEF results (decision 5 Nov 2026). Client-specific sheets (L'Oreal, Nestlé, Adidas, GDT extracts) are not copied.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openWorkbook } from "./xlsx.mjs";

const src = process.argv[2];
if (!src) { console.error("Usage: node scripts/impact-grade/build-grade-seed.mjs <Impact Grade.xlsx>"); process.exit(1); }
const root = join(import.meta.dirname, "..", "..");
const wb = openWorkbook(src);
const s = (v) => (v === undefined || v === null ? "" : String(v).replace(/ /g, " ").trim());
const n = (v) => (typeof v === "number" ? v : Number.isFinite(Number(v)) && s(v) !== "" ? Number(v) : null);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
const libs = {};
const add = (key, code, name, data) => {
  const list = (libs[key] ??= []);
  let c = s(code); let k = 2;
  while (list.some((x) => x.code === c)) c = `${s(code)} (${k++})`;
  list.push({ code: c, name: s(name) || c, data: clean(data) });
};

// ---------------------------------------------------------------- Sub-scores and weights (ImpactGrade sheet)
const ig = wb.sheet("ImpactGrade");
const sub = [
  // code, category, row of the sub-category, rows of its items, scoring rule summary
  ["DURABILITY", "Circular design", 2, [2], "Life expectancy (activation period) mapped to an impact level: longer is better."],
  ["REUSABILITY", "Circular design", 3, [3], "Designed for reuse and second-life use: yes 100, no 0."],
  ["REPAIRABILITY", "Circular design", 4, [4], "Designed to be modular (replaceable components): yes 100, no 0."],
  ["RECYCLABILITY", "Circular design", 5, [5, 6, 7, 8], "Recyclable % of the weight. Not recyclable when there is any finishing or decoration, or when multi-material parts do not separate easily."],
  ["RESOURCE_USE", "Resource use & efficiency", 9, [9, 10, 11], "Average of: optimal size and weight (yes 100), plastic free (no plastic 100), certified material (certified 100)."],
  ["SUBSTANCES", "Resource use & efficiency", 12, [12, 13, 14, 15, 16], "Average of the items that apply: harmful substrates (PVC, BPA, PU foam...), inks, varnish, electronics, OEKO-TEX for textiles."],
  ["RECYCLED_CONTENT", "Resource use & efficiency", 17, [17], "Exact post-consumer recycled content, weighted by mass."],
  ["PEF", "Environmental footprint", 18, [18], "PEF score scaled 0-100 against the reference: 100 × (1 − PEF mPt ÷ reference), floored at 0. Reference = 95th percentile of our PEF results."],
  ["SUPPLIER", "Supplier score", 19, [19], "Work in progress: supplier sustainability scoring (CSR, EMS, FSC, Sedex, diverse supplier, renewable energy). Weight 0 until agreed."],
  ["LOGISTICS", "Logistics", 20, [20], "Work in progress: flat packed, local, no plastic. Weight 0 until agreed."],
];
sub.forEach(([code, category, r, items, rule], i) => {
  const w = n(ig.get(`K${r}`)); const p = ig.get(`L${r}`);
  add("ig_subscores", code, s(ig.get(`C${r}`)) || s(ig.get(`A${r}`)).replace(/^\d+\.\s*/, "") || code, {
    seq: i + 1, category, espr_aligned: s(ig.get(`D${r}`)) === "Yes", description: s(ig.get(`E${r}`)),
    data_inputs: items.map((x) => s(ig.get(`F${x}`))).filter(Boolean), rule,
    weight_standard: w ?? 0, weight_promo: s(p).toUpperCase() === "N/A" ? null : n(p) ?? 0,
    status: code === "SUPPLIER" || code === "LOGISTICS" ? "work_in_progress" : "live",
    workbook_notes: s(ig.get(`N${r}`)),
  });
});

// ---------------------------------------------------------------- Impact levels (Dropdown List legend)
const dd = wb.sheet("Dropdown List");
for (let r = 24; r <= 29; r++) add("ig_impact_levels", String(n(dd.get(`A${r}`))), dd.get(`B${r}`), { seq: r - 23, level: n(dd.get(`A${r}`)), score: n(dd.get(`D${r}`)) });

/** Shortest life in days for an activation period label ("1 -3 months" -> 30, "More than 2 year" -> 720). */
function minDays(label) {
  const t = label.toLowerCase();
  if (t.startsWith("more than")) return 720;
  const m = /(\d+)\s*(?:-\s*\d+\s*)?(day|week|month|year)/.exec(t.replace(/\s+/g, " "));
  if (!m) return null;
  return Number(m[1]) * { day: 1, week: 7, month: 30, year: 360 }[m[2]];
}

// ---------------------------------------------------------------- Scored options (Dropdown List columns)
const options = [
  ["ink", "Inks", "E", "F", 6, 19, "all"], ["varnish", "Varnish", "G", "H", 6, 17, "all"],
  ["finishing", "Finishing / decoration (coating)", "I", "J", 6, 15, "promo_3d"], ["finish_type_2d", "Finish type (2D)", "M", "N", 6, 21, "2d"],
  ["accreditation", "Material accreditation", "S", "T", 6, 21, "all"], ["activation_period", "Period of activation", "V", "W", 6, 15, "all"],
  ["electronics", "Electronics", "A", "B", 6, 9, "promo_3d"],
];
for (const [kind, label, lc, nc, from, to, appliesTo] of options) {
  for (let r = from; r <= to; r++) {
    const name = s(dd.get(`${nc}${r}`)); const lvl = n(dd.get(`${lc}${r}`));
    if (!name || lvl === null || /MADE MANDATORY|^Number$|^Score$/i.test(name)) continue;
    add("ig_option_scores", `${kind}|${name}`, name, clean({
      seq: r, kind, kind_label: label, level: lvl, applies_to: appliesTo,
      material_group: kind === "accreditation" ? s(dd.get(`U${r}`)) : undefined,
      min_days: kind === "activation_period" ? minDays(name) : undefined,
      // Accreditations are listed with level 0: any certification scores 100 (ImpactGrade item 10).
    }));
  }
}

// ---------------------------------------------------------------- Substrates: harmful and plastic flags (Substrate List)
const sl = wb.sheet("Substrate List");
for (let r = 2; r <= 360; r++) {
  const name = s(sl.get(`A${r}`)); if (!name) continue;
  const action = s(sl.get(`C${r}`)).toUpperCase();
  if (action === "REMOVE") continue;
  const category = s(sl.get(`E${r}`)); const harmful = s(sl.get(`H${r}`));
  add("ig_substrates", name, name, {
    seq: r, category, plastic: /plastic/i.test(category) || s(sl.get(`F${r}`)) !== "", plastic_type: s(sl.get(`F${r}`)),
    resin_code: s(sl.get(`G${r}`)), harmful: harmful !== "" && !/^no$/i.test(harmful), harmful_note: harmful,
  });
}

// ---------------------------------------------------------------- Parameters
// PEF reference: 95th percentile of our PEF results. Seeded from the six Anthesis worked examples (the only PEF results
// available today); the Watchtower recalculates it from stored results and the new value needs a second approver.
const examplesMpt = [0.07842024422773423, 0.07203738481052882, 0.7235168989863511, 0.2177481976449503, 0.21700491226946052, 0.2148046823069036];
const sorted = [...examplesMpt].sort((a, b) => a - b);
const p95 = (() => { const i = 0.95 * (sorted.length - 1); const lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo); })();
[
  ["pef_reference_mpt", "PEF reference: 95th percentile of our PEF scores (mPt)", Math.round(p95 * 1e6) / 1e6, null, "mPt", "Seeded from the 6 Anthesis worked examples. Recalculate from stored PEF results in the Watchtower; a second person approves."],
  ["pef_reference_percentile", "Percentile used for the PEF reference", 95, null, "%", "Decision 5 Nov 2026 (workbook option: percentile from our dataset)."],
  ["promo_spec_types", "Spec types scored with Promo weights", null, "promo_merch", "", "Comma separated spec types."],
  ["min_coverage", "Minimum share of the weight with data for a confirmed grade", 80, null, "%", "Below this the grade shows as provisional (System X: confidence grows as data is collected)."],
].forEach(([code, name, value, text, unit, note], i) => add("ig_parameters", code, name, { seq: i + 1, value, text_value: text, unit, note }));

// ---------------------------------------------------------------- Open items (from the workbook's comments)
[
  ["IG-01", "PEF to 0-100 scaling", "decided", "Workbook listed four options for the maximum. Decided 5 Nov 2026: 95th percentile of our own PEF results.", "Recalculate the reference as PEF results build up; seeded from 6 worked examples only."],
  ["IG-02", "Durability mapping tops out at 80", "open", "Activation periods are mapped to impact levels 5 (1 day) to 1 (more than 2 years); level 1 scores 80, so no item reaches 100.", "Confirm whether more than 2 years should score 100, or add a level-0 band."],
  ["IG-03", "How items combine inside a sub-score", "open", "Resource use (3 items) and substances of concern (up to 5 items) have one weight each; the workbook does not say how the items combine.", "System Guy averages the items that apply. Confirm or set item weights."],
  ["IG-04", "Supplier score and Logistics", "open", "Both are work in progress with weight 0 (waiting for procurement feedback).", "Agree the scoring and weights; SRM already holds supplier sustainability scores."],
  ["IG-05", "Recyclable % assumptions", "open", "Recyclable % should align with GDT assumptions; lamination fields differ between 2D and 3D.", "Agree the recyclable % per material with Anthesis/GDT."],
  ["IG-06", "Electronics rule needs life expectancy", "open", "Electronics score 0 when life expectancy is under 3 months; otherwise solar, DC power or batteries for permanent items score 50, else 0.", "Confirm the 'permanent' threshold and the L'Oreal assumptions it refers to."],
].forEach(([code, name, status, why, next], i) => add("ig_open_items", code, name, { seq: i + 1, status, why, next_step: next }));

// ---------------------------------------------------------------- Write
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
let sql = `-- Impact Grade formula libraries. GENERATED by scripts/impact-grade/build-grade-seed.mjs from "Impact Grade.xlsx"
-- (ImpactGrade, Dropdown List, Substrate List). Change them in the Impact Grade Watchtower or regenerate.\n\n`;
for (const [key, list] of Object.entries(libs)) {
  sql += `-- ${key}: ${list.length} records\ninsert into public.library_records (library_key, code, name, data, status, effective_from, notes) values\n`;
  sql += list.map((x) => `(${sqlStr(key)},${sqlStr(x.code)},${sqlStr(x.name)},${sqlStr(JSON.stringify(x.data))}::jsonb,'active','2026-01-01',null)`).join(",\n") + ";\n\n";
}
writeFileSync(join(root, "supabase", "seed", "m99_impact_grade_formula.sql"), sql, "utf8");
console.log(Object.entries(libs).map(([k, v]) => `${k.padEnd(18)} ${v.length}`).join("\n"));
console.log("PEF reference (P95 of worked examples):", p95);
console.log(libs.ig_subscores.map((x) => `${x.code}: ${x.data.weight_standard}/${x.data.weight_promo ?? "n/a"}`).join(" · "));
