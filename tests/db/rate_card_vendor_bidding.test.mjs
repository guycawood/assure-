// Rate card programmes floated to vendors: a deadline and eligible vendors, notification, the vendor's own pricing grid in the portal
// (no last-year price, no other bids), draft and final submission, decline, a closed deadline, and bids sealed from the team until
// the deadline passes or every vendor has responded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const V = { a: "00000000-0000-0000-0000-0000000001d1", aView: "00000000-0000-0000-0000-0000000001d2", b: "00000000-0000-0000-0000-0000000001d3", c: "00000000-0000-0000-0000-0000000001d4" };
Object.assign(ids, V);
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0)", [ids.lead]);
const sup = async (code, email) => (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Vietnam','APAC',$3) returning id", [code, `Vendor ${code}`, email])).rows[0].id;
const sA = await sup("VB-A", "a@vb.example"), sB = await sup("VB-B", "b@vb.example"), sC = await sup("VB-C", "c@vb.example"), sD = await sup("VB-D", "d@vb.example");
for (const s of [sA, sB, sC]) await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [s]);   // D is left blocked for purchasing
await asSuper("insert into public.supplier_team_members (supplier_id, email, permission_level, status) values ($1, 'view@vb.example', 'viewer', 'pending')", [sA]);
await asSuper("insert into auth.users (id, email) values ($1,'a@vb.example'), ($2,'view@vb.example'), ($3,'b@vb.example'), ($4,'c@vb.example')", [V.a, V.aView, V.b, V.c]);

const day = (o) => new Date(Date.now() + o * 864e5).toISOString();
async function programme(deadline = day(5)) {
  const id = (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "RC 2026 Bidding", year: 2026, currency: "vnd", price_decimals: 0 })])).rows[0].id;
  await as("lead", "select public.rate_card_items_import($1,$2::jsonb)", [id, JSON.stringify([
    { product_type: "Banner", product_code: "B1", subcode: "B1_R1", channel: "DT", qty_min: 1, qty_max: 99, baseline_price: 100, baseline_qty: 10 },
    { product_type: "Banner", product_code: "B1", subcode: "B1_R2", channel: "DT", qty_min: 100, qty_max: 999, baseline_price: 90, baseline_qty: 10 }])]);
  if (deadline) await as("lead", "select public.rate_card_programme_set_deadline($1,$2)", [id, deadline]);
  return id;
}
const itemIds = async (prog) => (await asSuper("select id from public.rate_card_items where programme_id = $1 order by sort", [prog])).rows.map((r) => r.id);
const vendorItems = async (user, prog) => (await as(user, "select public.vendor_rate_card_items($1) as r", [prog])).rows[0].r;
const submit = (user, prog, prices, final = false) => as(user, "select public.vendor_rate_card_submit($1,$2::jsonb,$3) as r", [prog, JSON.stringify(prices), final]);
const analysis = async (prog) => (await as("lead", "select public.rate_card_programme_analysis($1) as a", [prog])).rows[0].a;

test("inviting needs items, a future deadline and eligible vendors; each vendor is told", async () => {
  const noDeadline = await programme(null);
  await rejects(as("lead", "select public.rate_card_programme_invite($1, array[$2]::uuid[])", [noDeadline, sA]), /Set a deadline/);
  await rejects(as("lead", "select public.rate_card_programme_set_deadline($1,$2)", [noDeadline, day(-1)]), /in the future/);
  const p = await programme();
  await rejects(as("agent", "select public.rate_card_programme_invite($1, array[$2]::uuid[])", [p, sA]), /sourcing lead/);
  await rejects(as("lead", "select public.rate_card_programme_invite($1, array[$2]::uuid[])", [p, sD]), /not eligible/);
  await rejects(as("lead", "select public.rate_card_programme_invite($1, array[]::uuid[])", [p]), /at least one vendor/);
  const n = (await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3,$4]::uuid[]) as n", [p, sA, sB, sC])).rows[0].n;
  assert.equal(n, 3);
  assert.equal((await as("lead", "select public.rate_card_programme_invite($1, array[$2]::uuid[]) as n", [p, sA])).rows[0].n, 0); // already invited
  assert.equal((await asSuper("select status from public.rate_card_programmes where id = $1", [p])).rows[0].status, "bidding");
  assert.equal((await asSuper("select count(*)::int n from public.email_outbox where supplier_id = $1 and subject like 'Rate card pricing requested:%'", [sA])).rows[0].n, 1);
  assert.equal((await as("lead", "select public.rate_card_invites_list($1) as l", [p])).rows[0].l.length, 3);
});

