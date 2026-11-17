// Impact Grade records: one per spec, with evidence tiers, confidence and range, the supplier score from the SRM
// scorecard, edits with a reason, and review by a different person. Engine checks first, then the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDb } from "./helpers.mjs";
import { computeImpactGrade, indexImpactGrade } from "../../src/lib/impact-grade.ts";
import { applyOverrides } from "../../src/lib/impact-grade-fields.ts";
import { supplierSustainabilityScore } from "../../src/lib/impact-grade-supplier.ts";
import { scoreSupplier } from "../../src/lib/scorecard.ts";

const root = join(import.meta.dirname, "..", "..");
const t = await setupDb();
await t.db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
await t.db.exec(readFileSync(join(root, "supabase", "seed", "m99_impact_grade_formula.sql"), "utf8"));
const { rows } = await t.asSuper("select r.library_key, r.code, r.name, r.data from public.library_records r where r.library_key like 'ig\\_%' and r.status = 'active'");
const libs = {};
for (const r of rows) (libs[r.library_key] ??= []).push({ code: r.code, name: r.name, data: r.data });
const ix = indexImpactGrade(libs);
const base = { specType: "2d", components: [{ name: "Corrugated Cardboard", weightKg: 0.2, recycledPercent: 60 }] };

test("tier confidences are governed parameters and rise from Assumed to Verified", () => {
  assert.deepEqual(Object.values(ix.tierConfidence), [20, 40, 65, 85, 95]);
  const at = (tier) => computeImpactGrade({ ...base, tiers: { RECYCLABILITY: tier, SUBSTANCES: tier, RESOURCE_USE: tier, RECYCLED_CONTENT: tier } }, ix);
  const a = at("assumed"); const v = at("verified");
  assert.ok(v.confidence > a.confidence, "better evidence, more confidence");
  assert.ok(v.confidence <= 95, "never above the verified ceiling");
  assert.ok(a.range && v.range);
  assert.ok(v.range.high - v.range.low < a.range.high - a.range.low, "the range narrows as confidence rises");
});

test("a sub-score with no data earns no confidence, so filling gaps raises it", () => {
  const thin = computeImpactGrade({ ...base, tiers: {} }, ix);
  const fuller = computeImpactGrade({ ...base, activationPeriod: "12-24 months", reusable: true, tiers: {} }, ix);
  assert.ok(fuller.confidence > thin.confidence);
});

test("the Supplier Score comes from the SRM scorecard criteria and is a sub-score of the grade", () => {
  const m = { criteria: [
    { key: "csr_audit", label: "CSR audit", weight: 30, pillar_key: "compliance", kind: "option", unit: null, bands: [{ value: "green", label: "Green", score: 4 }], fallback_criterion: null },
    { key: "renewable", label: "Renewable energy", weight: 10, pillar_key: "compliance", kind: "option", unit: null, bands: [{ value: "full", label: "100% renewable", score: 5 }], fallback_criterion: null },
    { key: "sedex", label: "SEDEX", weight: 5, pillar_key: "compliance", kind: "option", unit: null, bands: [{ value: "member", label: "Member", score: 5 }], fallback_criterion: null },
  ], pillars: [{ key: "compliance", label: "Compliance", weight: 100, sort: 1, description: null }], missing_data: "ignore", require_coc: false, preferred_threshold: 3 };
  const inputs = [{ key: "csr_audit", value_num: null, value_text: "green" }, { key: "renewable", value_num: null, value_text: "full" }];
  const s = supplierSustainabilityScore(m, scoreSupplier(m, inputs, true), ["csr_audit", "renewable", "sedex"]);
  assert.equal(s.score, 90, "(4+5)/2 scaled to 100");
  assert.deepEqual(s.missing, ["SEDEX"]);
  const g = computeImpactGrade({ ...base, supplierScore: s.score }, ix);
  const sup = g.subScores.find((x) => x.code === "SUPPLIER");
  assert.equal(sup.score, 90);
  assert.equal(computeImpactGrade(base, ix).subScores.find((x) => x.code === "SUPPLIER").score, null, "no supplier, no score");
});

test("inputs a person enters take the weakest tier behind their sub-score", () => {
  const { input, tiers } = applyOverrides(base, { RECYCLABILITY: "estimated" }, {
    finishing: { value: "Gloss lamination", tier: "declared" }, easySeparation: { value: true, tier: "measured" }, reusable: { value: true, tier: "verified" },
  });
  assert.deepEqual(input.finishing, ["Gloss lamination"]);
  assert.equal(tiers.RECYCLABILITY, "declared");
  assert.equal(tiers.REUSABILITY, "verified");
});

