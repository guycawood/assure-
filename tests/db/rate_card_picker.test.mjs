// Choosing a rate card on a spec line: the candidates fit the line, ineligible suppliers cannot be picked,
// only a sourcing lead picks, a reason is required, and the pick becomes the applied price.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;

async function lib(key, code, name, data) {
  return (await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01') returning id", [key, code, name, JSON.stringify(data)])).rows[0].id;
}
async function supplier(code, name, blocked = false) {
  const id = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, name, `${code}@pick.example`])).rows[0].id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  if (blocked) await asSuper("update public.supplier_gates set status = 'missing' where supplier_id = $1 and gate_key = 'msa'", [id]);
  return id;
}
const sub = await lib("substrates", "SB-PK350", "Pick board 350gsm", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 350 });
await lib("substrates", "SB-PKOTHER", "Pick other board", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 200 });
const sA = await supplier("PK-A", "Pick Alpha"), sB = await supplier("PK-B", "Pick Beta"), sD = await supplier("PK-D", "Pick Delta", true);
const card = (code, name, supplierCode, price, substrate = "SB-PK350") => lib("rate_cards", code, name, { spec_type: "2d", substrate_code: substrate, finished_length_mm: 600, finished_width_mm: 400, min_qty: 100, max_qty: 5000, unit_price: price, currency: "EUR", supplier_code: supplierCode });
const c1 = await card("RC-PK1", "Alpha A2 card", "PK-A", 2);
const c2 = await card("RC-PK2", "Beta A2 card", "PK-B", 1.8);
const c3 = await card("RC-PK3", "Delta A2 card", "PK-D", 1.5);
const c4 = await card("RC-PK4", "Other material card", "PK-A", 1, "SB-PKOTHER");
const grade = (card, score = 70) => as("agent", "select public.rate_card_grade_save($1,$2::jsonb)", [card, JSON.stringify({ score, letter: score >= 60 ? "B" : "D", coverage: 80, confidence: 60, range_low: score - 6, range_high: score + 6, supplier_score: 70 })]);
const review = (card, status = "reviewed", note = null) => as("lead", "select public.rate_card_grade_review($1,$2,$3)", [card, status, note]);
for (const c of [c1, c2, c3]) { await grade(c); await review(c); } // c4 is left without a grade
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0)", [ids.lead]);
const client = (await asSuper("insert into public.sourcing_clients (code, name) values ('PKC','Pick Client') returning id")).rows[0].id;
const be = (await asSuper("insert into public.sourcing_billing_entities (code, name, region, market) values ('BE-PK','Northgate Brand Services GmbH','EMEA','Germany') returning id")).rows[0].id;

async function line(qty = 1000) {
  const job = (await as("agent", "insert into public.jobs (title, client_id, billing_entity_id, region, market, budget) values ('Pick job',$1,$2,'EMEA','Germany',50000) returning id", [client, be])).rows[0].id;
  const s = (await as("agent", "insert into public.job_specs (job_id, title, spec_type, size_unit, substrate_id) values ($1,'A2 poster','2d','mm',$2) returning id", [job, sub])).rows[0].id;
  await as("agent", "insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',$2,600,400)", [s, qty]);
  await as("agent", "select public.spec_triage_run($1)", [s]);
  return s;
}
const cards = async (s) => (await as("agent", "select public.spec_triage_cards($1) as c", [s])).rows[0].c;
const current = async (s) => (await asSuper("select route, unit_price, rate_card_id, supplier_id, source, reason from public.spec_triage where spec_id = $1 and is_current", [s])).rows[0];

test("candidates fit the line, the unusable supplier is flagged, and only staff see them", async () => {
  const s = await line();
  const list = await cards(s);
  const codes = list.map((c) => c.code);
  assert.deepEqual([...codes].sort(), ["RC-PK1", "RC-PK2", "RC-PK3"]); // the other material is left out
  assert.equal(list.find((c) => c.code === "RC-PK3").eligible, false);
  assert.equal(list.find((c) => c.code === "RC-PK3").route, null);
  assert.equal(list[list.length - 1].code, "RC-PK3"); // unusable last
  assert.equal(list.find((c) => c.code === "RC-PK2").route, "adopt");
  assert.equal(Number(list.find((c) => c.code === "RC-PK2").unit_price), 1.8);
});

