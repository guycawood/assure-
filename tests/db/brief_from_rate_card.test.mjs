// New brief from an existing rate card: Adopt / Adapt skip concepts and the RFQ; the card's Impact Grade travels with the line;
// only approved cards can be used; routing away from an RFQ stays a sourcing lead's decision.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
async function lib(key, code, name, data) {
  return (await asSuper("insert into public.library_records (library_key, code, name, data, status, effective_from) values ($1,$2,$3,$4,'active','2026-01-01') returning id", [key, code, name, JSON.stringify(data)])).rows[0].id;
}
const sup = async (code) => {
  const id = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Germany','EMEA',$3) returning id", [code, `Card ${code}`, `${code}@bc.example`])).rows[0].id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
};
await lib("substrates", "SB-BC350", "Brief board 350gsm", { substrate_type: "board", measurement_basis: "grammage", grammage_gsm: 350 });
await sup("BC-A");
const card = (code, extra = {}) => lib("rate_cards", code, `Card ${code}`, { spec_type: "2d", substrate_code: "SB-BC350", finished_length_mm: 600, finished_width_mm: 400, min_qty: 100, max_qty: 5000, unit_price: 2, currency: "EUR", supplier_code: "BC-A", ...extra });
const approved = await card("RC-BC1");
const ungraded = await card("RC-BC2");
const clientOnly = await card("RC-BC3", { client_code: "OTH" });
const grade = (c, score = 70) => as("agent", "select public.rate_card_grade_save($1,$2::jsonb)", [c, JSON.stringify({ score, letter: "B", coverage: 80, confidence: 60, range_low: score - 6, range_high: score + 6, supplier_score: 70 })]);
for (const c of [approved, clientOnly]) { await grade(c); await as("lead", "select public.rate_card_grade_review($1,'reviewed',null)", [c]); }
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0)", [ids.lead]);
const client = (await one("insert into public.sourcing_clients (code, name) values ('BCC','Brief Client') returning id")).id;
await asSuper("insert into public.sourcing_clients (code, name) values ('OTH','Other Client')");

const make = (who, card, o = {}) => as(who, "select public.brief_from_rate_card($1,$2,$3,$4,$5,$6,$7,null,$8) as r",
  [card, o.client ?? client, o.market ?? "DE", o.title ?? "Repeat headers", o.qty ?? 1000, o.len ?? null, o.wid ?? null, o.note ?? null]);
const triage = (spec) => one("select route, unit_price, rate_card_id, source from public.spec_triage where spec_id = $1 and is_current", [spec]);

test("same size and quantity: a lead's brief becomes a job and a spec routed Adopt, with the card's grade, and no concepts or RFQ", async () => {
  const r = (await make("lead", approved)).rows[0].r;
  assert.deepEqual([r.route, r.outcome, Number(r.unit_price)], ["adopt", "routed", 2]);
  const x = await triage(r.spec_id);
  assert.deepEqual([x.route, x.rate_card_id, x.source, Number(x.unit_price)], ["adopt", approved, "override", 2]);
  const b = await one("select status, rate_card_id, rate_card_route, resulting_job_id, client, market from public.briefs where id = $1", [r.brief_id]);
  assert.deepEqual([b.status, b.rate_card_id, b.rate_card_route, b.resulting_job_id, b.client, b.market], ["spec_created", approved, "adopt", r.job_id, "Brief Client", "DE"]);
  const spec = await one("select is_draft, impact_grade, (select quantity from public.spec_versions where spec_id = s.id) q from public.job_specs s where id = $1", [r.spec_id]);
  assert.deepEqual([spec.is_draft, Number(spec.impact_grade), spec.q], [false, 70, 1000]);
  const g = await one("select score, review_status from public.impact_grade_records where subject_kind = 'spec' and subject_id = $1", [r.spec_id]);
  assert.deepEqual([Number(g.score), g.review_status], [70, "reviewed"]);
  // the line cannot be sent to an RFQ
  await rejects(as("agent", "select public.rfq_create($1,'x',now() + interval '5 days',null,$2)", [r.job_id, JSON.stringify([{ spec_id: r.spec_id, quantity_breaks: [1000] }])]), /routed Adopt/);
});

test("a changed size inside the band is Adapt: priced from the card, and the copied grade goes back for a recalculation", async () => {
  const r = (await make("lead", approved, { len: 620, wid: 400, qty: 500 })).rows[0].r; // about 3.3 percent bigger
  assert.equal(r.route, "adapt");
  assert.ok(Number(r.unit_price) > 2 && Number(r.unit_price) < 2.2);
  const g = await one("select review_status, warnings from public.impact_grade_records where subject_kind = 'spec' and subject_id = $1", [r.spec_id]);
  assert.equal(g.review_status, "unreviewed");
  assert.match(JSON.stringify(g.warnings), /Adapted from rate card/);
  // a quantity outside the card's band goes to the supplier to confirm
  const p = (await make("lead", approved, { qty: 9000 })).rows[0].r;
  assert.equal(p.route, "push");
  assert.equal((await one("select push_status from public.spec_triage where spec_id = $1 and is_current", [p.spec_id])).push_status, "pending");
});

test("too far from the card, an unapproved card, the wrong client, or a missing field are refused", async () => {
  await rejects(make("lead", approved, { len: 900, wid: 600 }), /Start a normal brief/);
  await rejects(make("lead", ungraded), /cannot be used yet/);
  await rejects(make("lead", clientOnly), /only for client OTH/);
  await rejects(make("lead", approved, { title: "" }), /title/);
  await rejects(make("lead", approved, { qty: 0 }), /quantity/);
  await rejects(make("lead", approved, { market: "ZZ" }), /Choose a market/);
});

test("someone who is not a sourcing lead gets the brief and spec, but the line waits at Create for a lead to confirm", async () => {
  const r = (await make("agent", approved)).rows[0].r;
  assert.deepEqual([r.route, r.outcome], ["adopt", "needs_lead"]);
  const x = await triage(r.spec_id);
  assert.deepEqual([x.route, x.rate_card_id], ["create", approved]); // card attached, price ready, RFQ still possible
  assert.equal(Number(x.unit_price), 2);
  // a lead then confirms it from the spec page, using the existing override
  await as("lead", "select public.spec_triage_override($1,'adopt','Confirmed')", [r.spec_id]);
  assert.equal((await triage(r.spec_id)).route, "adopt");
});
