// Impact Grade Watchtower: the PEF libraries, who can change them, and the engine against the workbook.
// The engine (src/lib/pef.ts) is checked against the Anthesis "PEF Logic" worked examples: same inputs, the
// libraries as seeded, results must match Excel per stage, per impact category and for the single score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDb } from "./helpers.mjs";
import { computePef, indexLibraries, letterFor, PEF_CATEGORIES } from "../../src/lib/pef.ts";

const root = join(import.meta.dirname, "..", "..");
const golden = JSON.parse(readFileSync(join(root, "tests", "fixtures", "pef_golden.json"), "utf8"));

const t = await setupDb();
await t.db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
await t.db.exec(readFileSync(join(root, "supabase", "seed", "m99_impact_grade.sql"), "utf8"));

async function loadLibraries() {
  const { rows } = await t.asSuper("select r.library_key, r.code, r.name, r.data from public.library_records r join public.library_definitions d on d.key = r.library_key where d.module = 'impact-grade' and r.status = 'active'");
  const libs = {};
  for (const r of rows) (libs[r.library_key] ??= []).push({ code: r.code, name: r.name, data: r.data });
  return libs;
}
const libs = await loadLibraries();
const ix = indexLibraries(libs);
// The workbook's two sheets disagree on coating end of life (open issue PORT-05): PEF Logic (CO2e by stage)
// includes it, Impact Calc (16 categories, single score) leaves it out. Check each against its own setting.
const ixImpactCalc = indexLibraries({
  ...libs,
  pef_parameters: libs.pef_parameters.map((p) => (p.code === "coating_end_of_life" ? { ...p, data: { ...p.data, text_value: "exclude" } } : p)),
});

/** Relative closeness, with an absolute floor for values that are effectively zero. */
function close(actual, expected, label) {
  const tol = Math.max(Math.abs(expected) * 1e-6, 1e-12);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, Excel ${expected}`);
}

test("libraries are registered under the Impact Grade section", async () => {
  const { rows } = await t.asSuper("select key from public.library_definitions where module = 'impact-grade' order by key");
  const keys = rows.map((r) => r.key);
  for (const k of ["pef_impact_categories", "pef_grade_bands", "pef_parameters", "pef_methodology", "pef_open_issues", "pef_ecoinvent", "pef_eol_fate", "impact_grade_dimensions"]) {
    assert.ok(keys.includes(k), `${k} is an Impact Grade library`);
  }
  assert.equal(libs.pef_impact_categories.length, 16);
  const weights = libs.pef_impact_categories.reduce((a, r) => a + Number(r.data.weighting_factor), 0);
  close(weights, 1, "EF 3.1 weighting factors add up to 100%");
});

test("staff read the libraries; only admins or Impact Grade owners change them, and result-moving ones need a second person", async () => {
  const { rows: seen } = await t.as("plain", "select count(*)::int n from public.library_records where library_key = 'pef_parameters'");
  assert.ok(seen[0].n >= 10);
  await t.rejects(t.as("plain", "select public.library_create('pef_parameters', 'x_test', 'Test', '{\"value\":1}'::jsonb, null, null)"), /owners can change/);
  const { rows: [{ id }] } = await t.as("admin", "select public.library_create('pef_parameters', 'x_test', 'Test', '{\"value\":1}'::jsonb, null, null) id");
  const { rows: [rec] } = await t.asSuper("select status from public.library_records where id = $1", [id]);
  assert.equal(rec.status, "pending_approval", "parameters are maker-checker");
  await t.rejects(t.as("admin", "select public.library_approve($1, true, null)", [id]), /different person/);
  await t.as("admin2", "select public.library_approve($1, true, 'checked')", [id]);
  const { rows: [after] } = await t.asSuper("select status from public.library_records where id = $1", [id]);
  assert.equal(after.status, "active");
  const { rows: audit } = await t.asSuper("select action from public.library_audit where record_id = $1 order by at", [id]);
  assert.deepEqual(audit.map((a) => a.action), ["create", "approve"]);
});

for (const g of golden) {
  test(`engine matches the workbook: ${g.label}`, () => {
    const r = computePef(g.input, ix);
    const e = g.expected;
    const gwp = (v) => v.GWP;
    close(gwp(r.stages.material), e.material, "material acquisition (kg CO2e)");
    close(gwp(r.steps.forming ?? r.stages.manufacturing), e.forming, "forming");
    close(gwp(r.steps.printing), e.printing, "printing");
    close(gwp(r.steps.branding), e.branding, "branding");
    close(gwp(r.stages.manufacturing), e.manufacturing, "manufacturing");
    close(gwp(r.stages.distribution), e.distribution, "distribution");
    close(gwp(r.stages.use), e.use, "use");
    close(gwp(r.steps.incineration), e.incineration, "incineration");
    close(gwp(r.steps.landfill), e.landfill, "landfill");
    close(gwp(r.stages.end_of_life), e.endOfLife, "end of life");
    close(gwp(r.total), e.totalGwp, "total kg CO2e");
    const s = computePef(g.input, ixImpactCalc);
    for (const c of PEF_CATEGORIES) close(s.total[c], e.categories[c], `category ${c}`);
    close(s.singleScorePt, e.singleScorePt, "single score (Pt)");
    close(s.singleScoreMpt, e.singleScoreMpt, "single score (mPt)");
    assert.equal(r.product.mono ? "Y" : "N", e.gates.mono, "gate 2 mono-material");
  });
}

test("a specification can have more than the workbook's three substrates", () => {
  const base = golden[0].input;
  const extra = [{ name: "Folding Cardboard", weightKg: 0.01, recycledPercent: null, atLeastMinSize: true }, { name: "Silicone", weightKg: 0.005, recycledPercent: 0, atLeastMinSize: true }];
  const three = computePef(base, ix);
  const five = computePef({ ...base, components: [...base.components, ...extra] }, ix);
  assert.equal(five.components.length, 5);
  assert.ok(five.stages.material.GWP > three.stages.material.GWP, "extra substrates add material impact");
  assert.ok(five.stages.end_of_life.GWP > three.stages.end_of_life.GWP, "and end-of-life impact");
});

test("a zero from a missing mapping is reported, not passed off as no impact", () => {
  const r = computePef({ shipFrom: "GB", shipTo: "FR", factoryRenewable: false, supplierType: "Manufacturer",
    components: [{ name: "Unobtainium", weightKg: 1 }] }, ix);
  assert.ok(r.warnings.some((w) => /Unobtainium/.test(w)), "missing substrate is flagged");
  assert.equal(r.stages.material.GWP, 0);
});

test("the PEF engine gives the PEF score only; an Impact Grade (0-100) maps to a letter A-E", () => {
  const r = computePef(golden[0].input, ix);
  assert.equal(r.grade, undefined, "no grade is invented from the PEF score");
  assert.equal(ix.bands.length, 5);
  assert.equal(letterFor(85, ix.bands).letter, "A");
  assert.equal(letterFor(45, ix.bands).letter, "C");
  assert.equal(letterFor(5, ix.bands).letter, "E");
  assert.equal(letterFor(45, ix.bands).confirmed, false, "letters are provisional until approved");
});

test("spec Impact Grades are on the 0-100 scale", async () => {
  const { rows } = await t.asSuper("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'job_specs_impact_grade_check'");
  assert.match(rows[0].d, /100/);
  const { rows: kpi } = await t.asSuper("select data->>'unit' u from public.library_records where library_key = 'scorecard_kpis' and code = 'SUSTAINABILITY_SCORE'");
  assert.equal(kpi[0].u, "score100");
});
