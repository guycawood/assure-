// Shopper IQ design effectiveness Watchtower: the model's libraries, who can change them, and the scoring against
// the workbook's worked example (ShopperIQ Design Effectiveness Model v1_1.xlsx, Scorecard sheet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDb } from "./helpers.mjs";
import { deFromLibraries, scoreDesign } from "../../src/lib/design-effectiveness.ts";

const root = join(import.meta.dirname, "..", "..");
const golden = JSON.parse(readFileSync(join(root, "tests", "fixtures", "design_golden.json"), "utf8"));
const t = await setupDb();
await t.db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
await t.db.exec(readFileSync(join(root, "supabase", "seed", "m33_shopper_iq_design.sql"), "utf8"));
const { rows } = await t.asSuper("select library_key, code, name, data from public.library_records where library_key like 'siq_de_%' and status = 'active'");
const libs = {};
for (const r of rows) (libs[r.library_key] ??= []).push(r);
const { criteria, settings } = deFromLibraries(libs);

const close = (a, b, label) => assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-9, 1e-12), `${label}: got ${a}, Excel ${b}`);

test("the model is governed as Shopper IQ libraries", async () => {
  assert.equal(criteria.length, 38);
  assert.equal(criteria.filter((c) => c.block === "design").length, 27);
  assert.equal(criteria.find((c) => c.code === "S11").input, "impact_grade", "S11 reads the Impact Grade");
  assert.equal(settings.sustainabilityWeight, 0.25);
  const { rows: defs } = await t.asSuper("select key, requires_approval from public.library_definitions where key like 'siq_de_%'");
  assert.ok(defs.find((d) => d.key === "siq_de_criteria").requires_approval, "criteria changes need a second person");
  await t.rejects(t.as("plain", "select public.library_create('siq_de_parameters', 'x', 'X', '{\"value\":1}'::jsonb, null, null)"), /owners can change/);
});

test("scoring matches the workbook's worked example", () => {
  const r = scoreDesign(golden.input, criteria, settings);
  const e = golden.expected;
  for (const k of ["attract", "engage", "sell", "design", "sustainability", "overall", "coverageDesign", "coverageSustainability"]) close(r[k], e[k], k);
  assert.equal(r.band.name, e.band);
  assert.equal(r.valid, e.valid);
});

test("S11 follows the Impact Grade: no grade means S11 is unknown and lowers sustainability coverage", () => {
  const withGrade = scoreDesign({ ...golden.input, impactGrade: 90 }, criteria, settings);
  const base = scoreDesign(golden.input, criteria, settings);
  assert.ok(withGrade.sustainability > base.sustainability, "a better Impact Grade lifts the sustainability sub-score");
  const none = scoreDesign({ ...golden.input, impactGrade: null }, criteria, settings);
  assert.ok(none.coverageSustainability < 1, "S11 unanswered reduces coverage");
  assert.equal(none.lines.find((l) => l.code === "S11").value, null);
});

test("N/A and Unknown leave the denominator; Partial is half credit", () => {
  const one = (answer) => scoreDesign({ assetType: "posm", impactGrade: null, answers: { D01: { answer } } }, criteria, settings);
  assert.equal(one("Partial").design, 0.5);
  assert.equal(one("N/A").design, null);
  assert.equal(one("Unknown").valid, false);
});
