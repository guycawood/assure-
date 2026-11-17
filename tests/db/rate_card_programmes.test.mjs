// Rate card programmes: items and bids come in from rows, the analysis works out buy and sell prices the way the manual pricing file
// does (lowest or chosen bid rounded down, plus the fee rounded up), savings against last year or the market average, the tier check,
// winners and coverage. Only sourcing leads build.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0)", [ids.lead]);
await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ('PG-A','Supplier A','Vietnam','APAC','a@pg.example'), ('PG-B','Supplier B','Vietnam','APAC','b@pg.example')");

const make = async (o = {}) => (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "RC 2026", year: 2026, market: "vn", currency: "vnd", price_decimals: 0, fee_percent: 5, ...o })])).rows[0].id;
const items = (prog, rows, who = "lead") => as(who, "select public.rate_card_items_import($1,$2::jsonb) as r", [prog, JSON.stringify(rows)]);
const bids = (prog, rows, who = "lead") => as(who, "select public.rate_card_bids_import($1,$2::jsonb) as r", [prog, JSON.stringify(rows)]);
const analysis = async (prog) => (await as("agent", "select public.rate_card_programme_analysis($1) as a", [prog])).rows[0].a;
const row = (a, sub) => a.rows.find((r) => r.subcode === sub);

const T = (n, min, max, baseline, qty = 0, extra = {}) => ({ product_type: "Banner", product_code: "CLT32001_V26", subcode: `CLT32001_V26_R${n}`, channel: "DT", category: "Print", uom: "SQCM", qty_min: min, qty_max: max, baseline_price: baseline, baseline_match: "PY", baseline_qty: qty, ...extra });

test("only a sourcing lead builds; the programme starts with the settings given", async () => {
  await rejects(as("agent", "select public.rate_card_programme_create($1::jsonb)", [JSON.stringify({ name: "x" })]), /sourcing lead/);
  await rejects(as("lead", "select public.rate_card_programme_create($1::jsonb)", [JSON.stringify({ name: "" })]), /Name the programme/);
  const id = await make();
  const p = (await asSuper("select code, market, currency, fee_percent, cap_percent, min_coverage_percent, status from public.rate_card_programmes where id = $1", [id])).rows[0];
  assert.match(p.code, /^RCP-\d{4}-\d{3}$/);
  assert.deepEqual([p.market, p.currency, Number(p.fee_percent), Number(p.cap_percent), Number(p.min_coverage_percent), p.status], ["VN", "VND", 5, 50, 61, "draft"]);
  await rejects(as("agent", "select public.rate_card_programme_update($1,$2::jsonb)", [id, JSON.stringify({ fee_percent: 7 })]), /sourcing lead/);
  await as("lead", "select public.rate_card_programme_update($1,$2::jsonb)", [id, JSON.stringify({ fee_percent: 6, cap_percent: 40 })]);
  assert.equal(Number((await asSuper("select fee_percent from public.rate_card_programmes where id = $1", [id])).rows[0].fee_percent), 6);
});

test("items import: new and updated rows, problems reported by row, nothing silently dropped", async () => {
  const id = await make();
  const r = (await items(id, [T(1, 300, 9999, 105.77), T(2, 10000, 49999, 131.05), { ...T(3, 5, 1, 1), subcode: "BAD1" }, { ...T(4, 1, 2, 1), channel: "XX", subcode: "BAD2" }, { product_type: "", subcode: "BAD3" }, { product_type: "x" }])).rows[0].r;
  assert.deepEqual([r.added, r.updated, r.skipped], [2, 0, 4]);
  assert.deepEqual(r.problems.map((p) => p.problem), ["Largest quantity is below the smallest", "Channel must be DT, MT or Both", "No product type", "No sub-code"]);
  const again = (await items(id, [T(1, 300, 9999, 110)])).rows[0].r;
  assert.deepEqual([again.added, again.updated], [0, 1]);
  assert.equal(Number((await asSuper("select baseline_price from public.rate_card_items where programme_id = $1 and subcode = 'CLT32001_V26_R1'", [id])).rows[0].baseline_price), 110);
});

test("buy price is the lowest bid rounded down, sell is buy plus the fee rounded up, and the saving is against last year's price", async () => {
  const id = await make();
  await items(id, [T(1, 300, 9999, 105.7692, 1000)]);
  const r = (await bids(id, [
    { subcode: "CLT32001_V26_R1", supplier: "Supplier A", price: 80 }, { subcode: "CLT32001_V26_R1", supplier: "PG-B", price: 85 },
    { subcode: "CLT32001_V26_R1", supplier: "Unknown Print Co", price: 85 }, { subcode: "NOPE", supplier: "Supplier A", price: 1 }, { subcode: "CLT32001_V26_R1", supplier: "Supplier A", price: 0 },
  ])).rows[0].r;
  assert.deepEqual([r.added, r.skipped, r.not_in_srm], [3, 2, ["Unknown Print Co"]]);
  const a = row(await analysis(id), "CLT32001_V26_R1");
  assert.deepEqual([Number(a.buy), Number(a.sell), a.saving_type, a.bids], [80, 84, "ref", 3]);
  assert.equal(a.saving_pct, 20.6);                               // (105.77 - 84) / 105.77, the figure in the pricing file
  assert.equal(Number(a.saving_amount), 21769.2);                 // saving per unit times last year's volume
  assert.deepEqual(a.winners, ["Supplier A"]);                    // bids within the winner band of the price
  assert.ok(a.flags.includes("no_baseline") === false);
});

