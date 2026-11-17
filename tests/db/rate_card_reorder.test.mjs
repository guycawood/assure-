// Reorder from an approved rate card: only accepted, in-date awards with an eligible vendor are live; the quantity must sit in the tier;
// the order goes to the awarded vendor at its buy price as a draft estimate with no RFQ; shared items are allocated towards the awarded
// shares and a different vendor needs a reason.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const VA = "00000000-0000-0000-0000-0000000001a1", VB = "00000000-0000-0000-0000-0000000001ab";
Object.assign(ids, { va: VA, vb: VB });
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0), ($2, true, 0)", [ids.lead, ids.head]);
const sup = async (code, email) => {
  const id = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Vietnam','APAC',$3) returning id", [code, `Reorder ${code}`, email])).rows[0].id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
};
const sA = await sup("RO-A", "a@ro.example"), sB = await sup("RO-B", "b@ro.example");
await asSuper("insert into auth.users (id, email) values ($1,'a@ro.example'), ($2,'b@ro.example')", [VA, VB]);
const client = (await asSuper("insert into public.sourcing_clients (code, name, default_markup_percent) values ('ROC','Reorder Client', 12) returning id")).rows[0].id;

// An approved programme: item R1 (1 to 999) split 70/30 between A and B, item R2 (1000 and over) held by A alone. Both vendors accept unless told otherwise.
async function live({ acceptB = true, valid = ["2026-01-01", "2030-12-31"] } = {}) {
  const p = (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "RC Reorder", year: 2026, currency: "vnd", price_decimals: 0, fee_percent: 5 })])).rows[0].id;
  await as("lead", "select public.rate_card_items_import($1,$2::jsonb)", [p, JSON.stringify([
    { product_type: "Banner", product_code: "RO1", subcode: "RO1_R1", channel: "DT", category: "Print", uom: "SQCM", qty_min: 1, qty_max: 999, baseline_price: 100, baseline_qty: 10, spec_detail: "Alu panel with print" },
    { product_type: "Banner", product_code: "RO1", subcode: "RO1_R2", channel: "DT", category: "Print", uom: "SQCM", qty_min: 1000, qty_max: null, baseline_price: 90, baseline_qty: 10 }])]);
  await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [p, JSON.stringify([
    { subcode: "RO1_R1", supplier: "Reorder RO-A", price: 80 }, { subcode: "RO1_R1", supplier: "Reorder RO-B", price: 83 }, { subcode: "RO1_R2", supplier: "Reorder RO-A", price: 70 }])]);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() + interval '2 days' where id = $1", [p]);
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p, sA, sB]);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() - interval '1 minute' where id = $1", [p]);
  const [r1] = (await asSuper("select id from public.rate_card_items where programme_id = $1 order by sort", [p])).rows;
  const bids = Object.fromEntries((await asSuper("select supplier_label, id from public.rate_card_bids where item_id = $1", [r1.id])).rows.map((r) => [r.supplier_label, r.id]));
  await as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: bids["Reorder RO-A"], share: 70 }, { bid_id: bids["Reorder RO-B"], share: 30 }])]);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);
  await as("lead", "select public.rate_card_programme_set_validity($1,$2,$3)", [p, valid[0], valid[1]]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [p]);
  await as("head", "select public.rate_card_programme_approve($1,'ok')", [p]);
  await as(VA, "select public.vendor_rate_card_accept($1,true,null)", [p]);
  if (acceptB) await as(VB, "select public.vendor_rate_card_accept($1,true,null)", [p]);
  return p;
}
const list = async (p, who = "agent") => (await as(who, "select public.rate_card_price_list(null,$1) as l", [p])).rows[0].l;
const itemId = async (p, sub) => (await asSuper("select id from public.rate_card_items where programme_id = $1 and subcode = $2", [p, sub])).rows[0].id;
const reorder = (who, item, qty, o = {}) => as(who, "select public.rate_card_reorder($1,$2,$3,$4,$5,$6,$7,$8,null) as r", [item, qty, o.job ?? null, o.supplier ?? null, o.reason ?? null, o.client ?? null, o.market ?? null, o.title ?? null]);

test("only accepted, in-date awards with an eligible vendor are on the price list", async () => {
  const p = await live({ acceptB: false });
  let l = await list(p);
  assert.deepEqual(l.map((x) => x.subcode), ["RO1_R1", "RO1_R2"]);
  assert.deepEqual(l[0].awards.map((a) => a.supplier), ["Reorder RO-A"]);               // B has not accepted, so its 30 percent is not live
  const b = await live();                                                                  // both accepted
  assert.deepEqual((await list(b))[0].awards.map((a) => [a.supplier, Number(a.share), Number(a.buy), Number(a.sell)]), [["Reorder RO-A", 70, 80, 84], ["Reorder RO-B", 30, 83, 88]]);
  await asSuper("update public.suppliers set active = false where id = $1", [sB]);
  assert.deepEqual((await list(b))[0].awards.map((a) => a.supplier), ["Reorder RO-A"]);    // an ineligible vendor drops out
  await asSuper("update public.suppliers set active = true where id = $1", [sB]);
  const old = await live({ valid: ["2024-01-01", "2024-12-31"] });                         // out of date
  assert.equal((await list(old)).length, 0);
  await rejects(as(VA, "select public.rate_card_price_list()"), /Only internal staff/);
});

