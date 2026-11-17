// Requesting a new rate card: anyone internal asks, the sourcing team takes it, prices it, builds the card through the governed
// library (a different person approves), the card gets a reviewed Impact Grade, and the request then closes itself.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const sup = await (async () => {
  const id = (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('RQ-A','Request Alpha','Germany','EMEA','a@rq.example') returning id")).id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
})();
await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ('substrates','SB-RQ','Request board',$1,'active','2026-01-01')", [JSON.stringify({ substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 300 })]);
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0)", [ids.lead]);
const client = (await one("insert into public.sourcing_clients (code, name) values ('RQC','Request Client') returning id")).id;

const ask = (who = "agent", o = {}) => as(who, "select public.rate_card_request_create($1::jsonb) as id",
  [JSON.stringify({ title: "A3 floor decal", spec_type: "2d", substrate_code: "SB-RQ", length_mm: 420, width_mm: 297, min_qty: 100, max_qty: 2000, client_id: client, market: "de", reason: "Repeat order every quarter", ...o })]);
const row = async (id) => one("select status, owner, card_id, decline_reason from public.rate_card_requests where id = $1", [id]);
const note = (user, title) => one("select count(*)::int n from public.notifications where user_id = $1 and title = $2", [user, title]);

test("anyone internal can ask; the request needs a title and a reason; the leads are told", async () => {
  await rejects(ask("agent", { title: "" }), /Say what the card is for/);
  await rejects(ask("agent", { reason: "" }), /Say why you need a new card/);
  await rejects(ask("agent", { min_qty: 500, max_qty: 100 }), /largest quantity/);
  const id = (await ask()).rows[0].id;
  assert.equal((await row(id)).status, "requested");
  assert.match((await one("select request_no from public.rate_card_requests where id = $1", [id])).request_no, /^RCR-\d{4}-\d{5}$/);
  const before = (await one("select count(*)::int n from public.notifications where user_id = $1 and title like 'Rate card requested:%'", [ids.lead])).n;
  assert.ok(before >= 1);
  const list = (await as("agent", "select public.rate_card_requests_list() as l")).rows[0].l;
  const mine = list.find((r) => r.id === id);
  assert.deepEqual([mine.status, mine.client_name, mine.market, mine.mine], ["requested", "Request Client", "DE", true]);
});

test("take, price, build through the governed library, approve by a different person, grade it: the request closes itself", async () => {
  const id = (await ask()).rows[0].id;
  await rejects(as("agent", "select public.rate_card_request_take($1)", [id]), /sourcing team/);
  await rejects(as("admin", "select public.rate_card_request_pricing($1, null)", [id]), /Take the request/);
  await as("admin", "select public.rate_card_request_take($1)", [id]);
  assert.equal((await note(ids.agent, "Your rate card request is being worked on")).n >= 1, true);
  await rejects(as("admin2", "select public.rate_card_request_take($1)", [id]), /already been taken/);
  await rejects(as("lead", "select public.rate_card_request_pricing($1, null)", [id]), /Only the owner/);
  await as("admin", "select public.rate_card_request_pricing($1, null)", [id]);
  await rejects(as("admin", "select public.rate_card_request_build($1,'RQ-A',0,'EUR',null)", [id]), /unit price/);
  await rejects(as("admin", "select public.rate_card_request_build($1,'NOPE',1.2,'EUR',null)", [id]), /Choose the supplier/);
  const card = (await as("admin", "select public.rate_card_request_build($1,'RQ-A',1.2,'EUR',null) as c", [id])).rows[0].c;
  const r = await row(id);
  assert.deepEqual([r.status, r.card_id], ["drafted", card]);
  const rec = await one("select status, code, data from public.library_records where id = $1", [card]);
  assert.equal(rec.status, "pending_approval");
  assert.deepEqual([rec.data.supplier_code, rec.data.client_code, Number(rec.data.unit_price), rec.data.finished_length_mm], ["RQ-A", "RQC", 1.2, 420]);
  // not usable yet: needs approval and a reviewed grade
  const listed = (await as("agent", "select public.sourcing_rate_cards() as l")).rows[0].l.find((c) => c.id === card);
  assert.equal(listed.selectable, false);
  await rejects(as("admin", "select public.library_approve($1, true, null)", [card]), /different person/);
  await as("admin2", "select public.library_approve($1, true, 'Agreed')", [card]);
  assert.equal((await row(id)).status, "drafted"); // active, but no reviewed grade yet
  await as("agent", "select public.rate_card_grade_save($1,$2::jsonb)", [card, JSON.stringify({ score: 64, letter: "B", coverage: 70, confidence: 45, range_low: 58, range_high: 70 })]);
  assert.equal((await row(id)).status, "drafted");
  await as("lead", "select public.rate_card_grade_review($1,'reviewed',null)", [card]);
  assert.equal((await row(id)).status, "approved");
  assert.equal((await note(ids.agent, "Your rate card is ready")).n, 1);
  assert.equal((await as("agent", "select public.sourcing_rate_cards() as l")).rows[0].l.find((c) => c.id === card).selectable, true);
  assert.deepEqual((await asSuper("select event from public.rate_card_request_events where request_id = $1 order by id", [id])).rows.map((e) => e.event), ["requested", "taken", "pricing", "drafted", "approved"]);
});

test("a request can be declined with a reason by the sourcing team, and a closed request stays closed", async () => {
  const id = (await ask()).rows[0].id;
  await rejects(as("agent", "select public.rate_card_request_decline($1,'No')", [id]), /sourcing team/);
  await rejects(as("lead", "select public.rate_card_request_decline($1,'')", [id]), /Say why/);
  await as("lead", "select public.rate_card_request_decline($1,'Too small to be worth a card')", [id]);
  const r = await row(id);
  assert.deepEqual([r.status, r.decline_reason], ["declined", "Too small to be worth a card"]);
  assert.equal((await note(ids.agent, "Rate card request declined")).n, 1);
  await rejects(as("lead", "select public.rate_card_request_decline($1,'Again')", [id]), /already closed/);
  await rejects(as("lead", "select public.rate_card_request_take($1)", [id]), /already been taken/);
});

test("a request can come from a brief and the list counts the briefs waiting on it", async () => {
  const brief = (await as("agent", "select public.brief_create($1::jsonb) as id", [JSON.stringify({ title: "Waiting brief" })])).rows[0].id;
  const id = (await ask("agent", { brief_id: brief })).rows[0].id;
  assert.equal((await one("select rate_card_request_id from public.briefs where id = $1", [brief])).rate_card_request_id, id);
  const item = (await as("lead", "select public.rate_card_requests_list() as l")).rows[0].l.find((r) => r.id === id);
  assert.equal(Number(item.waiting_briefs), 1);
});
