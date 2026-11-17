// Awarding a rate card programme (one vendor or a split by percentage), and approving and locking it: a different sourcing lead approves,
// validity dates, unsealed bids, coverage, every priced item awarded, a note for open checks; then the prices are locked and each vendor
// sees only its own award.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const VA = "00000000-0000-0000-0000-0000000001e1", VB = "00000000-0000-0000-0000-0000000001e2";
Object.assign(ids, { va: VA, vb: VB });
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0), ($2, true, 0)", [ids.lead, ids.head]);
const sup = async (code, email) => {
  const id = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Vietnam','APAC',$3) returning id", [code, `Award ${code}`, email])).rows[0].id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
};
const sA = await sup("AW-A", "a@aw.example"), sB = await sup("AW-B", "b@aw.example");
await asSuper("insert into auth.users (id, email) values ($1,'a@aw.example'), ($2,'b@aw.example')", [VA, VB]);

const T = (n, min, max, baseline, qty) => ({ product_type: "Banner", product_code: "AW1", subcode: `AW1_R${n}`, channel: "DT", qty_min: min, qty_max: max, baseline_price: baseline, baseline_qty: qty });
async function programme({ items = [T(1, 1, 99, 100, 10), T(2, 100, 999, 95, 10)], bids = true } = {}) {
  const id = (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "RC Awards", year: 2026, currency: "vnd", price_decimals: 0, fee_percent: 5 })])).rows[0].id;
  await as("lead", "select public.rate_card_items_import($1,$2::jsonb)", [id, JSON.stringify(items)]);
  if (bids) {
    await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [id, JSON.stringify(items.flatMap((i, n) => [
      { subcode: i.subcode, supplier: "Award AW-A", price: 80 - n * 5 }, { subcode: i.subcode, supplier: "Award AW-B", price: 83 - n * 5 }]))]);
  }
  return id;
}
const itemIds = async (p) => (await asSuper("select id, subcode from public.rate_card_items where programme_id = $1 order by sort", [p])).rows;
const bidIds = async (item) => Object.fromEntries((await asSuper("select supplier_label, id from public.rate_card_bids where item_id = $1", [item])).rows.map((r) => [r.supplier_label, r.id]));
const awards = async (p) => (await as("lead", "select public.rate_card_programme_awards($1) as a", [p])).rows[0].a;
const ready = async (p) => {                       // validity, award, send for review
  await as("lead", "select public.rate_card_programme_set_validity($1,'2026-01-01','2026-12-31')", [p]);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [p]);
};

test("award the lowest bid to every priced item at 100 percent, with buy rounded down and sell rounded up", async () => {
  const p = await programme({ items: [T(1, 1, 99, 100, 10), T(2, 100, 999, 95, 10), T(3, 1000, 9999, 90, 10)] });
  await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [p, JSON.stringify([{ subcode: "AW1_R1", supplier: "Award AW-A", price: 79.6 }])]);
  await rejects(as("agent", "select public.rate_card_programme_award_lowest($1)", [p]), /sourcing lead/);
  await asSuper("delete from public.rate_card_bids where item_id = (select id from public.rate_card_items where subcode = 'AW1_R3' and programme_id = $1)", [p]); // nothing priced on R3
  assert.equal((await as("lead", "select public.rate_card_programme_award_lowest($1) as n", [p])).rows[0].n, 2);
  const a = await awards(p);
  const r1 = a.find((x) => x.supplier === "Award AW-A" && Number(x.buy) === 79);
  assert.ok(r1);
  assert.deepEqual([Number(r1.share), Number(r1.sell)], [100, 83]);                            // 79 plus 5 percent is 82.95, rounded up
  assert.equal(a.length, 2);
  assert.equal((await as("lead", "select public.rate_card_programme_award_lowest($1) as n", [p])).rows[0].n, 0); // nothing left to award
});

