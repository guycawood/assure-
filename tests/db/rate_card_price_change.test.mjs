// A rate card's price changes as a new governed version: approved by a different governor, with the grade carried over;
// a card can be retired from Sourcing. Both need governor rights.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const id = (await one("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('PC-A','Price Alpha','Germany','EMEA','a@pc.example') returning id")).id;
await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
const card = (await one("insert into public.library_records (library_key, code, name, data, status, effective_from) values ('rate_cards','RC-PC1','Price card',$1,'active','2026-01-01') returning id",
  [JSON.stringify({ spec_type: "2d", finished_length_mm: 600, finished_width_mm: 400, min_qty: 100, max_qty: 5000, unit_price: 2, currency: "EUR", supplier_code: "PC-A" })])).id;
await as("agent", "select public.rate_card_grade_save($1,$2::jsonb)", [card, JSON.stringify({ score: 70, letter: "B", coverage: 80, confidence: 60, range_low: 64, range_high: 76 })]);
await as("lead", "select public.rate_card_grade_review($1,'reviewed',null)", [card]);
const list = async () => (await as("agent", "select public.sourcing_rate_cards() as l")).rows[0].l;

test("a price change is a new version a different governor approves, and the grade carries over", async () => {
  await rejects(as("agent", "select public.rate_card_change_price($1, 1.8, null, 'Volume deal')", [card]), /Only admins/);
  await rejects(as("admin", "select public.rate_card_change_price($1, 0, null, 'Volume deal')", [card]), /new unit price/);
  await rejects(as("admin", "select public.rate_card_change_price($1, 1.8, null, '')", [card]), /why the price changes/);
  const next = (await as("admin", "select public.rate_card_change_price($1, 1.8, null, 'Volume deal') as c", [card])).rows[0].c;
  const cards = await list();
  const old = cards.find((c) => c.id === card), pending = cards.find((c) => c.id === next);
  assert.equal(old.selectable, true); // the old price stays in force until the new version starts
  assert.deepEqual([pending.status, pending.selectable, Number(pending.unit_price), pending.grade.review_status, Number(pending.grade.score)], ["pending_approval", false, 1.8, "reviewed", 70]);
  await rejects(as("admin", "select public.library_approve($1, true, null)", [next]), /different person/);
  await as("admin2", "select public.library_approve($1, true, 'Agreed')", [next]);
  assert.equal((await one("select status from public.library_records where id = $1", [card])).status, "superseded");
  const after = (await list()).find((c) => c.id === next);
  assert.deepEqual([after.status, after.in_date, Number(after.unit_price)], ["active", false, 1.8]); // starts tomorrow by default
});

test("a card can be retired by a governor and then drops off the lists", async () => {
  const c2 = (await one("insert into public.library_records (library_key, code, name, data, status, effective_from) values ('rate_cards','RC-PC2','Retire me',$1,'active','2026-01-01') returning id",
    [JSON.stringify({ spec_type: "2d", unit_price: 3, currency: "EUR", supplier_code: "PC-A" })])).id;
  assert.ok((await list()).some((c) => c.id === c2));
  await rejects(as("agent", "select public.library_retire($1, 'No longer agreed')", [c2]), /Only admins/);
  await as("admin", "select public.library_retire($1, 'No longer agreed')", [c2]);
  assert.ok(!(await list()).some((c) => c.id === c2));
});
