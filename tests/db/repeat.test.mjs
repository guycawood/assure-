// Repeat orders: duplicating a brief or a spec makes a linked draft copy; spec copies carry every product field,
// versions and the bill of materials (but no RFQ, estimate or triage), can go onto another open job, and
// spec_repeat_context shows what was bought last time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDb } from "./helpers.mjs";

const t = await setupDb();
const { as, asSuper, rejects } = t;
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0];

const { rows: [client] } = await asSuper("insert into public.sourcing_clients (code, name) values ('RPT','Repeat Client (demo)') returning id");
const { rows: [sup] } = await asSuper("insert into public.suppliers (supplier_code, name, market, region) values ('R-1','Repeat Print Co','Germany','EMEA') returning id");
const job = async (title) => (await one("agent", "insert into public.jobs (title, client_id, region, market) values ($1,$2,'EMEA','Germany') returning id", [title, client.id])).id;
const J1 = await job("Original job");
const J2 = await job("Repeat job");
const S = (await one("agent", "insert into public.job_specs (job_id, title, spec_type, hs_code, description, region, market) values ($1,'Header card','2d','4911.99','A4 header card, matt laminate','EMEA','Germany') returning id", [J1])).id;
const V = (await one("agent", "insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values ($1,'Main',1000,297,210) returning id", [S])).id;
await as("agent", "insert into public.spec_components (spec_id, version_id, component_name, component_type, quantity_per_unit) values ($1,$2,'Board','body',1)", [S, V]);

test("duplicating a spec onto another job copies product fields, versions and BOM as a linked draft", async () => {
  const id = (await one("agent", "select public.spec_duplicate($1, $2, 2500) as id", [S, J2])).id;
  const c = await one("agent", "select job_id, title, spec_type, hs_code, description, is_draft, repeat_of_spec_id, spec_no from public.job_specs where id = $1", [id]);
  assert.equal(c.job_id, J2);
  assert.deepEqual([c.title, c.spec_type, c.hs_code, c.description, c.is_draft, c.repeat_of_spec_id], ["Header card", "2d", "4911.99", "A4 header card, matt laminate", true, S]);
  assert.equal(c.spec_no, 1);
  const v = (await as("agent", "select id, quantity, finished_length from public.spec_versions where spec_id = $1", [id])).rows;
  assert.equal(v.length, 1);
  assert.equal(v[0].quantity, 2500);
  const comp = await one("agent", "select version_id, component_name from public.spec_components where spec_id = $1", [id]);
  assert.deepEqual(comp, { version_id: v[0].id, component_name: "Board" });
  // Same-job duplicate takes the next spec number and keeps the quantity.
  const same = (await one("agent", "select public.spec_duplicate($1) as id", [S])).id;
  const s2 = await one("agent", "select job_id, spec_no from public.job_specs where id = $1", [same]);
  assert.deepEqual(s2, { job_id: J1, spec_no: 2 });
  assert.equal((await one("agent", "select quantity from public.spec_versions where spec_id = $1", [same])).quantity, 1000);
});

test("repeats can't go onto a closed job, and only staff can duplicate", async () => {
  const J3 = await job("Finished job");
  await asSuper("alter table public.jobs disable trigger user");
  await asSuper("update public.jobs set status = 'closed' where id = $1", [J3]);
  await asSuper("alter table public.jobs enable trigger user");
  await rejects(as("agent", "select public.spec_duplicate($1, $2)", [S, J3]), /choose an open job/);
  await asSuper("insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9','v@repeat.example')");
  t.ids.vend = "00000000-0000-0000-0000-0000000000e9";
  await asSuper("update public.profiles set supplier_id = $1, user_type = 'supplier' where id = $2", [sup.id, t.ids.vend]).catch(() => {});
  await rejects(as("vend", "select public.spec_duplicate($1)", [S]), /staff/);
});

test("repeat context shows the last purchase of the original spec", async () => {
  const { rows: [est] } = await asSuper(
    "insert into public.estimates (job_id, supplier_id, source, currency, base_cost, pricing_percent, region, market, status, approved_at) values ($1,$2,'rfq','EUR',450,15,'EMEA','Germany','approved', now()) returning id", [J1, sup.id]);
  await asSuper("insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost) values ($1,$2,1000,0.45,450)", [est.id, S]);
  const rep = (await one("agent", "select public.spec_duplicate($1, $2) as id", [S, J2])).id;
  const ctx = (await one("agent", "select public.spec_repeat_context($1) as c", [rep])).c;
  assert.equal(ctx.original.spec_id, S);
  assert.equal(ctx.last_purchase.supplier_name, "Repeat Print Co");
  assert.equal(Number(ctx.last_purchase.unit_cost), 0.45);
  // A repeat of a repeat still finds the original purchase.
  const rep2 = (await one("agent", "select public.spec_duplicate($1, $2) as id", [rep, J2])).id;
  const ctx2 = (await one("agent", "select public.spec_repeat_context($1) as c", [rep2])).c;
  assert.equal(ctx2.generations, 2);
  assert.equal(ctx2.original.spec_id, S);
  assert.equal(Number(ctx2.last_purchase.unit_cost), 0.45);
  assert.equal((await one("agent", "select public.spec_repeat_context($1) as c", [S])).c, null);
});

test("duplicating a brief makes a linked draft for the person duplicating, with a new market if chosen", async () => {
  const b = (await one("agent", "select public.brief_create($1::jsonb, true) as id", [JSON.stringify({ title: "Summer header cards", objective: "Repeat the summer run", region: "EMEA", market: "DE", budget_low: 1000, budget_high: 2000, currency: "EUR" })])).id;
  const d = (await one("lead", "select public.brief_duplicate($1, 'FR') as id", [b])).id;
  const r = await one("lead", "select title, objective, status, approval_status, market, region, repeat_of_brief_id, target_launch, created_by = auth.uid() as mine from public.briefs where id = $1", [d]);
  assert.deepEqual([r.title, r.objective, r.status, r.approval_status, r.market, r.region, r.repeat_of_brief_id, r.target_launch, r.mine],
    ["Summer header cards", "Repeat the summer run", "draft", null, "FR", "EMEA", b, null, true]);
  await rejects(as("lead", "select public.brief_duplicate($1, 'ZZ')", [b]), /not in the market list/);
});
