// Chasing a missing client PO (GBT "Catalogue order and order window", q4): approved estimates without a client PO are listed with
// the wait, a chase reaches the client's approvers and is not repeated within three days, and the client can give its PO number.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects, ids } = t;
const CA = "00000000-0000-0000-0000-0000000000f4", CV = "00000000-0000-0000-0000-0000000000f5", CO = "00000000-0000-0000-0000-0000000000f6";
Object.assign(ids, { ca: CA, cv: CV, co: CO });
await asSuper("insert into auth.users (id, email) values ($1, 'approver@po.example'), ($2, 'viewer@po.example'), ($3, 'other@po-other.example')", [CA, CV, CO]);
const one = async (sql, p) => (await asSuper(sql, p)).rows[0];
const client = (await one("insert into public.sourcing_clients (code, name) values ('PO1', 'PO Client') returning id")).id;
const other = (await one("insert into public.sourcing_clients (code, name) values ('PO2', 'Other PO Client') returning id")).id;
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [CA, client]);
await as("admin", "select public.client_access_grant($1, $2, 'viewer')", [CV, client]);
await as("admin", "select public.client_access_grant($1, $2, 'approver')", [CO, other]);
const sup = (await one("insert into public.suppliers (supplier_code, name, market, region) values ('PO-S','PO Supplier','United Kingdom','EMEA') returning id")).id;

async function estimate({ status = "approved", ref = null, daysAgo = 5 } = {}) {
  const job = (await as("agent", "insert into public.jobs (title, client_id, region, market) values ('PO job',$1,'EMEA','United Kingdom') returning id", [client])).rows[0].id;
  const e = (await one("insert into public.estimates (job_id, supplier_id, source, currency, base_cost, pricing_percent, region, market, status, client_order_ref) values ($1,$2,'rfq','GBP',1000,20,'EMEA','United Kingdom',$3,$4) returning id", [job, sup, status, ref])).id;
  if (status === "approved") await asSuper("update public.estimates set approved_at = now() - make_interval(days => $2) where id = $1", [e, daysAgo]);
  return e;
}
const waiting = async () => (await as("agent", "select public.estimate_po_waiting() as r")).rows[0].r;

test("only client-approved estimates without a PO are listed, with how long they have waited", async () => {
  const w = await estimate({ daysAgo: 6 });
  const withRef = await estimate({ ref: "PO-123" });
  const sent = await estimate({ status: "sent" });
  const list = await waiting();
  const row = list.find((x) => x.estimate_id === w);
  assert.ok(row);
  assert.equal(row.days_waiting, 6);
  assert.equal(row.chase_due, true);
  assert.ok(!list.some((x) => x.estimate_id === withRef || x.estimate_id === sent));
  await rejects(as(CA, "select public.estimate_po_waiting()"), /Internal staff only/);
});

test("a chase is logged, reaches the client's approvers, and is not repeated within three days", async () => {
  const e = await estimate();
  await rejects(as(CA, "select public.estimate_chase_client_po($1, null)", [e]), /Only internal staff/);
  await as("agent", "select public.estimate_chase_client_po($1, 'Please send the PO for the autumn run')", [e]);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title like 'Your PO is needed%'", [CA])).n >= 1, true);
  assert.equal((await one("select count(*)::int n from public.notifications where user_id = $1 and title = 'Your PO is needed for ' || (select estimate_number from public.estimates where id = $2)", [CV, e])).n, 0);
  assert.equal((await one("select count(*)::int n from public.email_outbox where to_email = 'approver@po.example' and subject like 'Your purchase order is needed%'")).n >= 1, true);
  await rejects(as("agent", "select public.estimate_chase_client_po($1, null)", [e]), /already chased/);
  const row = (await waiting()).find((x) => x.estimate_id === e);
  assert.deepEqual([row.chases, row.chase_due], [1, false]);
  // three days later it is due again
  await asSuper("update public.estimate_po_chases set chased_at = now() - interval '4 days' where estimate_id = $1", [e]);
  assert.equal((await waiting()).find((x) => x.estimate_id === e).chase_due, true);
  await as("agent", "select public.estimate_chase_client_po($1, null)", [e]);
  const withRef = await estimate({ ref: "PO-9" });
  await rejects(as("agent", "select public.estimate_chase_client_po($1, null)", [withRef]), /not waiting for a client PO/);
});

test("the client gives its PO number: approvers only, own estimates only; the wait ends and the team is told", async () => {
  const e = await estimate();
  const st = (await as(CA, "select public.client_estimate_po_status($1) as s", [e])).rows[0].s;
  assert.deepEqual([st.needed, st.can_provide, Number(st.sell_price)], [true, true, 1200]);
  assert.equal((await as(CV, "select public.client_estimate_po_status($1) as s", [e])).rows[0].s.can_provide, false);
  assert.equal((await as(CO, "select public.client_estimate_po_status($1) as s", [e])).rows[0].s, null);
  await rejects(as(CV, "select public.client_estimate_provide_po($1, 'PO-77', null)", [e]), /Only approvers/);
  await rejects(as(CO, "select public.client_estimate_provide_po($1, 'PO-77', null)", [e]), /Not found|not found/i);
  await rejects(as(CA, "select public.client_estimate_provide_po($1, '', null)", [e]), /purchase order number/);
  await rejects(as(CA, "select public.client_estimate_provide_po($1, 'PO-77', 5000)", [e]), /more than the estimate/);
  await as(CA, "select public.client_estimate_provide_po($1, 'PO-77', null)", [e]);
  const po = await one("select po_number, amount from public.client_pos where estimate_id = $1", [e]);
  assert.deepEqual([po.po_number, Number(po.amount)], ["PO-77", 1200]);
  assert.ok(!(await waiting()).some((x) => x.estimate_id === e));
  assert.equal((await as(CA, "select public.client_estimate_po_status($1) as s", [e])).rows[0].s.needed, false);
  await rejects(as(CA, "select public.client_estimate_provide_po($1, 'PO-78', null)", [e]), /already covered/);
  const ev = (await asSuper("select event, detail from public.sourcing_events where entity_id = $1 and event = 'client_po_added'", [e])).rows;
  assert.equal(ev[0].detail.via, "client_portal");
});
