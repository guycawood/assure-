// Briefing → Sourcing: accepting a concept hand-off opens the job and seeds one draft spec from the concept
// (type, form, sizes, recycled content, FSC, substrate component), classified by the taxonomy trigger.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('NBR','Northbrew (demo)') returning id");
const { rows: [sub] } = await asSuper(`insert into public.library_records (library_key, code, name, data, status)
  values ('substrates', 'T-CORR', 'Corrugated board E flute', '{"measurement_basis":"grammage","grammage_gsm":450,"recycled_content_percent":85}', 'active') returning id`);

const BRIEF = { title: "Summer ale launch", objective: "Drive trial", brief_text: "Gondola end for the summer ale.", region: "EMEA", market: "GB",
  budget_low: "1000", budget_high: "2000", currency: "GBP", min_recycled_pct: "70", require_fsc: true };

/** Approved brief, one ideation turn with the given concepts, hand-offs created for each. Returns { brief, handoffs }. */
async function handoffs(concepts) {
  const brief = (await one("agent", "select public.brief_create($1, true) as id", [JSON.stringify(BRIEF)])).id;
  await as("lead", "select public.brief_decide($1, 'approved', null)", [brief]);
  const s = (await one("agent", "select public.ideation_start('brief', $1, null, '{}', '{}') as s", [brief])).s;
  const turn = await one("agent", "select public.ideation_add_turn($1, '', 'Directions', $2, 'claude-sonnet-5-5', 'brief-ideation/v1', '{}', true) as r",
    [s, JSON.stringify(concepts.map((c, idx) => ({ idx, ...c })))]);
  const out = [];
  for (const id of turn.r.concept_ids) out.push((await one("agent", "select public.brief_handoff_create($1, null) as h", [id])).h);
  return { brief, handoffs: out };
}

test("accepting a hand-off seeds a draft spec with the concept's type, sizes, sustainability needs and substrate", async () => {
  const { brief, handoffs: [h] } = await handoffs([{
    name: "Gondola end display", substrate_record_id: sub.id,
    data: { suggested_spec_type: "3d", suggested_substrate_name: "Corrugated board E flute", suggested_length: "600", suggested_width: "400",
      suggested_depth: "300", suggested_unit: "mm", creative_direction: "Sunlit gondola end with a tear-off tasting card.", rationale: "Fits the trial goal.",
      eco: { score: 78, tag: "low_impact" } },
  }]);
  const job = (await one("lead", "select public.job_create_from_handoff($1, $2) as j", [h, client.id])).j;

  const s = await one("plain", `select id, job_id, brief_id, title, spec_type, spec_form, is_draft, size_unit, size_description, substrate_id, material,
    recycled_content_percent, description, spec_data, tax_form_type, tax_category_id, tax_match from public.job_specs where job_id = $1`, [job]);
  assert.equal(s.brief_id, brief);
  assert.equal(s.title, "Gondola end display");
  assert.deepEqual([s.spec_type, s.spec_form, s.is_draft], ["3d", "open", true]);
  assert.equal(s.size_unit, "mm");
  assert.match(s.size_description, /^600 × 400 × 300 mm/);
  assert.equal(s.substrate_id, sub.id);
  assert.match(s.material, /FSC certified required/);
  assert.equal(Number(s.recycled_content_percent), 70);
  assert.match(s.description, /^From ideation concept "Gondola end display"/);
  assert.equal(s.spec_data.require_fsc, true);
  assert.equal(s.spec_data.seeded_from.handoff_id, h);
  assert.deepEqual(s.spec_data.suggested_dimensions, { length: 600, width: 400, depth: 300, unit: "mm" });

  // Taxonomy: "Gondola end" is a starter alias under POS & Display.
  assert.equal(s.tax_form_type, "POS & Display");
  assert.ok(s.tax_category_id, "classified");
  assert.match(s.tax_match, /^Automatic/);

  // Substrate component sized in cm, so weight and CO2e can be computed.
  const comps = (await as("plain", "select component_type, substrate_id, area_length_cm, area_width_cm from public.spec_components where spec_id = $1", [s.id])).rows;
  assert.equal(comps.length, 1);
  assert.deepEqual([comps[0].component_type, comps[0].substrate_id, Number(comps[0].area_length_cm), Number(comps[0].area_width_cm)], ["body", sub.id, 60, 40]);

  const ho = await one("plain", "select status, job_id, seeded_spec_id from public.brief_handoffs where id = $1", [h]);
  assert.deepEqual([ho.status, ho.job_id, ho.seeded_spec_id], ["accepted", job, s.id]);
  const ev = await one("plain", "select detail from public.sourcing_events where entity_id = $1 and event = 'spec_seeded_from_concept'", [s.id]);
  assert.equal(ev.detail.concept, "Gondola end display");

  // A draft can't be triaged until the buyer finishes it.
  await rejects(as("lead", "select public.spec_triage_run($1)", [s.id]), /Finish the spec before triage/);
});

test("an unknown spec type falls back to the ideation form; re-accepting creates no second job or spec", async () => {
  const { handoffs: [h] } = await handoffs([{ name: "Pop-up tasting kiosk", data: { suggested_spec_type: "kiosk", suggested_length: "n/a" } }]);
  const job = (await one("lead", "select public.job_create_from_handoff($1, $2) as j", [h, client.id])).j;
  const s = await one("plain", "select id, spec_type, spec_form, is_draft, size_unit, size_description, substrate_id from public.job_specs where job_id = $1", [job]);
  assert.deepEqual([s.spec_type, s.spec_form, s.is_draft, s.size_unit, s.size_description, s.substrate_id], ["custom_goods_services", "ideation", true, null, null, null]);
  assert.equal((await one("plain", "select count(*)::int n from public.spec_components where spec_id = $1", [s.id])).n, 0);

  const again = (await one("lead", "select public.job_create_from_handoff($1, $2) as j", [h, client.id])).j;
  assert.equal(again, job);
  assert.equal((await one("plain", "select count(*)::int n from public.jobs where brief_id = (select brief_id from public.brief_handoffs where id = $1)", [h])).n, 1);
  assert.equal((await one("plain", "select count(*)::int n from public.job_specs where job_id = $1", [job])).n, 1);
  assert.equal((await one("plain", "select count(*)::int n from public.sourcing_events where event = 'spec_seeded_from_concept' and job_id = $1", [job])).n, 1);
});

test("only internal staff accept hand-offs; the seeding helper is not callable directly", async () => {
  const { handoffs: [h] } = await handoffs([{ name: "Shelf wobbler", data: { suggested_spec_type: "2d" } }]);
  const VENDOR = "00000000-0000-0000-0000-0000000000f2";
  await asSuper("insert into auth.users (id, email) values ($1, 'someone@vendor-example.com')", [VENDOR]);
  await rejects(as(VENDOR, "select public.job_create_from_handoff($1, $2)", [h, client.id]), /Internal users only/);
  await rejects(as("lead", "select public._spec_seed_from_handoff($1, null)", [h]), /permission denied/);
});