test("a reorder creates the job line, an Adopt decision and a draft estimate at the buy price plus the programme fee, with no RFQ", async () => {
  const p = await live({ acceptB: false });
  const r1 = await itemId(p, "RO1_R1");
  const out = (await reorder("agent", r1, 500, { client, market: "VN", title: "Banner reorder" })).rows[0].r;
  assert.deepEqual([out.supplier, Number(out.buy), Number(out.sell), out.quantity, out.currency], ["Reorder RO-A", 80, 84, 500, "VND"]);
  const est = (await asSuper("select status, source, benchmark_source, supplier_id, base_cost, pricing_percent, sell_price, rfq_id from public.estimates where id = $1", [out.estimate_id])).rows[0];
  assert.deepEqual([est.status, est.source, est.benchmark_source, est.supplier_id, Number(est.base_cost), Number(est.pricing_percent), est.rfq_id], ["draft", "adopt", "rate_card", sA, 40000, 5, null]);
  assert.equal(Number(est.sell_price), 42000);                                              // 40,000 plus the 5 percent fee
  const tri = (await asSuper("select route, supplier_id, unit_price, quantity from public.spec_triage where spec_id = $1 and is_current", [out.spec_id])).rows[0];
  assert.deepEqual([tri.route, tri.supplier_id, Number(tri.unit_price), tri.quantity], ["adopt", sA, 80, 500]);
  const job = (await asSuper("select title, currency, client_id from public.jobs where id = $1", [out.job_id])).rows[0];
  assert.deepEqual([job.title, job.currency, job.client_id], ["Banner reorder", "VND", client]);
  assert.equal((await asSuper("select count(*)::int n from public.rate_card_orders where item_id = $1 and quantity = 500", [r1])).rows[0].n, 1);
  // a second reorder goes into the same job
  const again = (await reorder("agent", await itemId(p, "RO1_R2"), 2000, { job: out.job_id })).rows[0].r;
  assert.equal(again.job_id, out.job_id);
  assert.equal(Number(again.buy), 70);
});

test("the quantity must sit in the tier, the job must match, and only staff can reorder", async () => {
  const p = await live({ acceptB: false });
  const r1 = await itemId(p, "RO1_R1"), r2 = await itemId(p, "RO1_R2");
  await rejects(reorder("agent", r1, 0, { client, market: "VN", title: "x" }), /quantity to order/);
  await rejects(reorder("agent", r1, 1000, { client, market: "VN", title: "x" }), /within this tier: 1 to 999/);
  await rejects(reorder("agent", r2, 500, { client, market: "VN", title: "x" }), /within this tier: 1000 to no limit/);
  await rejects(reorder("agent", r1, 10, {}), /Choose a job, or give a client/);
  await rejects(reorder("agent", r1, 10, { client, market: "ZZ", title: "x" }), /Choose a market/);
  const eur = (await as("agent", "insert into public.jobs (title, client_id, region, market, currency) values ('EUR job',$1,'EMEA','Germany','EUR') returning id", [client])).rows[0].id;
  await rejects(reorder("agent", r1, 10, { job: eur }), /job is in EUR but this rate card is in VND/);
  await rejects(as(VA, "select public.rate_card_reorder($1,10,null,null,null,$2,'VN','x',null)", [r1, client]), /Only internal staff/);
});

test("a shared item is allocated towards its shares; choosing another vendor needs a reason", async () => {
  const p = await live();
  const r1 = await itemId(p, "RO1_R1");
  const first = (await list(p))[0].awards;
  assert.equal(first.find((a) => a.suggested).supplier, "Reorder RO-A");                   // nothing ordered yet: the larger share leads
  const job = (await reorder("agent", r1, 100, { client, market: "VN", title: "Split job" })).rows[0].r.job_id;
  assert.equal((await list(p))[0].awards.find((a) => a.suggested).supplier, "Reorder RO-B"); // A has had everything so far
  await rejects(reorder("agent", r1, 100, { job, supplier: sA }), /Say why you are choosing this one/);
  assert.equal((await reorder("agent", r1, 100, { job })).rows[0].r.supplier, "Reorder RO-B");
  assert.equal((await list(p))[0].awards.find((a) => a.suggested).supplier, "Reorder RO-A"); // 100 each: A is now furthest below 70 percent
  await reorder("agent", r1, 100, { job, supplier: sB, reason: "B is closer to the venue" });
  const o = (await asSuper("select supplier_label, override_reason from public.rate_card_orders where item_id = $1 order by created_at", [r1])).rows;
  assert.deepEqual(o.map((x) => x.supplier_label), ["Reorder RO-A", "Reorder RO-B", "Reorder RO-B"]);
  assert.equal(o[2].override_reason, "B is closer to the venue");
  await rejects(reorder("agent", r1, 100, { job, supplier: "00000000-0000-0000-0000-000000000999", reason: "no such vendor" }), /does not hold a live award/);
});