test("a vendor sees only its own invitation and items, never last year's price or other bids; viewers cannot submit", async () => {
  const p = await programme();
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p, sA, sB]);
  assert.equal((await as(V.a, "select public.vendor_rate_card_programmes() as l")).rows[0].l.filter((x) => x.id === p).length, 1);
  assert.equal((await as(V.c, "select public.vendor_rate_card_programmes() as l")).rows[0].l.filter((x) => x.id === p).length, 0);   // not invited
  await rejects(as(V.c, "select public.vendor_rate_card_items($1)", [p]), /not found/);
  const view = await vendorItems(V.a, p);
  assert.equal(view.items.length, 2);
  assert.ok(view.items.every((i) => i.baseline_price === undefined && i.baseline_qty === undefined && i.bid_list === undefined));
  assert.equal((await asSuper("select status from public.rate_card_invites where programme_id = $1 and supplier_id = $2", [p, sA])).rows[0].status, "viewed");
  const [i1] = await itemIds(p);
  await rejects(submit(V.aView, p, [{ item_id: i1, price: 50 }]), /view-only/);
  await rejects(as("agent", "select public.vendor_rate_card_submit($1,'[]'::jsonb,false)", [p]), /Only a vendor user/);
  await rejects(submit(V.a, p, [{ item_id: i1, price: -1 }]), /above zero/);
  await rejects(submit(V.a, p, [{ item_id: "00000000-0000-0000-0000-000000000999", price: 5 }]), /not in this programme/);
});

test("draft, final, resubmit, clear a price, decline, and a closed deadline", async () => {
  const p = await programme();
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p, sA, sB]);
  const [i1, i2] = await itemIds(p);
  await rejects(submit(V.a, p, [], true), /at least one item/);
  const d = (await submit(V.a, p, [{ item_id: i1, price: "80" }, { item_id: i2, price: 70 }])).rows[0].r;
  assert.deepEqual([d.saved, d.priced, d.submitted], [2, 2, false]);
  assert.equal((await vendorItems(V.a, p)).items[0].price, 80);
  const f = (await submit(V.a, p, [{ item_id: i2, price: "" }], true)).rows[0].r;     // clearing one price and sending
  assert.deepEqual([f.cleared, f.priced, f.submitted], [1, 1, true]);
  assert.equal((await asSuper("select status from public.rate_card_invites where programme_id = $1 and supplier_id = $2", [p, sA])).rows[0].status, "submitted");
  assert.equal((await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title like '%sent prices for%'", [ids.lead])).rows[0].n, 1);
  await submit(V.a, p, [{ item_id: i1, price: 75 }], true);                          // a price can be revised before the deadline
  assert.equal(Number((await asSuper("select price from public.rate_card_bids where item_id = $1 and supplier_id = $2", [i1, sA])).rows[0].price), 75);
  await rejects(as(V.b, "select public.vendor_rate_card_decline($1,'')", [p]), /why you are declining/);
  await as(V.b, "select public.vendor_rate_card_decline($1,'No capacity this year')", [p]);
  await rejects(submit(V.b, p, [{ item_id: i1, price: 60 }]), /declined/);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() - interval '1 hour' where id = $1", [p]);
  await rejects(submit(V.a, p, [{ item_id: i1, price: 70 }]), /closed/);
  assert.equal((await as(V.a, "select public.vendor_rate_card_programmes() as l")).rows[0].l.find((x) => x.id === p).closed, true);
});

test("vendor prices are sealed from the team until the deadline passes or every vendor has responded", async () => {
  const p = await programme();
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p, sA, sB]);
  const [i1] = await itemIds(p);
  await submit(V.a, p, [{ item_id: i1, price: 80 }], true);
  let a = await analysis(p);
  assert.deepEqual([a.summary.bids_open, a.summary.sealed_bids, a.summary.with_bids], [false, 1, 0]);   // B has not responded and the deadline is ahead
  assert.deepEqual(a.rows[0].bid_list, []);
  const bid = (await asSuper("select id from public.rate_card_bids where item_id = $1", [i1])).rows[0].id;
  await rejects(as("lead", "select public.rate_card_item_select_bid($1,$2,'x')", [i1, bid]), /sealed/);
  // B responds: everyone has answered, so the prices open
  await submit(V.b, p, [{ item_id: i1, price: 85 }], true);
  a = await analysis(p);
  assert.deepEqual([a.summary.bids_open, a.summary.sealed_bids, a.summary.with_bids], [true, 0, 1]);
  assert.deepEqual([Number(a.rows[0].buy), a.rows[0].bid_list.length], [80, 2]);
  // a different programme opens at the deadline
  const p2 = await programme();
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3]::uuid[])", [p2, sA, sB]);
  const [j1] = await itemIds(p2);
  await submit(V.a, p2, [{ item_id: j1, price: 70 }], true);
  assert.equal((await analysis(p2)).summary.bids_open, false);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() - interval '1 minute' where id = $1", [p2]);
  const open = await analysis(p2);
  assert.deepEqual([open.summary.bids_open, Number(open.rows[0].buy)], [true, 70]);
});

test("prices from an import stay visible; only vendor prices are sealed", async () => {
  const p = await programme();
  await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [p, JSON.stringify([{ subcode: "B1_R1", supplier: "Someone Else", price: 66 }])]);
  await as("lead", "select public.rate_card_programme_invite($1, array[$2]::uuid[])", [p, sA]);
  const [i1] = await itemIds(p);
  await submit(V.a, p, [{ item_id: i1, price: 60 }]);
  const a = await analysis(p);
  assert.equal(a.rows[0].bid_list.length, 1);
  assert.equal(a.rows[0].bid_list[0].source, "import");
  assert.equal(a.summary.sealed_bids, 1);
});
