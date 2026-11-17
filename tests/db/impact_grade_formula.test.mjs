// Impact Grade formula ("Impact Grade.xlsx", ImpactGrade sheet): weights, sub-score rules, the PEF scaling against
// the 95th percentile of our PEF scores, and coverage. Scenarios are worked by hand from the sheet's rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDb } from "./helpers.mjs";
import { computeImpactGrade, indexImpactGrade, percentile } from "../../src/lib/impact-grade.ts";

const root = join(import.meta.dirname, "..", "..");
const t = await setupDb();
await t.db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
for (const f of ["m99_impact_grade.sql", "m99_impact_grade_formula.sql"]) await t.db.exec(readFileSync(join(root, "supabase", "seed", f), "utf8"));
const { rows } = await t.asSuper("select library_key, code, name, data from public.library_records where status = 'active' and (library_key like 'ig\\_%' or library_key in ('pef_grade_bands', 'pef_eol_materials', 'pef_worked_examples'))");
const libs = {};
for (const r of rows) (libs[r.library_key] ??= []).push(r);
const ix = indexImpactGrade(libs);
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.05, `${label}: got ${a}, expected ${b}`);

// A board display: 1 kg folding cardboard, 50% recycled, 12-24 months, reusable, not modular, no finishing,
// optimal size, FSC 100%, vegetable inks, no electronics, PEF 0.2 mPt.
const board = {
  specType: "3d", components: [{ name: "Folding Cardboard", weightKg: 1, recycledPercent: 50 }],
  activationPeriod: "12 - 24 months", reusable: true, modular: false, easySeparation: false, finishing: [],
  optimalSize: true, accreditation: "Forest - FSC 100%", inks: "Vegetable Inks", varnish: null, electronics: "No", oekoTex: null, pefMpt: 0.2,
};

test("weights add up to 100, standard and Promo", () => {
  const sum = (k) => ix.subscores.reduce((a, r) => a + (Number(r.data[k]) || 0), 0);
  assert.equal(sum("weight_standard"), 100);
  assert.equal(sum("weight_promo"), 100);
  assert.equal(ix.subscores.find((r) => r.code === "PEF").data.weight_standard, 50, "the PEF score is half the grade");
});

test("each sub-score follows the sheet's rule", () => {
  const r = computeImpactGrade(board, ix);
  const s = Object.fromEntries(r.subScores.map((x) => [x.code, x.score]));
  assert.equal(s.DURABILITY, 60, "12-24 months is impact level 2 = 60");
  assert.equal(s.REUSABILITY, 100);
  assert.equal(s.REPAIRABILITY, 0);
  assert.equal(s.RECYCLABILITY, 100, "mono-material, technically recyclable, no finishing");
  assert.equal(s.RESOURCE_USE, 100, "optimal size, plastic free, certified");
  near(s.SUBSTANCES, 93.3, "no harmful substrate 100, vegetable inks level 1 = 80, no electronics 100");
  assert.equal(s.RECYCLED_CONTENT, 50);
  near(s.PEF, 100 * (1 - 0.2 / ix.pefReference), "PEF scaled against the 95th percentile");
});

test("the grade is the weighted sum; Promo uses Promo weights and drops reuse and repair", () => {
  const std = computeImpactGrade(board, ix);
  near(std.score, 66.4, "standard");
  assert.equal(std.letter.letter, "B");
  assert.equal(std.confirmed, true);
  const promo = computeImpactGrade({ ...board, specType: "promo_merch" }, ix);
  assert.equal(promo.promo, true);
  near(promo.score, 72.4, "promo");
  assert.equal(promo.subScores.find((x) => x.code === "REUSABILITY").weight, null);
});

test("finishing or an inseparable mix makes it non-recyclable; PVC and plastic cost points", () => {
  assert.equal(computeImpactGrade({ ...board, finishing: ["Gloss Lamination"] }, ix).subScores.find((x) => x.code === "RECYCLABILITY").score, 0);
  const pvc = computeImpactGrade({ ...board, components: [...board.components, { name: "PVC Frontlit", weightKg: 0.5 }] }, ix);
  const s = Object.fromEntries(pvc.subScores.map((x) => [x.code, x.score]));
  assert.equal(s.RECYCLABILITY, 0, "multi-material that does not separate");
  assert.ok(s.SUBSTANCES < 93, "harmful substrate");
  assert.ok(s.RESOURCE_USE < 100, "not plastic free");
});

test("without a PEF score the grade is provisional (half the weight has no data)", () => {
  const r = computeImpactGrade({ ...board, pefMpt: null }, ix);
  assert.equal(r.confirmed, false);
  assert.ok(r.coverage <= 0.5 + 1e-9);
  assert.ok(r.missing.some((m) => /PEF/.test(m)));
});

test("the PEF reference is the 95th percentile of our PEF scores, recalculated in the database", async () => {
  const { rows: [{ v }] } = await t.as("plain", "select public.ig_pef_reference_suggestion() v");
  assert.equal(v.basis, "worked_examples");
  near(v.reference_mpt * 1000, ix.pefReference * 1000, "suggestion matches the seeded reference");
  const examples = libs.pef_worked_examples.map((e) => Number(e.data.expected.singleScoreMpt));
  near(percentile(examples, 95) * 1000, Number(v.reference_mpt) * 1000, "same percentile method as the engine");
});
