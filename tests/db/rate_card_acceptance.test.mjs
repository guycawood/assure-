// Vendor acceptance of rate card awards: approval creates one acceptance per awarded vendor; the vendor accepts or returns it with
// questions; sourcing answers; acceptance makes the vendor's prices agreed; reopening an approved programme sends it back through
// review and a different lead's approval, and every vendor accepts again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const VA = "00000000-0000-0000-0000-0000000001f1", VAV = "00000000-0000-0000-0000-0000000001f2", VB = "00000000-0000-0000-0000-0000000001f3", VC = "00000000-0000-0000-0000-0000000001f4";
Object.assign(ids, { va: VA, vav: VAV, vb: VB, vc: VC });
await asSuper("insert into public.sourcing_user_access (user_id, is_lead, doa_level) values ($1, true, 0), ($2, true, 0)", [ids.lead, ids.head]);
const sup = async (code, email) => {
  const id = (await asSuper("insert into public.suppliers (supplier_code, name, market, region, primary_contact_email) values ($1,$2,'Vietnam','APAC',$3) returning id", [code, `Accept ${code}`, email])).rows[0].id;
  await asSuper("update public.supplier_gates set status = 'verified' where supplier_id = $1", [id]);
  return id;
};
const sA = await sup("AC-A", "a@ac.example"), sB = await sup("AC-B", "b@ac.example"), sC = await sup("AC-C", "c@ac.example");
await asSuper("insert into public.supplier_team_members (supplier_id, email, permission_level, status) values ($1, 'view@ac.example', 'viewer', 'pending')", [sA]);
await asSuper("insert into auth.users (id, email) values ($1,'a@ac.example'), ($2,'view@ac.example'), ($3,'b@ac.example'), ($4,'c@ac.example')", [VA, VAV, VB, VC]);

async function approved() {
  const p = (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "RC Acceptance", year: 2026, currency: "vnd", price_decimals: 0 })])).rows[0].id;
  await as("lead", "select public.rate_card_items_import($1,$2::jsonb)", [p, JSON.stringify([
    { product_type: "Banner", product_code: "AC1", subcode: "AC1_R1", channel: "DT", qty_min: 1, qty_max: 99, baseline_price: 100, baseline_qty: 10 },
    { product_type: "Banner", product_code: "AC1", subcode: "AC1_R2", channel: "DT", qty_min: 100, qty_max: 999, baseline_price: 95, baseline_qty: 10 }])]);
  await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [p, JSON.stringify([
    { subcode: "AC1_R1", supplier: "Accept AC-A", price: 80 }, { subcode: "AC1_R1", supplier: "Accept AC-B", price: 83 },
    { subcode: "AC1_R2", supplier: "Accept AC-A", price: 75 }, { subcode: "AC1_R2", supplier: "Accept AC-B", price: 78 }])]);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() + interval '2 days' where id = $1", [p]);
  await as("lead", "select public.rate_card_programme_invite($1, array[$2,$3,$4]::uuid[])", [p, sA, sB, sC]);
  await asSuper("update public.rate_card_programmes set bid_deadline = now() - interval '1 minute' where id = $1", [p]);
  const [r1] = (await asSuper("select id from public.rate_card_items where programme_id = $1 order by sort", [p])).rows;
  const bids = Object.fromEntries((await asSuper("select supplier_label, id from public.rate_card_bids where item_id = $1", [r1.id])).rows.map((r) => [r.supplier_label, r.id]));
  await as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [r1.id, JSON.stringify([{ bid_id: bids["Accept AC-A"], share: 70 }, { bid_id: bids["Accept AC-B"], share: 30 }])]);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);                         // R2 to AC-A at 100 percent
  await as("lead", "select public.rate_card_programme_set_validity($1,'2026-01-01','2027-12-31')", [p]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [p]);
  await as("head", "select public.rate_card_programme_approve($1,'Approved')", [p]);
  return p;
}
const acc = async (p, who = "lead") => (await as(who, "select public.rate_card_programme_acceptances($1) as r", [p])).rows[0].r;
const status = async (p, sup) => (await asSuper("select status from public.rate_card_acceptances where programme_id = $1 and supplier_id = $2", [p, sup])).rows[0]?.status;
const contract = async (p, sup) => (await asSuper("select distinct a.contract_status from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id where i.programme_id = $1 and a.supplier_id = $2", [p, sup])).rows.map((r) => r.contract_status);