// ---- database -----------------------------------------------------------------------------------------------------
await t.asSuper("select set_config('sourcing.system_write', 'on', false)");
const client = (await t.asSuper("insert into public.sourcing_clients (code, name, min_quotes_required, e_tender_threshold) values ('IGR','IG client',1,1000) returning id")).rows[0];
const job = (await t.asSuper("insert into public.jobs (title, client_id, region, market) values ('IG job', $1, 'EMEA', 'Germany') returning id", [client.id])).rows[0];
const spec = (await t.asSuper("insert into public.job_specs (job_id, title, spec_type, region, market) values ($1, 'IG spec', '2d', 'EMEA', 'Germany') returning id", [job.id])).rows[0].id;
const payload = (score, extra = {}) => JSON.stringify({ score, letter: "B", coverage: 75, confidence: 55, range_low: score - 10, range_high: score + 10, pef_mpt: 0.08, supplier_score: 88, inputs: { overrides: {} }, tiers: { PEF: "estimated" }, sub_scores: [], warnings: [], ...extra });

test("saving a grade stores the record, syncs the spec and logs the event; only staff can save", async () => {
  const { rows: [{ id }] } = await t.as("admin", "select public.impact_grade_save('spec', $1, $2, null, null, 'spec', $3::jsonb, 'calculate', null) id", [spec, job.id, payload(72)]);
  const { rows: [rec] } = await t.asSuper("select score, confidence, review_status from public.impact_grade_records where id = $1", [id]);
  assert.equal(Number(rec.score), 72);
  assert.equal(rec.confidence, 55);
  assert.equal(rec.review_status, "unreviewed");
  const { rows: [s] } = await t.asSuper("select impact_grade from public.job_specs where id = $1", [spec]);
  assert.equal(Number(s.impact_grade), 72, "the spec carries the grade for badges across the journey");
  const { rows: ev } = await t.asSuper("select action from public.impact_grade_events where record_id = $1", [id]);
  assert.deepEqual(ev.map((e) => e.action), ["calculate"]);
  await t.rejects(t.as("plain", "insert into public.impact_grade_records (subject_kind, subject_id) values ('spec', gen_random_uuid())"), /permission denied|row-level/);
});

test("an edit needs a reason, resets review, and the person who changed it cannot review it", async () => {
  await t.rejects(t.as("admin", "select public.impact_grade_save('spec', $1, $2, null, null, 'spec', $3::jsonb, 'edit', '')", [spec, job.id, payload(70)]), /Say why/);
  const { rows: [{ id }] } = await t.as("admin", "select public.impact_grade_save('spec', $1, $2, null, null, 'spec', $3::jsonb, 'edit', 'Supplier confirmed lamination') id", [spec, job.id, payload(70)]);
  await t.rejects(t.as("admin", "select public.impact_grade_review($1, 'reviewed', null)", [id]), /different person/);
  await t.as("admin2", "select public.impact_grade_review($1, 'reviewed', 'checked')", [id]);
  const { rows: [r1] } = await t.asSuper("select review_status from public.impact_grade_records where id = $1", [id]);
  assert.equal(r1.review_status, "reviewed");
  await t.rejects(t.as("admin2", "select public.impact_grade_review($1, 'disputed', '')", [id]), /Say what is wrong/);
  // A recalculation that moves the grade sends it back for review.
  await t.as("admin", "select public.impact_grade_save('spec', $1, $2, null, null, 'spec', $3::jsonb, 'calculate', null)", [spec, job.id, payload(64)]);
  const { rows: [r2] } = await t.asSuper("select review_status, reviewed_by from public.impact_grade_records where id = $1", [id]);
  assert.equal(r2.review_status, "unreviewed");
  assert.equal(r2.reviewed_by, null);
});

test("saving a PEF result keeps it for the reference percentile", async () => {
  const before = (await t.asSuper("select count(*)::int n from public.pef_results where spec_id = $1", [spec])).rows[0].n;
  await t.as("admin", "select public.impact_grade_save('spec', $1, $2, null, null, 'spec', $3::jsonb, 'calculate', null)", [spec, job.id, payload(64, { pef_result: { singleScoreMpt: 0.08 } })]);
  const after = (await t.asSuper("select count(*)::int n from public.pef_results where spec_id = $1", [spec])).rows[0].n;
  assert.equal(after, before + 1);
});

test("the tier confidence parameters are in the Watchtower library", async () => {
  const { rows } = await t.asSuper("select code from public.library_records where library_key = 'ig_parameters' and code like 'tier_confidence_%' and status = 'active'");
  assert.equal(rows.length, 5);
});