test("an item can be split between vendors; shares must add up to 100 and each vendor keeps its own price", async () => {
  const p = await programme();
  const [r1] = await itemIds(p);
  const b = await bidIds(r1.id);
  await rejects(as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: b["Award AW-A"], share: 60 }, { bid_id: b["Award AW-B"], share: 30 }])]), /add up to 100/);
  await rejects(as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: b["Award AW-A"], share: 100 }, { bid_id: b["Award AW-B"], share: 0 }])]), /above zero/);
  await rejects(as("agent", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: b["Award AW-A"], share: 100 }])]), /sourcing lead/);
  await as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: b["Award AW-A"], share: 60 }, { bid_id: b["Award AW-B"], share: 40 }])]);
  const a = (await awards(p)).filter((x) => x.item_id === r1.id);
  assert.deepEqual(a.map((x) => [x.supplier, Number(x.share), Number(x.buy), Number(x.sell)]), [["Award AW-A", 60, 80, 84], ["Award AW-B", 40, 83, 88]]);
  await as("lead", "select public.rate_card_item_set_awards($1,'[]'::jsonb)", [r1.id]);          // cleared
  assert.equal((await awards(p)).filter((x) => x.item_id === r1.id).length, 0);
});

test("vendor prices still sealed cannot be awarded", async () => {
  const p = await programme({ bids: false });
  await asSuper("update public.rate_card_programmes set bid_deadline = now() + interval '3 days' where id = $1", [p]);
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p, sA, sB]);
  const [r1] = await itemIds(p);
  await as(VA, "select public.vendor_rate_card_submit($1,$2::jsonb,true)", [p, JSON.stringify([{ item_id: r1.id, price: 70 }])]);
  await rejects(as("lead", "select public.rate_card_programme_award_lowest($1)", [p]), /sealed/);
  await as(VB, "select public.vendor_rate_card_decline($1,'No capacity')", [p]);                 // everyone has now responded, so the prices open
  assert.equal((await as("lead", "select public.rate_card_programme_award_lowest($1) as n", [p])).rows[0].n, 1);
});

test("approval needs a different lead, validity dates, enough coverage, awards, and a note when checks are open", async () => {
  const p = await programme();
  await rejects(as("head", "select public.rate_card_programme_approve($1,null)", [p]), /Move the programme to review/);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [p]);
  await rejects(as("lead", "select public.rate_card_programme_approve($1,null)", [p]), /different sourcing lead/);
  await rejects(as("head", "select public.rate_card_programme_approve($1,null)", [p]), /validity dates/);
  await rejects(as("lead", "select public.rate_card_programme_set_validity($1,'2026-12-31','2026-01-01')", [p]), /after the start/);
  await as("lead", "select public.rate_card_programme_set_validity($1,'2026-01-01','2026-12-31')", [p]);
  await rejects(as("agent", "select public.rate_card_programme_approve($1,null)", [p]), /sourcing lead/);
  const [r1] = await itemIds(p);
  await as("lead", "select public.rate_card_item_set_awards($1,'[]'::jsonb)", [r1.id]);          // an item with bids but no award
  await rejects(as("head", "select public.rate_card_programme_approve($1,null)", [p]), /1 item\(s\) have bids but no award/);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);
  // 80 and 75 against last year's 100 and 95: sells 84 and 79, no checks open, so no note is needed
  const done = (await as("head", "select public.rate_card_programme_approve($1,null) as r", [p])).rows[0].r;
  assert.deepEqual([done.awarded, done.vendors], [2, 2 - 1]);                                     // both awards are AW-A (the lowest), so one vendor
  assert.equal((await asSuper("select status, approved_by from public.rate_card_programmes where id = $1", [p])).rows[0].status, "approved");
});