test("approval creates one pending acceptance per awarded vendor and tells them; a vendor with no award gets nothing", async () => {
  const p = await approved();
  const list = await acc(p);
  assert.deepEqual(list.map((x) => [x.supplier_name, x.status, Number(x.items)]), [["Accept AC-A", "pending", 2], ["Accept AC-B", "pending", 1]]);
  assert.equal(await status(p, sC), undefined);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where title like 'Please accept your rate card award:%'")).rows[0].n >= 2, true);
  assert.deepEqual(await contract(p, sA), ["pending"]);
  const aw = (await as(VA, "select public.vendor_rate_card_awards($1) as r", [p])).rows[0].r;
  assert.equal(aw.acceptance.status, "pending");
  const listV = (await as(VA, "select public.vendor_rate_card_programmes() as r")).rows[0].r.find((x) => x.id === p);
  assert.deepEqual([listV.awarded, listV.accept_status], [2, "pending"]);
  await rejects(as(VC, "select public.vendor_rate_card_accept($1,true,null)", [p]), /no award to accept/);
});

test("only the awarded vendor with edit access accepts; acceptance records who and makes its prices agreed", async () => {
  const p = await approved();
  await rejects(as(VAV, "select public.vendor_rate_card_accept($1,true,null)", [p]), /view-only/);
  await rejects(as("agent", "select public.vendor_rate_card_accept($1,true,null)", [p]), /Only a vendor user/);
  await rejects(as(VA, "select public.vendor_rate_card_accept($1,null,null)", [p]), /accept or return/);
  assert.equal((await as(VA, "select public.vendor_rate_card_accept($1,true,null) as r", [p])).rows[0].r, "accepted");
  assert.equal(await status(p, sA), "accepted");
  assert.deepEqual(await contract(p, sA), ["agreed"]);
  assert.deepEqual(await contract(p, sB), ["pending"]);                       // B has not accepted yet
  const a = (await acc(p)).find((x) => x.supplier_name === "Accept AC-A");
  assert.ok(a.accepted_by && a.accepted_at);
  await rejects(as(VA, "select public.vendor_rate_card_accept($1,true,null)", [p]), /already accepted/);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where user_id = $1 and title like '%accepted its award%'", [ids.lead])).rows[0].n >= 1, true);
});

test("a vendor can return the award with a question; sourcing answers; the vendor then accepts", async () => {
  const p = await approved();
  await rejects(as(VB, "select public.vendor_rate_card_accept($1,false,'')", [p]), /what your question is/);
  assert.equal((await as(VB, "select public.vendor_rate_card_accept($1,false,'Is the price valid for the whole term?') as r", [p])).rows[0].r, "queried");
  assert.equal(await status(p, sB), "queried");
  assert.equal((await acc(p)).find((x) => x.supplier_name === "Accept AC-B").question, "Is the price valid for the whole term?");
  await rejects(as("agent", "select public.rate_card_acceptance_respond($1,$2,'Yes')", [p, sB]), /sourcing lead/);
  await rejects(as("lead", "select public.rate_card_acceptance_respond($1,$2,'')", [p, sA]), /no open question|Write the answer/);
  await as("lead", "select public.rate_card_acceptance_respond($1,$2,'Yes, fixed for the full term.')", [p, sB]);
  assert.equal(await status(p, sB), "pending");
  assert.equal((await as(VB, "select public.vendor_rate_card_awards($1) as r", [p])).rows[0].r.acceptance.response, "Yes, fixed for the full term.");
  await as(VB, "select public.vendor_rate_card_accept($1,true,null)", [p]);
  assert.deepEqual(await contract(p, sB), ["agreed"]);
});