test("a sourcing lead picks another card with a reason; the pick becomes the applied price", async () => {
  const s = await line();
  const before = await current(s);
  const want = before.rate_card_id === c1 ? c2 : c1;
  const price = want === c1 ? 2 : 1.8;
  await rejects(as("agent", "select public.spec_triage_pick_card($1,$2,'Cheaper')", [s, want]), /sourcing lead/);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'')", [s, want]), /Say why/);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'Cheapest')", [s, c3]), /not eligible/);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'Cheapest')", [s, c4]), /does not fit/);
  await as("lead", "select public.spec_triage_pick_card($1,$2,'Client prefers this supplier')", [s, want]);
  const after = await current(s);
  assert.equal(after.rate_card_id, want);
  assert.equal(after.route, "adopt");
  assert.equal(after.source, "override");
  assert.equal(Number(after.unit_price), price);
  assert.match(after.reason, /Client prefers this supplier/);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'Again')", [s, want]), /already applied/);
});

test("a card outside the quantity range goes to the supplier to confirm instead of being applied silently", async () => {
  const s = await line(8000); // above every card's 5,000 maximum
  const list = await cards(s);
  assert.ok(list.every((c) => c.qty_ok === false));
  const want = (await current(s)).rate_card_id === c1 ? c2 : c1;
  assert.equal(list.find((c) => c.id === want).route, "push");
  await as("lead", "select public.spec_triage_pick_card($1,$2,'Volume deal agreed with the supplier')", [s, want]);
  const after = await current(s);
  assert.equal(after.route, "push");
  assert.equal((await asSuper("select push_status from public.spec_triage where spec_id = $1 and is_current", [s])).rows[0].push_status, "pending");
});

test("a rate card needs a grade reviewed by a second person before it can be chosen", async () => {
  const c5 = await card("RC-PK5", "Gamma A2 card", "PK-B", 1.7);
  const s = await line();
  const grades = async () => (await as("agent", "select public.sourcing_rate_cards() as l")).rows[0].l;
  assert.equal((await grades()).find((x) => x.code === "RC-PK5").grade, null);
  assert.equal((await grades()).find((x) => x.code === "RC-PK5").selectable, false);
  await rejects(as("lead", "select public.rate_card_grade_review($1,'reviewed',null)", [c5]), /no grade yet/);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'Cheapest')", [s, c5]), /Impact Grade/);
  await grade(c5, 66);
  await rejects(as("agent", "select public.rate_card_grade_review($1,'reviewed',null)", [c5]), /different person/);
  await rejects(as("lead", "select public.rate_card_grade_review($1,'disputed','')", [c5]), /Say what is wrong/);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'Cheapest')", [s, c5]), /Impact Grade/); // calculated, not reviewed
  await review(c5);
  const row = (await grades()).find((x) => x.code === "RC-PK5");
  assert.deepEqual([row.selectable, row.grade.review_status, Number(row.grade.score)], [true, "reviewed", 66]);
  // a recalculation that changes the grade goes back to unreviewed and the card stops being selectable; the same score keeps the review
  await grade(c5, 66);
  assert.equal((await grades()).find((x) => x.code === "RC-PK5").grade.review_status, "reviewed");
  await grade(c5, 59);
  const again = (await grades()).find((x) => x.code === "RC-PK5");
  assert.deepEqual([again.selectable, again.grade.review_status], [false, "unreviewed"]);
  await rejects(as("lead", "select public.spec_triage_pick_card($1,$2,'Cheapest')", [s, c5]), /Impact Grade/);
  const events = (await asSuper("select count(*)::int n from public.rate_card_grade_events where card_id = $1", [c5])).rows[0].n;
  assert.equal(events, 4); // three calculations and one review; refused calls leave nothing behind
  assert.deepEqual((await as("agent", "select public.spec_triage_cards($1) as c", [s])).rows[0].c.find((c) => c.code === "RC-PK5").graded, false);
});