test("the market average caps outliers; a programme with no baseline measures against the market", async () => {
  const id = await make({ cap_percent: 30 });
  await items(id, [T(1, 10000, 49999, null, 500)]);
  await bids(id, [73, 73, 73, 42.4, 80].map((p, i) => ({ subcode: "CLT32001_V26_R1", supplier: `S${i}`, price: p })));
  const a = row(await analysis(id), "CLT32001_V26_R1");
  assert.equal(Number(a.market_avg), 68.28);                      // plain average of every bid
  assert.ok(Number(a.market_avg_capped) > 70);                    // 42.4 sits outside 30 percent of the average and is left out
  assert.equal(a.saving_type, "market");
  assert.ok(a.flags.includes("no_baseline"));
  assert.equal(Number(a.buy), 42);                                // the lowest bid is taken until the buyer chooses another
});

test("choosing another bid needs a reason, resets to the lowest, and shows as a flag", async () => {
  const id = await make();
  await items(id, [T(1, 300, 9999, 100, 10)]);
  await bids(id, [{ subcode: "CLT32001_V26_R1", supplier: "Supplier A", price: 60 }, { subcode: "CLT32001_V26_R1", supplier: "Supplier B", price: 73 }]);
  const itemId = (await asSuper("select id from public.rate_card_items where programme_id = $1", [id])).rows[0].id;
  const bidB = (await asSuper("select id from public.rate_card_bids where item_id = $1 and supplier_label = 'Supplier B'", [itemId])).rows[0].id;
  await rejects(as("lead", "select public.rate_card_item_select_bid($1,$2,'')", [itemId, bidB]), /why you are not taking the lowest/);
  await rejects(as("agent", "select public.rate_card_item_select_bid($1,$2,'Capacity')", [itemId, bidB]), /sourcing lead/);
  await as("lead", "select public.rate_card_item_select_bid($1,$2,'Only one with the capacity')", [itemId, bidB]);
  const a = row(await analysis(id), "CLT32001_V26_R1");
  assert.deepEqual([Number(a.buy), Number(a.sell), a.selected_supplier, a.selection_reason], [73, 77, "Supplier B", "Only one with the capacity"]);
  assert.ok(a.flags.includes("not_lowest"));
  await as("lead", "select public.rate_card_item_select_bid($1,null,null)", [itemId]);
  assert.equal(Number(row(await analysis(id), "CLT32001_V26_R1").buy), 60);
});

test("flags: price up on last year, a saving that looks too high, and a price that does not fall with quantity", async () => {
  const id = await make();
  await items(id, [T(1, 300, 999, 100), T(2, 1000, 4999, 100), T(3, 5000, 9999, 100), T(4, 10000, 19999, 40)]);
  await bids(id, [
    { subcode: "CLT32001_V26_R1", supplier: "Supplier A", price: 90 },
    { subcode: "CLT32001_V26_R2", supplier: "Supplier A", price: 120 },   // dearer than last year
    { subcode: "CLT32001_V26_R3", supplier: "Supplier A", price: 50 },    // 47.5 percent saving: too high
    { subcode: "CLT32001_V26_R4", supplier: "Supplier A", price: 30 },    // lower than the tier before? no: 31.5 < 53
  ]);
  const a = await analysis(id);
  assert.deepEqual(row(a, "CLT32001_V26_R1").flags, ["single_bid"]); // one bid each here, and nothing else is wrong with the first tier
  assert.ok(row(a, "CLT32001_V26_R2").flags.includes("price_up"));
  assert.ok(row(a, "CLT32001_V26_R2").flags.includes("tier_check"));      // 126 after 95
  assert.ok(row(a, "CLT32001_V26_R3").flags.includes("saving_high"));
  assert.ok(!row(a, "CLT32001_V26_R3").flags.includes("tier_check"));     // 53 is below 126
  assert.equal(a.summary.price_up, 1);
  assert.equal(a.summary.tier_check, 1);
});

test("coverage is measured against last year's spend and against the minimum", async () => {
  const id = await make({ min_coverage_percent: 61 });
  await items(id, [T(1, 1, 99, 10, 1000), { ...T(2, 100, 999, 10, 500), product_code: "OTHER", subcode: "OTHER_R1" }]);
  await bids(id, [{ subcode: "CLT32001_V26_R1", supplier: "Supplier A", price: 8 }]);
  let s = (await analysis(id)).summary;
  assert.deepEqual([s.items, s.with_price, s.no_bids, s.coverage_basis], [2, 1, 1, "spend"]);
  assert.equal(Number(s.coverage_percent), 66.7);                          // 10,000 of 15,000
  assert.equal(s.meets_coverage, true);
  await as("lead", "select public.rate_card_programme_update($1,$2::jsonb)", [id, JSON.stringify({ min_coverage_percent: 80 })]);
  s = (await analysis(id)).summary;
  assert.equal(s.meets_coverage, false);
});

test("status moves draft, bidding, review; review needs bids; an approved programme can't be changed", async () => {
  const id = await make();
  await rejects(as("lead", "select public.rate_card_programme_set_status($1,'bidding')", [id]), /Add items first/);
  await items(id, [T(1, 1, 99, 10)]);
  await as("lead", "select public.rate_card_programme_set_status($1,'bidding')", [id]);
  await rejects(as("lead", "select public.rate_card_programme_set_status($1,'review')", [id]), /Add supplier bids/);
  await bids(id, [{ subcode: "CLT32001_V26_R1", supplier: "Supplier A", price: 8 }]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [id]);
  await rejects(as("lead", "select public.rate_card_programme_set_status($1,'approved')", [id]), /Choose draft, bidding or review/);
  await asSuper("update public.rate_card_programmes set status = 'approved' where id = $1", [id]);
  await rejects(items(id, [T(2, 100, 999, 10)]), /can't be changed/);
});