test("reopening an approved programme needs a reason, sends it back to review, clears acceptances and needs a different lead to approve again", async () => {
  const p = await approved();
  await as(VA, "select public.vendor_rate_card_accept($1,true,null)", [p]);
  await rejects(as("lead", "select public.rate_card_programme_reopen($1,'')", [p]), /what is changing/);
  await rejects(as("agent", "select public.rate_card_programme_reopen($1,'Price change on R1')", [p]), /sourcing lead/);
  await as("lead", "select public.rate_card_programme_reopen($1,'Price change on R1 agreed with AC-A')", [p]);
  assert.equal((await asSuper("select status, approved_by, submitted_by from public.rate_card_programmes where id = $1", [p])).rows[0].status, "review");
  assert.equal((await acc(p)).length, 0);                                       // acceptances cleared
  assert.deepEqual(await contract(p, sA), ["pending"]);
  assert.equal((await asSuper("select count(*)::int n from public.notifications where title like 'Rate card terms are being revised:%'")).rows[0].n >= 2, true);
  await rejects(as("lead", "select public.rate_card_programme_approve($1,'Again')", [p]), /different sourcing lead/);   // the one who reopened it cannot approve it
  await as("head", "select public.rate_card_programme_approve($1,'Revised')", [p]);
  assert.equal((await acc(p)).every((x) => x.status === "pending"), true);       // everyone accepts again
});

test("only an approved programme can be reopened", async () => {
  const draft = (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "Draft only" })])).rows[0].id;
  await rejects(as("lead", "select public.rate_card_programme_reopen($1,'Nothing to reopen here')", [draft]), /Only an approved programme/);
});

test("an award to a bidder that is not in SRM, or a vendor that has become blocked, stops approval", async () => {
  const p = (await as("lead", "select public.rate_card_programme_create($1::jsonb) as id", [JSON.stringify({ name: "RC Not in SRM", year: 2026, currency: "vnd", price_decimals: 0 })])).rows[0].id;
  await as("lead", "select public.rate_card_items_import($1,$2::jsonb)", [p, JSON.stringify([{ product_type: "Banner", product_code: "NS1", subcode: "NS1_R1", channel: "DT", qty_min: 1, qty_max: 99, baseline_price: 100, baseline_qty: 10 }])]);
  await as("lead", "select public.rate_card_bids_import($1,$2::jsonb)", [p, JSON.stringify([{ subcode: "NS1_R1", supplier: "Unknown Print Co", price: 60 }, { subcode: "NS1_R1", supplier: "Accept AC-A", price: 70 }])]);
  await as("lead", "select public.rate_card_programme_award_lowest($1)", [p]);                       // the unknown supplier is lowest
  await as("lead", "select public.rate_card_programme_set_validity($1,'2026-01-01','2026-12-31')", [p]);
  await as("lead", "select public.rate_card_programme_set_status($1,'review')", [p]);
  await rejects(as("head", "select public.rate_card_programme_approve($1,'ok')", [p]), /not in SRM yet: Unknown Print Co/);
  const item = (await asSuper("select id from public.rate_card_items where programme_id = $1", [p])).rows[0].id;
  const bid = (await asSuper("select id from public.rate_card_bids where item_id = $1 and supplier_label = 'Accept AC-A'", [item])).rows[0].id;
  await as("lead", "select public.rate_card_item_set_awards($1,$2::jsonb)", [item, JSON.stringify([{ bid_id: bid, share: 100 }])]);
  await asSuper("update public.suppliers set active = false where id = $1", [sA]);
  await rejects(as("head", "select public.rate_card_programme_approve($1,'ok')", [p]), /no longer eligible/);
  await asSuper("update public.suppliers set active = true where id = $1", [sA]);
  assert.equal((await as("head", "select public.rate_card_programme_approve($1,'ok') as r", [p])).rows[0].r.awarded, 1);
});