test("open checks need a note, coverage must meet the minimum, and approval locks the programme", async () => {
  const p = await programme({ items: [T(1, 1, 99, 70, 10), T(2, 100, 999, 95, 10)] });          // R1 is dearer than last year (84 against 70)
  await ready(p);
  await rejects(as("head", "select public.rate_card_programme_approve($1,null)", [p]), /still have checks open/);
  await as("lead", "select public.rate_card_programme_update($1,$2::jsonb)", [p, JSON.stringify({ min_coverage_percent: 100 })]).catch(() => {});
  assert.equal((await as("head", "select public.rate_card_programme_approve($1,'Volume deal: dearer on R1, cheaper overall') as r", [p])).rows[0].r.awarded, 2);
  const [r1] = await itemIds(p);
  await rejects(as("lead", "select public.rate_card_programme_update($1,$2::jsonb)", [p, JSON.stringify({ fee_percent: 9 })]), /approved and can't be changed/);
  await rejects(as("lead", "select public.rate_card_items_import($1,$2::jsonb)", [p, JSON.stringify([T(9, 1, 2, 1, 1)])]), /can't be changed/);
  await rejects(as("lead", "select public.rate_card_item_set_awards($1,'[]'::jsonb)", [r1.id]), /can't be changed/);
  await rejects(as("lead", "select public.rate_card_programme_set_status($1,'draft')", [p]), /can't be changed/);
});

test("coverage below the minimum blocks approval", async () => {
  const p = await programme({ items: [T(1, 1, 99, 100, 10), { ...T(2, 100, 999, 100, 90), product_code: "AW2", subcode: "AW2_R1" }], bids: false });
  await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [p, JSON.stringify([{ subcode: "AW1_R1", supplier: "Award AW-A", price: 60 }])]);
  await ready(p);                                                    // 1,000 of 10,000 of last year's spend is covered
  await rejects(as("head", "select public.rate_card_programme_approve($1,'ok')", [p]), /Coverage is 10(\.0)? percent, below the minimum of 61(\.00)? percent/);
});

test("send back needs a note and returns the programme to bidding or draft", async () => {
  const p = await programme();
  await ready(p);
  await rejects(as("head", "select public.rate_card_programme_send_back($1,'')", [p]), /what needs to change/);
  await as("head", "select public.rate_card_programme_send_back($1,'Split R1 with a second vendor')", [p]);
  assert.deepEqual(Object.values((await asSuper("select status, submitted_by from public.rate_card_programmes where id = $1", [p])).rows[0]), ["draft", null]);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title like 'Rate card sent back:%'", [ids.lead])).rows[0].n >= 1, true);
});

test("an awarded vendor sees only its own award, its own price and the dates, and only after approval", async () => {
  const p = await programme();
  await asSuper("update public.rate_card_programmes set bid_deadline = now() + interval '3 days' where id = $1", [p]);
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p, sA, sB]);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() - interval '1 minute' where id = $1", [p]);   // the deadline has passed, so the prices are open
  const [r1] = await itemIds(p);
  const b1 = await bidIds(r1.id);
  await as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: b1["Award AW-A"], share: 70 }, { bid_id: b1["Award AW-B"], share: 30 }])]);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);                   // R2 to the lowest
  const before = (await as(VA, "select public.vendor_rate_card_awards($1) as r", [p])).rows[0].r;
  assert.equal(before.approved, false);
  assert.deepEqual(before.awards, []);
  await as("lead", "select public.rate_card_programme_set_validity($1,'2026-03-01','2027-02-28')", [p]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [p]);
  await as("head", "select public.rate_card_programme_approve($1,'ok')", [p]);
  const a = (await as(VA, "select public.vendor_rate_card_awards($1) as r", [p])).rows[0].r;
  assert.deepEqual([a.approved, a.valid_from, a.valid_to], [true, "2026-03-01", "2027-02-28"]);
  assert.deepEqual(a.awards.map((x) => [x.subcode, Number(x.share), Number(x.price)]), [["AW1_R1", 70, 80], ["AW1_R2", 100, 75]]);
  const b = (await as(VB, "select public.vendor_rate_card_awards($1) as r", [p])).rows[0].r;
  assert.deepEqual(b.awards.map((x) => [x.subcode, Number(x.share), Number(x.price)]), [["AW1_R1", 30, 83]]);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where title like 'Awarded on rate card%'")).rows[0].n >= 2, true);
  await rejects(as("agent", "select public.vendor_rate_card_awards($1)", [p]), /Only a vendor user/);
});
